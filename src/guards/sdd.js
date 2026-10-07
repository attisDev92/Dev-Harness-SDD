#!/usr/bin/env node
// sdd.js: helpers of the SDD flow that the agent runs (pre-allowed, never
// needed by the user). State lives in the markdown files: the `status` of
// spec.md and the checkboxes of tasks.md (RF-SDD-18). Dependency-free.
//
// Exit codes: 0 ok, 2 refused (reason on stderr), 1 usage error.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { parseArgs, isMainModule } from './args.js';
import { findProjectRoot, loadGuardSettings } from './project.js';
import { loadRuntime, saveRuntime, logEvent, readFlow, approveStop, withStatus, safeRead, STOPS } from './state.js';
import { importContract } from './contracts.js';
import { listSpecs, specsDirFor, specRoots, nextSpecId, usedSpecNumbers, branchSpecNumbers, nextAdrFile, slugify, parseTasks, taskQueue, taskProblems, parseRequirements } from './tasks.js';
import { runVerify, VERIFY_ORDER } from './verify.js';
import { runtimeMessages } from './runtime-messages.js';
import { matchesAny } from './glob.js';
import { linkedTasks, planSync, applyLocal } from './tracker-sync.js';
import { statusData, statusLines } from './status.js';

const OK = 0;
const USAGE = 1;
const REFUSED = 2;

const USAGE_TEXT = `usage: sdd.js <command>
  status [--json]                 what happened and what comes next
  new-spec <name> [--component c] [--id NNN]
                                  create specs/<PREFIX>-<NNN>-<name>/spec.md (--component only with specs.location per-repo;
                                  --id fixes the number, agreed beforehand when several developers create specs on other branches)
  new-adr <name>                  create docs/decisions/ADR-<NNNN>-<name>.md
  stop <spec|plan>                ask the user to approve; their "yes" is recorded by the hook
  approve                         record the pending stop (when the user chose "Approve" in a question)
  next                            tasks that can start now, one per component, at most 2 at once
  verify [--component c] [--eval] run the verification (all components without --component);
                                  --eval runs only verify.eval, once when a story closes
  validate [--json]               requirement → test coverage; closes the spec when every task is done
  contract import <repo#SPEC> [--file f]  snapshot a provider contract into the active spec
  tracker plan|apply [--file f]   sync tasks.md with the tracker (JSON on stdin)
  commit-context                  changes per repository, to propose the commit`;

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

const rel = (root, p) => path.relative(root, p).split(path.sep).join('/');

/**
 * @param {string[]} argv
 * @param {{ stdout: { write(s: string): void }, stderr: { write(s: string): void }, cwd: string, env: object, run?: Function, readStdin?: () => Promise<string> }} io
 */
