#!/usr/bin/env node
// sdd.js: the deterministic side of the SDD flow. The /sdd:* commands tell the
// agent to run it; every rule that can be checked by a script lives here
// instead of in the prompt (RF-SDD-04/12/13/14/15/16/17, RF-ORQ-01..08,
// RF-GAT-03/10..14, RF-RET-01..07, RF-VER-01/02). Dependency-free.
//
// Exit codes: 0 ok, 2 refused (reason on stderr), 1 usage error.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs, isMainModule } from './args.js';
import { findProjectRoot, loadGuardSettings } from './project.js';
import { loadFlow, saveFlow, logEvent } from './state.js';
import { requestGate } from './flow.js';
import { specDirOf } from './state.js';
import { importContract } from './contracts.js';
import { listSpecs, specsDirFor, specRoots, specDependencies, resolveSpecRef, nextSpecId, nextAdrFile, slugify, parseTasks, selectNextTask, markTaskDone, taskProblems, parseRequirements, lintSpec, lintTasks, lintConstitution } from './tasks.js';
import { runVerify } from './verify.js';
import { loadState as loadRetries, saveState as saveRetries, recordFailure, resetTask } from './retry.js';
import { runtimeMessages } from './runtime-messages.js';
import { matchesAny } from './glob.js';
import { linkedTasks, planSync, applyLocal } from './tracker-sync.js';

const OK = 0;
const USAGE = 1;
const REFUSED = 2;

const USAGE_TEXT = `usage: sdd.js <command>
  status [--json]                 active spec, task, pending decision, blockers
  new-spec <name> [--component c] create specs/<PREFIX>-<NNN>-<name>/spec.md
  new-adr <name>                  create docs/decisions/ADR-<NNNN>-<name>.md
  gate request <kind> [--files a,b] [--adr f] [--summary s]
  gate status
  next                            start the next task
  verify [--quick]                run the verification of the current task
  task done <T#>                  close the current task
  triage start | change start
  validate [--json]               requirement → test coverage of the active spec
  contract import <repo#SPEC> [--file f]  snapshot a provider contract into the active spec
  tracker plan [--file f]         items read from the tracker (JSON on stdin) → sync plan
  tracker apply [--file f]        after the "tracker" gate: links, pulls and decisions into tasks.md
  commit-context                  changes per repository for /sdd:commit
  lint <spec|tasks|constitution> [file]`;

export function roleFor(kind) {
  return kind === 'frontend' ? 'frontend-dev' : 'backend-dev';
}

function readTemplate(root, name) {
  try {
    return readFileSync(path.join(root, '.harness', 'templates', `${name}.md`), 'utf8').replace(/^<!--[^\n]*-->\n/, '');
  } catch {
    return `# ${name}\n`;
  }
}

function specPaths(root, id, state) {
  const dir = path.join(root, specDirOf(state, id));
  return { dir, spec: path.join(dir, 'spec.md'), plan: path.join(dir, 'plan.md'), tasks: path.join(dir, 'tasks.md'), progress: path.join(dir, 'progress.md') };
}