export async function runSdd(argv, io) {
  const { flags, positional } = parseArgs(argv, { string: ['component', 'file', 'id'], boolean: ['json', 'eval'] });
  const [command, ...rest] = positional;
  const root = findProjectRoot(io.cwd);
  const out = (s) => io.stdout.write(`${s}\n`);
  const refuse = (s) => {
    io.stderr.write(`${s}\n`);
    return REFUSED;
  };
  if (!root) return refuse('This project is not activated (no harness.config.yaml). Run "sdd-harness-init" first.');
  const settings = loadGuardSettings(root);
  const t = runtimeMessages();
  const runtime = loadRuntime(root);
  const save = () => saveRuntime(root, runtime);
  const flow = readFlow(root, settings);
  const componentIds = Object.keys(settings.components);

  // AI evaluations: informative, outside the verification loop and its retries.
  const runEvals = (ids) => {
    const targets = ids.filter((id) => settings.components[id].verify?.eval);
    if (!targets.length) {
      out(t.verify.noEval());
      return OK;
    }
    let failed = false;
    for (const id of targets) {
      const result = runVerify(root, settings.components[id], { evals: true, run: io.run });
      for (const r of result.results) out(`$ ${r.command}  → ${r.code === 0 ? 'ok' : `exit ${r.code}`}\n${r.output}`);
      if (result.status === 'fail') failed = true;
      out(result.status === 'pass' ? t.verify.evalPass(id) : t.verify.evalFail(id));
      logEvent(root, 'eval', { component: id, status: result.status });
    }
    return failed ? REFUSED : OK;
  };

  switch (command) {
    case 'status': {
      if (flags.json) {
        out(JSON.stringify(statusData(root, settings, flow, runtime), null, 2));
        return OK;
      }
      out(t.status.title);
      statusLines(root, settings, flow, runtime).forEach(out);
      return OK;
    }

    case 'new-spec': {
      const name = rest.join(' ');
      if (!name) return refuse(USAGE_TEXT);
      // A spec belongs to no component (its tasks do); the component only picks the repo when specs live per repo.
      let compId = flags.component;
      if (!compId && settings.specs.location === 'per-repo' && ['multi-repo', 'workspace'].includes(settings.topology)) {
        if (componentIds.length !== 1) return refuse(t.spec.componentRequired(componentIds));
        compId = componentIds[0];
      }
      const comp = compId ? settings.components[compId] : null;
      if (compId && !comp) return refuse(t.spec.unknownComponent(compId, componentIds));
      const prefix = comp?.id_prefix ?? settings.specs.idPrefix;
      const local = usedSpecNumbers(root, prefix, specRoots(settings));
      // Numbers on other branches: skipped when picking the next one, an alert when fixed with --id.
      const elsewhere = branchSpecNumbers(root, prefix, specRoots(settings));
      for (const n of local) elsewhere.delete(n);
      const short = (n) => `${prefix}-${String(n).padStart(3, '0')}`;
      let number;
      if (flags.id !== undefined) {
        if (!/^\d{1,3}$/.test(flags.id) || Number(flags.id) === 0) return refuse(t.spec.idInvalid(flags.id));
        number = Number(flags.id);
        if (local.includes(number)) return refuse(t.spec.idTaken(short(number)));
      }
      const id = nextSpecId(root, prefix, slugify(name), specRoots(settings), number, [...elsewhere.keys()]);
      const dir = path.join(root, specsDirFor(settings, compId), id);
      const shortId = id.split('-').slice(0, 2).join('-');
      mkdirSync(dir, { recursive: true });
      const spec = readTemplate(root, 'spec').replace(/<(PREFIX|PREFIJO)>-<NNN>/g, shortId).replace(/<(name|nombre)>/, name);
      writeFileSync(path.join(dir, 'spec.md'), withStatus(spec, 'draft'));
      writeFileSync(path.join(dir, 'progress.md'), readTemplate(root, 'progress').replace(/<(PREFIX|PREFIJO)>-<NNN>/g, shortId));
      logEvent(root, 'spec-created', { id });
      out(t.spec.created(id, rel(root, path.join(dir, 'spec.md'))));
      if (number !== undefined && elsewhere.has(number)) out(t.spec.idOnBranch(short(number), elsewhere.get(number)));
      const skipped = [...elsewhere].filter(([n]) => number === undefined && n > Math.max(0, ...local)).sort(([a], [b]) => a - b);
      if (skipped.length) out(t.spec.skipped(skipped.map(([n, ref]) => `${short(n)} (${ref})`)));
      return OK;
    }

    case 'new-adr': {
      const name = rest.join(' ');
      if (!name) return refuse(USAGE_TEXT);
      // ADRs live in the repository of the active spec (RF-TOP-02).
      const specRepo = flow.spec ? path.posix.dirname(path.posix.dirname(flow.spec.dir)) : '.';
      const file = nextAdrFile(root, slugify(name), specRepo === '.' ? 'docs/decisions' : `${specRepo}/docs/decisions`);
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      const n = /ADR-(\d{4})/.exec(file)[1];
      writeFileSync(path.join(root, file), readTemplate(root, 'adr').replace(/<NNNN>/, n).replace(/<(title|título)>/, name).replace(/<(PREFIX|PREFIJO)>-<NNN>/, flow.spec?.id ?? '—'));
      out(t.spec.adrCreated(file));
      return OK;
    }

    case 'stop': {
      const stop = rest[0];
      if (!STOPS[stop]) return refuse(t.stop.unknown(stop ?? ''));
      if (!flow.spec) return refuse(t.next.noSpec());
      runtime.pending = { spec: flow.spec.id, stop, at: new Date().toISOString() };
      save();
      logEvent(root, 'stop-requested', { spec: flow.spec.id, stop });
      out(t.stop.requested(stop, flow.spec.id));
      return OK;
    }

    case 'approve': {
      const pending = runtime.pending;
      if (!pending || !flow.spec || pending.spec !== flow.spec.id) return refuse(t.stop.nothingPending());
      approveStop(root, flow.spec, pending.stop);
      runtime.pending = null;
      save();
      logEvent(root, 'stop-approved', { spec: pending.spec, stop: pending.stop });
      out(t.stop.approved(pending.stop, pending.spec));
      return OK;
    }

    case 'next': {
      // Informative: what can start now. Tasks of different components run in parallel, at most MAX_PARALLEL.
      if (!flow.spec) return refuse(t.next.noSpec());
      if (flow.spec.status !== 'plan-approved') return refuse(t.next.notApproved(flow.spec.status));
      if (!flow.tasks.length) return refuse(t.next.noTasks(`${flow.spec.dir}/tasks.md`));
      const { ready, queued, waiting } = taskQueue(flow.tasks);
      if (!ready.length && !queued.length && !waiting.length) {
        out(t.next.allDone());
        return OK;
      }
      for (const task of ready) {
        const problems = taskProblems(task, settings.components);
        if (problems.length) {
          out(t.next.problems(task.id, problems));
          continue;
        }
        const comp = settings.components[task.component];
        out(t.next.ready(task, roleFor(comp.kind)));
        if (!VERIFY_ORDER.some((k) => comp.verify?.[k])) out(`  ${t.next.noVerify(task.component)}`);
      }
      if (ready.length) out(t.next.parallel());
      if (queued.length) out(t.next.queued(queued.map((x) => x.id)));
      if (waiting.length) out(t.next.waiting(waiting));
      return OK;
    }

    case 'verify': {
      if (flags.component && !settings.components[flags.component]) return refuse(t.verify.pickComponent(componentIds));
      if (flags.eval) return runEvals(flags.component ? [flags.component] : componentIds);
      const targets = flags.component ? [flags.component] : componentIds;
      let failed = false;
      for (const id of targets) {
        const result = runVerify(root, settings.components[id], { run: io.run });
        for (const r of result.results) out(`$ ${r.command}  → ${r.code === 0 ? 'ok' : `exit ${r.code}`}${r.code === 0 ? '' : `\n${r.output}`}`);
        if (result.status === 'unconfigured') {
          if (flags.component) return refuse(t.verify.unconfigured(id));
          continue;
        }
        const at = new Date().toISOString();
        if (result.status === 'pass') {
          runtime.verify[id] = { status: 'pass', at };
          out(t.verify.pass(id));
        } else {
          failed = true;
          runtime.verify[id] = { status: 'fail', command: result.failing.command, at };
          io.stderr.write(`${t.verify.fail(result.failing)}\n`);
        }
        logEvent(root, 'verify', { component: id, status: result.status });
      }
      save();
      return failed ? REFUSED : OK;
    }

    case 'validate': {
      if (!flow.spec) return refuse(t.next.noSpec());
      const reqs = parseRequirements(safeRead(path.join(root, flow.spec.dir, 'spec.md'))).filter((r) => r.id.startsWith('RF'));
      const index = testIndex(root, settings);
      const rows = reqs.map((r) => ({ id: r.id, tests: index.filter((f) => f.ids.has(r.id)).map((f) => f.file) }));
      const allDone = flow.tasks.length > 0 && flow.tasks.every((x) => x.done);
      if (allDone && flow.spec.status === 'plan-approved') {
        const file = path.join(root, flow.spec.dir, 'spec.md');
        writeFileSync(file, withStatus(readFileSync(file, 'utf8'), 'done'));
        logEvent(root, 'spec-done', { spec: flow.spec.id });
      }
      if (flags.json) {
        out(JSON.stringify({ spec: flow.spec.id, requirements: rows, closed: allDone }, null, 2));
      } else {
        for (const r of rows) out(r.tests.length ? t.validate.covered(r.id, r.tests) : t.validate.uncovered(r.id));
        out(t.validate.summary(rows.filter((r) => r.tests.length).length, rows.length));
        if (allDone) out(t.validate.closed(flow.spec.id));
      }
      return rows.every((r) => r.tests.length) ? OK : REFUSED;
    }

    case 'contract': {
      // RF-TOP-06: snapshot of a provider contract in the active spec.
      if (rest[0] !== 'import' || !rest[1] || !flow.spec) return refuse(USAGE_TEXT);
      const r = importContract(root, settings, { ref: rest[1], file: flags.file, targetDir: path.join(root, flow.spec.dir) });
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
          const tasks = linkedTasks(safeRead(path.join(root, s.dir, 'tasks.md')));
          const items = (Array.isArray(remote) ? (s.id === flow.spec?.id ? remote : []) : remote[s.id] ?? []).map((r) => ({ key: String(r.key), title: String(r.title ?? ''), done: Boolean(r.done) }));
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
        runtime.trackerPlan = Object.keys(plans).length ? { provider, specs: plans } : null;
        save();
        if (!runtime.trackerPlan) {
          out(t.tracker.nothing);
          return OK;
        }
        // RF-TRK-08: nothing is written to the tracker until the user says yes in the conversation.
        out(creates + updates ? t.tracker.needsOk(creates, updates) : t.tracker.localOnly);
        return OK;
      }

      if (rest[0] === 'apply') {
        const tp = runtime.trackerPlan;
        if (!tp) return refuse(t.tracker.noPlan);
        let decisions;
        try {
          decisions = await readInput();
        } catch (e) {
          return refuse(t.tracker.badInput(e.message));
        }
        let changed = 0;
        for (const s of specs.filter((x) => tp.specs[x.id])) {
          const file = path.join(root, s.dir, 'tasks.md');
          const text = safeRead(file);
          const r = applyLocal(text, tp.specs[s.id], { provider: tp.provider, ...(decisions[s.id] ?? {}), base: base.specs?.[s.id] ?? {} });
          if (r.text !== text) { writeFileSync(file, r.text); changed += 1; }
          base.specs = { ...base.specs, [s.id]: r.base };
        }
        base.at = new Date().toISOString();
        mkdirSync(path.dirname(baseFile), { recursive: true });
        writeFileSync(baseFile, JSON.stringify(base, null, 2) + '\n');
        runtime.trackerPlan = null;
        save();
        logEvent(root, 'tracker-synced', { provider: tp.provider });
        out(t.tracker.applied(changed));
        return OK;
      }
      return refuse(USAGE_TEXT);
    }

    case 'commit-context': {
      out(JSON.stringify(commitContext(root, settings, flow), null, 2));
      return OK;
    }

    default:
      io.stderr.write(`${USAGE_TEXT}\n`);
      return USAGE;
  }
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'coverage', 'vendor', '.harness', 'target', '.venv', 'venv']);
const TEST_GLOBS = ['**/*.test.*', '**/*.spec.*', '**/tests/**', '**/test/**', '**/__tests__/**', '**/e2e/**', '**/evals/**', '**/*.eval.*', '**/test_*.py', '**/*_test.go'];