function read(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/**
 * @param {string[]} argv
 * @param {{ stdout: { write(s: string): void }, stderr: { write(s: string): void }, cwd: string, env: object, run?: Function }} io
 */
export async function runSdd(argv, io) {
  const { flags, positional } = parseArgs(argv, { string: ['component', 'files', 'adr', 'summary', 'option', 'file'], boolean: ['json', 'quick'] });
  const [command, ...rest] = positional;
  const root = findProjectRoot(io.cwd);
  const out = (s) => io.stdout.write(`${s}\n`);
  const refuse = (s) => {
    io.stderr.write(`${s}\n`);
    return REFUSED;
  };
  if (!root) return refuse('This project is not activated (no harness.config.yaml). Run "harness init" first.');
  const settings = loadGuardSettings(root);
  const lang = io.env.HARNESS_LANG?.startsWith('es') ? 'es' : io.env.HARNESS_LANG?.startsWith('en') ? 'en' : settings.language ?? 'es';
  const t = runtimeMessages(lang);
  const { state } = loadFlow(root, specRoots(settings));
  const save = () => saveFlow(root, state, settings.specsLanguage);
  const componentIds = Object.keys(settings.components);

  switch (command) {
    case 'status': {
      const spec = state.specs[state.activeSpec] ?? null;
      const blockers = [];
      if (state.gate) blockers.push(`${t.status.gate}: ${state.gate.kind}`);
      if (state.triage) blockers.push(`${t.status.triage}: ${state.triage.task}`);
      if (state.task?.verify?.status === 'fail') blockers.push(`verify: ${state.task.verify.failing?.command}`);
      // RF-TOP-05: dependencies on specs that do not exist.
      if (state.activeSpec) {
        for (const ref of specDependencies(read(specPaths(root, state.activeSpec, state).spec))) {
          if (!resolveSpecRef(root, settings, ref)) blockers.push(t.status.missingDependency(ref));
        }
      }
      const data = {
        activeSpec: state.activeSpec,
        phase: spec?.phase ?? null,
        approved: spec?.approved ?? [],
        constitution: state.constitution.approved,
        task: state.task ? { id: state.task.id, component: state.task.component, verify: state.task.verify?.status ?? null } : null,
        gate: state.gate?.kind ?? null,
        triage: Boolean(state.triage),
        blockers,
        // RF-OBS-04: never estimated.
        cost: null,
      };
      if (flags.json) {
        out(JSON.stringify(data, null, 2));
        return OK;
      }
      const s = t.status;
      out(s.title);
      out(`  ${s.spec}: ${data.activeSpec ?? s.none}`);
      out(`  ${s.phase}: ${data.phase ?? s.none} · ${s.approved}: ${data.approved.join(', ') || s.none}`);
      out(`  ${s.task}: ${data.task ? `${data.task.id} (${data.task.component})` : s.none}`);
      out(`  ${s.gate}: ${data.gate ?? s.none}`);
      out(`  ${s.blocks}: ${blockers.join(' · ') || s.none}`);
      out(`  ${s.cost}: ${s.notAvailable}`);
      return OK;
    }

    case 'new-spec': {
      const name = rest.join(' ');
      if (!name) return refuse(USAGE_TEXT);
      let compId = flags.component;
      if (!compId) {
        if (componentIds.length !== 1) return refuse(t.spec.componentRequired(componentIds));
        compId = componentIds[0];
      }
      const comp = settings.components[compId];
      if (!comp) return refuse(t.spec.unknownComponent(compId, componentIds));
      const id = nextSpecId(root, comp.id_prefix ?? 'SPEC', slugify(name), specRoots(settings));
      const specsDir = specsDirFor(settings, compId);
      const p = specPaths(root, id, { specs: { [id]: { dir: `${specsDir}/${id}` } } });
      mkdirSync(p.dir, { recursive: true });
      writeFileSync(p.spec, readTemplate(root, 'spec').replace(/<(PREFIX|PREFIJO)>-<NNN>/g, id.split('-').slice(0, 2).join('-')).replace(/<(name|nombre)>/, name));
      writeFileSync(p.progress, readTemplate(root, 'progress').replace(/<(PREFIX|PREFIJO)>-<NNN>/g, id.split('-').slice(0, 2).join('-')));
      state.activeSpec = id;
      state.specs[id] = { phase: 'spec', approved: [], component: compId, change: false, dir: path.relative(root, p.dir).split(path.sep).join('/') };
      logEvent(state, 'spec-created', { id });
      save();
      out(t.spec.created(id, path.relative(root, p.spec).split(path.sep).join('/')));
      return OK;
    }

    case 'new-adr': {
      const name = rest.join(' ');
      if (!name) return refuse(USAGE_TEXT);
      // ADRs live in the repository of the active spec (RF-TOP-02).
      const specRepo = state.activeSpec ? path.posix.dirname(path.posix.dirname(specDirOf(state, state.activeSpec))) : '.';
      const rel = nextAdrFile(root, slugify(name), specRepo === '.' ? 'docs/decisions' : `${specRepo}/docs/decisions`);
      mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      const n = /ADR-(\d{4})/.exec(rel)[1];
      writeFileSync(path.join(root, rel), readTemplate(root, 'adr').replace(/<NNNN>/, n).replace(/<(title|título)>/, name).replace(/<(PREFIX|PREFIJO)>-<NNN>/, state.activeSpec ?? '—'));
      out(t.spec.adrCreated(rel));
      return OK;
    }

    case 'gate': {
      if (rest[0] === 'status') {
        out(JSON.stringify(state.gate, null, 2));
        return OK;
      }
      if (rest[0] !== 'request' || !rest[1]) return refuse(USAGE_TEXT);
      const files = (flags.files ?? '').split(',').map((s) => s.trim().replace(/\\/g, '/')).filter(Boolean);
      const r = requestGate(state, { kind: rest[1], files, adr: flags.adr, summary: flags.summary, option: flags.option });
      if (!r.ok) return refuse(t.gate[r.code](r.params ?? {}));
      Object.assign(state, r.state);
      save();
      out(t.gate.requested(rest[1]));
      return OK;
    }

    case 'next': {
      if (state.gate) return refuse(t.next.gatePending(state.gate.kind));
      if (state.triage) return refuse(t.next.triage(state.triage.task));
      if (state.task) return refuse(state.task.verify?.status === 'pass' && !state.task.manualApproved ? t.next.manualPending(state.task.id) : t.next.inProgress(state.task.id));
      if (!state.activeSpec) return refuse(t.next.noSpec());
      const spec = state.specs[state.activeSpec] ?? { approved: [] };
      if (!spec.approved?.includes('tasks')) return refuse(t.next.tasksNotApproved());
      const file = specPaths(root, state.activeSpec, state).tasks;
      const tasks = parseTasks(read(file));
      if (!tasks.length) return refuse(t.next.noTasks(path.relative(root, file)));
      const task = selectNextTask(tasks);
      if (!task) {
        spec.phase = 'validate';
        save();
        out(t.next.allDone());
        return OK;
      }
      const problems = taskProblems(task, settings.components);
      if (problems.length) return refuse(t.next.problems(task.id, problems));
      const comp = settings.components[task.component];
      if (!comp.verify || !Object.keys(comp.verify).length) return refuse(t.next.noVerify(task.component));
      const role = roleFor(comp.kind);
      state.task = {
        id: task.id, title: task.title, spec: state.activeSpec, component: task.component, role,
        scope: task.scope, requirements: task.requirements, doneWhen: task.doneWhen, story: task.story ?? null,
        started: new Date().toISOString(), dirty: false, verify: null, manualApproved: false,
      };
      state.granted = [];
      logEvent(state, 'task-started', { task: task.id });
      save();
      out(t.next.started(task, role));
      return OK;
    }

    case 'verify': {
      const compId = flags.component ?? state.task?.component;
      if (!compId || !settings.components[compId]) return refuse(t.gate.noTask());
      const result = runVerify(root, { path: settings.components[compId].path, ...settings.components[compId] }, { quick: flags.quick, run: io.run });
      for (const r of result.results) out(`$ ${r.command}  → ${r.code === 0 ? 'ok' : `exit ${r.code}`}${r.code === 0 ? '' : `\n${r.output}`}`);
      if (result.status === 'unconfigured') return refuse(t.verify.unconfigured(compId));
      if (!state.task || flags.quick) return result.status === 'pass' ? OK : REFUSED;
      if (result.status === 'pass') {
        state.task.verify = { status: 'pass', at: new Date().toISOString() };
        state.task.dirty = false;
        logEvent(state, 'verify-pass', { task: state.task.id });
        save();
        out(t.verify.pass(compId));
        return OK;
      }
      // RF-RET-07: the attempt counter is kept by this script, not by the model.
      const retries = loadRetries(root);
      const { state: nextRetries, verdict } = recordFailure(retries, { task: state.task.id, signature: result.signature, max: settings.retries.in_scope });
      saveRetries(root, nextRetries);
      state.task.verify = { status: 'fail', failing: result.failing, signature: result.signature, at: new Date().toISOString() };
      if (verdict.decision === 'triage') state.triage = { task: state.task.id, reason: verdict.kind, started: new Date().toISOString() };
      logEvent(state, 'verify-fail', { task: state.task.id, decision: verdict.decision });
      save();
      io.stderr.write(`${t.verify.fail(result.failing, verdict)}\n`);
      return REFUSED;
    }

    case 'task': {
      const id = rest[1];
      if (rest[0] !== 'done' || !id) return refuse(USAGE_TEXT);
      if (!state.task || state.task.id !== id) return refuse(t.done.notCurrent(id));
      if (state.task.verify?.status !== 'pass' || state.task.dirty) return refuse(t.done.needsVerify());
      const file = specPaths(root, state.activeSpec, state).tasks;
      const text = read(file) ?? '';
      const tasks = parseTasks(text);
      // RF-GAT-14: with story or spec granularity the manual test comes when the group is complete.
      const remaining = tasks.filter((x) => !x.done && x.id !== id);
      const groupDone = settings.manualTest === 'task'
        || (settings.manualTest === 'spec' && remaining.length === 0)
        || (settings.manualTest === 'story' && !remaining.some((x) => (x.story ?? null) === (state.task.story ?? null)));
      if (groupDone && !state.task.manualApproved) return refuse(t.done.needsManual());
      writeFileSync(file, markTaskDone(text, id));
      const retries = loadRetries(root);
      saveRetries(root, resetTask(retries, id));
      logEvent(state, 'task-done', { task: id });
      state.task = null;
      state.granted = [];
      if (!remaining.length) state.specs[state.activeSpec].phase = 'validate';
      save();
      out(t.done.done(id));
      return OK;
    }

    case 'triage': {
      if (rest[0] !== 'start') return refuse(USAGE_TEXT);
      if (state.triage) return refuse(t.triage.already());
      state.triage = { task: state.task?.id ?? null, reason: flags.summary ?? 'agent', started: new Date().toISOString() };
      logEvent(state, 'triage-started', { task: state.triage.task });
      save();
      out(t.triage.started());
      return OK;
    }

    case 'change': {
      if (rest[0] !== 'start') return refuse(USAGE_TEXT);
      if (!state.activeSpec) return refuse(t.next.noSpec());
      state.specs[state.activeSpec] = { phase: 'spec', approved: [], ...state.specs[state.activeSpec], change: true };
      logEvent(state, 'change-started', {});
      save();
      out(t.change.started(state.activeSpec));
      return OK;
    }

    case 'validate': {
      if (!state.activeSpec) return refuse(t.next.noSpec());
      const reqs = parseRequirements(read(specPaths(root, state.activeSpec, state).spec)).filter((r) => r.id.startsWith('RF'));
      const index = testIndex(root, settings);
      const rows = reqs.map((r) => ({ id: r.id, tests: index.filter((f) => f.ids.has(r.id)).map((f) => f.file) }));
      if (flags.json) {
        out(JSON.stringify({ spec: state.activeSpec, requirements: rows }, null, 2));
      } else {
        for (const r of rows) out(r.tests.length ? t.validate.covered(r.id, r.tests) : t.validate.uncovered(r.id));
        out(t.validate.summary(rows.filter((r) => r.tests.length).length, rows.length));
      }
      return rows.every((r) => r.tests.length) ? OK : REFUSED;
    }

    case 'contract': {
      // RF-TOP-06: snapshot of a provider contract in the active spec.
      if (rest[0] !== 'import' || !rest[1] || !state.activeSpec) return refuse(USAGE_TEXT);
      const r = importContract(root, settings, { ref: rest[1], file: flags.file, targetDir: specPaths(root, state.activeSpec, state).dir });
      if (!r.ok) return refuse(t.contract[r.code](r.params ?? {}));
      out(t.contract.imported(r.snapshot, r.source));
      return OK;
    }

    case 'tracker': {
      // Any tracker: the agent reads and writes its items through the tracker's
      // MCP; this script decides what changes and applies the local side.
      const provider = settings.tracker?.provider;
      if (!provider) return refuse(t.tracker.disabled);
      const readInput = async () => {
        const raw = flags.file ? readFileSync(path.resolve(io.cwd, flags.file), 'utf8') : await (io.readStdin?.() ?? '');
        return JSON.parse(raw || '{}');
      };
      const baseFile = path.join(root, '.harness', 'state', 'tracker.json');
      const base = (() => { try { return JSON.parse(readFileSync(baseFile, 'utf8')); } catch { return { specs: {}, at: null }; } })();
      const specs = listSpecs(root, specRoots(settings)).filter((s) => existsSync(path.join(root, s.dir, 'tasks.md')));

      if (rest[0] === 'plan') {
        let remote;
        try {
          remote = await readInput();
        } catch (e) {
          return refuse(t.tracker.badInput(e.message));
        }
        const plans = {};
        let creates = 0;
        let updates = 0;
        for (const s of specs) {
          const tasks = linkedTasks(read(path.join(root, s.dir, 'tasks.md')));
          const items = (Array.isArray(remote) ? (s.id === state.activeSpec ? remote : []) : remote[s.id] ?? []).map((r) => ({ key: String(r.key), title: String(r.title ?? ''), done: Boolean(r.done) }));
          const plan = planSync({ tasks, remote: items, base: base.specs?.[s.id] ?? {} });
          if (![plan.create, plan.push, plan.pull, plan.conflicts, plan.missing, plan.proposals].some((l) => l.length)) continue;
          plans[s.id] = plan;
          creates += plan.create.length;
          updates += plan.push.length + plan.conflicts.length;
          out(t.tracker.spec(s.id));
          plan.create.forEach((x) => out(t.tracker.create(x)));
          plan.push.forEach((x) => out(t.tracker.push(x)));
          plan.pull.forEach((x) => out(t.tracker.pull(x)));
          plan.conflicts.forEach((x) => out(t.tracker.conflict(x)));
          plan.missing.forEach((x) => out(t.tracker.missing(x)));
          plan.proposals.forEach((x) => out(t.tracker.proposal(x)));
        }
        if (!Object.keys(plans).length) {
          state.trackerPlan = null;
          save();
          out(t.tracker.nothing);
          return OK;
        }
        state.trackerPlan = { provider, specs: plans, remoteWrites: creates + updates, approved: false };
        save();
        out(creates + updates ? t.tracker.needsGate(creates, updates) : t.tracker.localOnly);
        return OK;
      }

      if (rest[0] === 'apply') {
        const tp = state.trackerPlan;
        if (!tp) return refuse(t.tracker.noPlan);
        // RF-TRK-08: nothing was written to the tracker without the user's approval.
        if (tp.remoteWrites && !tp.approved) return refuse(t.tracker.notApproved);
        let decisions;
        try {
          decisions = await readInput();
        } catch (e) {
          return refuse(t.tracker.badInput(e.message));
        }
        let changed = 0;
        for (const s of specs.filter((x) => tp.specs[x.id])) {
          const file = path.join(root, s.dir, 'tasks.md');
          const text = read(file);
          const r = applyLocal(text, tp.specs[s.id], { provider: tp.provider, ...(decisions[s.id] ?? {}), base: base.specs?.[s.id] ?? {} });
          if (r.text !== text) { writeFileSync(file, r.text); changed += 1; }
          base.specs = { ...base.specs, [s.id]: r.base };
        }
        base.at = new Date().toISOString();
        mkdirSync(path.dirname(baseFile), { recursive: true });
        writeFileSync(baseFile, JSON.stringify(base, null, 2) + '\n');
        state.trackerPlan = null;
        logEvent(state, 'tracker-synced', { provider: tp.provider });
        save();
        out(t.tracker.applied(changed));
        return OK;
      }
      return refuse(USAGE_TEXT);
    }

    case 'commit-context': {
      out(JSON.stringify(commitContext(root, settings, state), null, 2));
      return OK;
    }

    case 'lint': {
      const kind = rest[0];
      const file = rest[1] ? path.resolve(io.cwd, rest[1]) : kind === 'constitution' ? path.join(root, 'docs', 'constitution.md') : state.activeSpec ? specPaths(root, state.activeSpec, state)[kind] : null;
      const text = file && read(file);
      if (!text) return refuse(USAGE_TEXT);
      const result = kind === 'spec' ? lintSpec(text) : kind === 'tasks' ? lintTasks(text, settings.components) : kind === 'constitution' ? lintConstitution(text) : null;
      if (!result) return refuse(USAGE_TEXT);
      out(JSON.stringify(result, null, 2));
      return result.problems.length ? REFUSED : OK;
    }

    default:
      io.stderr.write(`${USAGE_TEXT}\n`);
      return USAGE;
  }
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'coverage', 'vendor', '.harness', 'target', '.venv', 'venv']);
const TEST_GLOBS = ['**/*.test.*', '**/*.spec.*', '**/tests/**', '**/test/**', '**/__tests__/**', '**/e2e/**', '**/test_*.py', '**/*_test.go'];

/** Test files and the requirement IDs they mention (RF-SDD-14/15). */
function testIndex(root, settings) {
  const out = [];
  const dirs = [...new Set(Object.values(settings.components).map((c) => String(c.path ?? '.')))];
  const seen = new Set();
  const walk = (dir, depth) => {
    if (depth > 12) return;
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) walk(full, depth + 1);
        continue;
      }
      const rel = path.relative(root, full).split(path.sep).join('/');
      if (seen.has(rel) || !matchesAny(rel, TEST_GLOBS)) continue;
      seen.add(rel);
      const ids = new Set((read(full) ?? '').match(/\b(?:[A-Z][A-Z0-9]*-)?RF-[A-Z0-9-]*\d+\b/g)?.map((m) => m.replace(/^.*?(RF-)/, 'RF-')) ?? []);
      if (ids.size) out.push({ file: rel, ids });
    }
  };
  for (const d of dirs) walk(path.resolve(root, d), 0);
  return out;
}

/** RF-GAT-03/04, RF-TOP-11: what changed, repository by repository. */
function commitContext(root, settings, state) {
  const repos = new Set(['.']);
  if (['multi-repo', 'workspace'].includes(settings.topology)) {
    for (const c of Object.values(settings.components)) if (existsSync(path.join(root, c.path ?? '.', '.git'))) repos.add(c.path);
  }
  const doneTasks = parseTasks(read(state.activeSpec ? specPaths(root, state.activeSpec, state).tasks : '') ?? '').filter((x) => x.done).map((x) => `${x.id} ${x.title}`);
  return {
    convention: settings.commits?.convention ?? 'conventional',
    language: settings.commits?.language ?? 'en',
    spec: state.activeSpec,
    tasksDone: doneTasks,
    repositories: [...repos].map((repo) => {
      const r = spawnSync('git', ['status', '--porcelain'], { cwd: path.resolve(root, repo), encoding: 'utf8', windowsHide: true });
      const files = (r.stdout ?? '').split(/\r?\n/).filter(Boolean).map((l) => l.slice(3));
      return { repo, files: repo === '.' ? files.filter((f) => ![...repos].some((x) => x !== '.' && f.startsWith(`${x}/`))) : files };
    }).filter((r) => r.files.length),
    note: 'Propose one commit message per repository. Never run git commit: the user commits.',
  };
}

if (isMainModule(import.meta.url)) {
  const readStdin = () => new Promise((resolve, reject) => {
    if (process.stdin.isTTY) return resolve('');
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
  runSdd(process.argv.slice(2), { stdout: process.stdout, stderr: process.stderr, cwd: process.cwd(), env: process.env, readStdin }).then((code) => { process.exitCode = code; });
}