/** Test files and the requirement IDs they mention (RF-SDD-14/15). */
function testIndex(root, settings) {
  const found = [];
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
      const file = rel(root, full);
      if (seen.has(file) || !matchesAny(file, TEST_GLOBS)) continue;
      seen.add(file);
      const idSet = new Set((safeRead(full) ?? '').match(/\b(?:[A-Z][A-Z0-9]*-)?RF-[A-Z0-9-]*\d+\b/g)?.map((m) => m.replace(/^.*?(RF-)/, 'RF-')) ?? []);
      if (idSet.size) found.push({ file, ids: idSet });
    }
  };
  for (const d of dirs) walk(path.resolve(root, d), 0);
  return found;
}

/** RF-GAT-03/04, RF-TOP-11: what changed, repository by repository. */
function commitContext(root, settings, flow) {
  const repos = new Set(['.']);
  if (['multi-repo', 'workspace'].includes(settings.topology)) {
    for (const c of Object.values(settings.components)) if (existsSync(path.join(root, c.path ?? '.', '.git'))) repos.add(c.path);
  }
  return {
    convention: settings.commits?.convention ?? 'conventional',
    language: settings.commits?.language ?? 'en',
    spec: flow.spec?.id ?? null,
    tasksDone: flow.tasks.filter((x) => x.done).map((x) => `${x.id} ${x.title}`),
    repositories: [...repos].map((repo) => {
      const r = spawnSync('git', ['status', '--porcelain'], { cwd: path.resolve(root, repo), encoding: 'utf8', windowsHide: true });
      const files = (r.stdout ?? '').split(/\r?\n/).filter(Boolean).map((l) => l.slice(3));
      return { repo, files: repo === '.' ? files.filter((f) => ![...repos].some((x) => x !== '.' && f.startsWith(`${x}/`))) : files };
    }).filter((r) => r.files.length),
    note: 'Propose one commit per repository. Commit (git add + git commit) only after the user says yes; never push.',
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
