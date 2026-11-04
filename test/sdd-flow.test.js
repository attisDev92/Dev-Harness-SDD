// The whole flow through sdd.js and the Claude Code hooks, on a real project
// (RF-SDD-*, RF-ORQ-*, RF-GAT-*, RF-DOM-03/04, RF-VER-01/02).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import { runSdd } from '../src/guards/sdd.js';
import { handleHook } from '../src/guards/hook.js';
import { loadRuntime, specStatus } from '../src/guards/state.js';
import { parseDecision } from '../src/guards/flow.js';
import { parseTasks, taskQueue, MAX_PARALLEL } from '../src/guards/tasks.js';
import { run, write, git } from './fixtures.js';
import { tempDir } from './helpers.js';

const CONFIG = `harness_version: 0.8.0
install_mode: local
cli: {language: en}
tools: [claude-code]
language: {code: en, specs: en, docs: en, commits: en, ui: en}
topology: single
specs: {location: root, id_prefix: SVC}
components:
  svc: {path: ., kind: backend, stack: node, verify: {test: node check.js}}
git_hooks: {enabled: false}
gates: {manual_test: story, commits: per-story, deps: ask}
protected:
  db: ["**/migrations/**"]
`;

async function project(t, config = CONFIG, extra = {}) {
  const root = tempDir(t);
  write(root, {
    ...extra,
    'package.json': { name: 'svc', type: 'module' },
    // The "test suite": passes when pass.flag exists, fails otherwise.
    'check.js': "import fs from 'node:fs';\nif (!fs.existsSync('pass.flag')) { console.error('expected pass.flag'); process.exit(1); }\n",
    'src/index.js': 'export {};\n',
  });
  git(root, 'init', '-q');
  write(root, { 'preset.yaml': config });
  const r = await run(['init', '--config', 'preset.yaml', '--yes'], { cwd: root });
  assert.equal(r.code, 0, r.stderr);
  fs.rmSync(path.join(root, 'preset.yaml'));
  return root;
}

function sdd(root, ...argv) {
  let stdout = '';
  let stderr = '';
  return runSdd(argv, { stdout: { write: (s) => { stdout += s; } }, stderr: { write: (s) => { stderr += s; } }, cwd: root, env: {} })
    .then((code) => ({ code, stdout, stderr }));
}

const hook = (root, event, payload = {}, opts = {}) => handleHook(event, { cwd: root, session_id: 'S1', ...payload }, { env: {}, ...opts });
const writeTool = (root, file) => hook(root, 'PreToolUse', { tool_name: 'Write', tool_input: { file_path: path.join(root, file), content: 'x' } });
const say = (root, prompt) => hook(root, 'UserPromptSubmit', { prompt });
// Alerts reach the agent as context and the user as a message; they never block.
const alertOf = (r) => (r.stdout ? JSON.parse(r.stdout).systemMessage : undefined);
const specFile = (root, id) => path.join(root, 'specs', id, 'spec.md');
const statusOf = (root, id) => specStatus(fs.readFileSync(specFile(root, id), 'utf8'));

/** A spec with both stops approved by talking. */
async function approved(root, name = 'login') {
  const id = /Spec (\S+) creada/.exec((await sdd(root, 'new-spec', name)).stdout)[1];
  await sdd(root, 'stop', 'spec');
  say(root, 'sí');
  await sdd(root, 'stop', 'plan');
  say(root, 'continúa');
  assert.equal(statusOf(root, id), 'plan-approved');
  return id;
}

const TASKS = `# Tasks

- [ ] T1 Health endpoint · Requirements: RF-01 · Component: svc · Scope: \`src/**\` · Depends on: — · Done when: GET /health returns 200
- [ ] T2 Metrics · Requirements: RF-02 · Component: svc · Scope: \`src/metrics/**\` · Depends on: T1 · Done when: /metrics lists counters
`;

test('RF-GAT-08: answers in plain words; "yes, but…" is a change', () => {
  for (const yes of ['sí', 'Si, adelante', 'ok', 'OK!', 'continúa', 'Continua por favor', 'aprobado', 'dale', 'yes', 'go ahead', 'LGTM', '/sdd:approve']) {
    assert.equal(parseDecision(yes).approved, true, yes);
  }
  for (const no of ['sí, pero cambia el RF-02', 'añade el caso de error', 'no', 'y los errores?', 'okey, but add rate limiting', '/sdd:reject falta X']) {
    assert.equal(parseDecision(no).approved, false, no);
  }
});

test('new-spec skips the numbers used on other branches; --id on one of them is an alert', async (t) => {
  const root = await project(t);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'base');
  // Dev 2 creates SVC-001 on its own branch and commits it.
  git(root, 'checkout', '-q', '-b', 'dev2');
  await sdd(root, 'new-spec', 'pagos');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'spec');
  git(root, 'checkout', '-q', '-');
  assert.equal(fs.existsSync(path.join(root, 'specs/SVC-001-pagos')), false);
  // Dev 1, on the other branch, does not get SVC-001.
  const next = await sdd(root, 'new-spec', 'login');
  assert.match(next.stdout, /specs\/SVC-002-login\/spec\.md/);
  assert.match(next.stdout, /SVC-001 \(dev2\)/);
  const fixed = await sdd(root, 'new-spec', 'perfil', '--id', '1');
  assert.equal(fixed.code, 0);
  assert.match(fixed.stdout, /SVC-001 ya existe en la rama dev2/);
});

test('verify.eval: AI evaluations run only with --eval, never in the normal verify', async (t) => {
  const root = await project(t, CONFIG.replace('verify: {test: node check.js}', 'verify: {test: node check.js, eval: node eval.js}'), {
    'pass.flag': '',
    'eval.js': "import fs from 'node:fs';\nfs.appendFileSync('evals.log', 'run\\n');\nconsole.log('score 0.82');\n",
  });
  const ran = () => (fs.existsSync(path.join(root, 'evals.log')) ? fs.readFileSync(path.join(root, 'evals.log'), 'utf8').split('\n').filter(Boolean).length : 0);
  assert.equal((await sdd(root, 'verify')).code, 0);
  assert.equal(ran(), 0, 'the normal verify does not run the evaluations');
  const ev = await sdd(root, 'verify', '--eval');
  assert.equal(ev.code, 0, ev.stderr);
  assert.match(ev.stdout, /score 0\.82[\s\S]*Evaluaciones de svc: pasan/);
  assert.equal(ran(), 1);
  assert.match(fs.readFileSync(path.join(root, '.agents/skills/sdd/SKILL.md'), 'utf8'), /verify --eval/);
});

test('RF-SDD-13: two stops, approved by talking; the status lives in spec.md', async (t) => {
  const root = await project(t);
  // No spec, no task: an alert, never a block, and only once.
  const first = writeTool(root, 'src/app.js');
  assert.equal(first.code, 0);
  assert.match(alertOf(first), /no hay ninguna tarea pendiente/);
  assert.equal(writeTool(root, 'src/app.js').stdout, undefined, 'the same alert is not repeated');

  const created = await sdd(root, 'new-spec', 'Health check');
  assert.equal(created.code, 0, created.stderr);
  assert.match(created.stdout, /Spec SVC-001-health-check creada: specs\/SVC-001-health-check\/spec\.md/);
  const text = fs.readFileSync(specFile(root, 'SVC-001-health-check'), 'utf8');
  assert.match(text, /^---\nstatus: draft\n---\n\n# SVC-001 — Health check/);

  assert.match(alertOf(writeTool(root, 'specs/SVC-001-health-check/plan.md')), /la spec todavía no está aprobada/, 'plan before the spec: an alert');

  // Nothing pending: words are just words, and approve refuses.
  assert.equal(say(root, 'sí').stdout, undefined);
  assert.equal((await sdd(root, 'approve')).code, 2);

  assert.match((await sdd(root, 'stop', 'spec')).stdout, /Parada "spec" de SVC-001-health-check registrada/);
  assert.match(say(root, 'añade el caso de error').stdout, /no aprobó todavía spec/);
  assert.equal(statusOf(root, 'SVC-001-health-check'), 'draft');
  assert.match(say(root, 'sí, continúa').stdout, /El usuario APROBÓ spec de SVC-001-health-check/);
  assert.equal(statusOf(root, 'SVC-001-health-check'), 'spec-approved');
  assert.equal(loadRuntime(root).pending, null);

  // The second stop answered through AskUserQuestion: the agent records it.
  await sdd(root, 'stop', 'plan');
  const ok = await sdd(root, 'approve');
  assert.equal(ok.code, 0, ok.stderr);
  assert.match(ok.stdout, /Aprobado: plan de SVC-001-health-check/);
  assert.equal(statusOf(root, 'SVC-001-health-check'), 'plan-approved');
  assert.equal(writeTool(root, 'specs/SVC-001-health-check/spec.md').code, 0, 'an approved spec is updated like any document');
});

test('implementing: parallel list, verification, tasks that come up, validation', async (t) => {
  const root = await project(t);
  const spec = await approved(root);
  fs.writeFileSync(path.join(root, 'specs', spec, 'tasks.md'), TASKS);
  fs.writeFileSync(specFile(root, spec), `---\nstatus: plan-approved\n---\n- **RF-01:** WHEN GET /health is called, THE SYSTEM SHALL answer 200.\n- **RF-02:** THE SYSTEM SHALL expose counters.\n`);

  // RF-ORQ-02/03: what can start now, with its role; next is informative and never blocks.
  const next = await sdd(root, 'next');
  assert.equal(next.code, 0, next.stderr);
  assert.match(next.stdout, /T1 Health endpoint {2}→ {2}backend-dev \(svc\)\n {2}Alcance: src\/\*\*/);
  assert.match(next.stdout, /T2 espera a T1/);

  assert.equal(writeTool(root, 'src/health.js').stdout, undefined, 'inside the scope: nothing to say');
  assert.match(alertOf(writeTool(root, 'check.js')), /fuera del alcance de T1, T2/, 'outside the scope: an alert');

  // RF-VER-01: a failing verification is reminded once when the agent stops, never in a loop.
  const v = await sdd(root, 'verify');
  assert.equal(v.code, 2);
  assert.match(v.stderr, /hasta 2 intentos/);
  assert.match(hook(root, 'Stop').stderr, /La última verificación de svc falló \(node check.js\)/);
  assert.equal(hook(root, 'Stop').code, 0, 'reminded once');
  fs.writeFileSync(path.join(root, 'pass.flag'), '');
  assert.equal((await sdd(root, 'verify', '--component', 'svc')).code, 0);
  assert.equal(loadRuntime(root).verify.svc.status, 'pass');

  // The agent ticks T1 itself; T2 can start. Work that came up is added with just its component.
  const tasks = path.join(root, 'specs', spec, 'tasks.md');
  fs.writeFileSync(tasks, fs.readFileSync(tasks, 'utf8').replace('- [ ] T1', '- [x] T1') + '- [ ] T3 Cache headers (added during implementation) · Component: svc\n');
  const again = await sdd(root, 'next');
  assert.match(again.stdout, /T2 Metrics/);
  assert.doesNotMatch(again.stdout, /necesita arreglo/, 'a task with only its component is fine');
  const status = await sdd(root, 'status');
  assert.match(status.stdout, /Hechas \(1\/3\): T1 Health endpoint/);
  assert.match(status.stdout, /Añadidas en implementación: T3/);
  assert.match(status.stdout, /Última verificación svc: ok/);

  // RF-SDD-14/15: requirement → test coverage; the spec closes when every task is done.
  write(root, { 'src/health.test.js': "test('RF-01 health answers 200', () => {});\n" });
  fs.writeFileSync(tasks, fs.readFileSync(tasks, 'utf8').replace(/- \[ \]/g, '- [x]'));
  const val = await sdd(root, 'validate');
  assert.equal(val.code, 2);
  assert.match(val.stdout, /✔ RF-01: src\/health\.test\.js\n {2}✖ RF-02: sin ningún test\n1 de 2 requisitos/);
  assert.match(val.stdout, /la spec queda como "done"/);
  assert.equal(statusOf(root, spec), 'done');
});

test('frontend and backend tasks are listed together; a task waits only for its own dependency', async (t) => {
  const cfg = CONFIG.replace('topology: single', 'topology: monorepo').replace(
    '  svc: {path: ., kind: backend, stack: node, verify: {test: node check.js}}',
    '  api: {path: api, kind: backend, stack: node, verify: {test: node check.js}}\n  web: {path: web, kind: frontend, stack: node, verify: {test: node check.js}}',
  );
  const check = "import fs from 'node:fs';\nif (!fs.existsSync('pass.flag')) process.exit(1);\n";
  const root = await project(t, cfg, { 'api/package.json': { name: 'api', type: 'module' }, 'web/package.json': { name: 'web', type: 'module' }, 'api/check.js': check, 'web/check.js': check, 'api/src/a.js': '', 'web/src/w.js': '' });
  const spec = await approved(root);
  fs.writeFileSync(path.join(root, 'specs', spec, 'tasks.md'), `# Tasks

- [ ] T1 Login endpoint · Requirements: RF-01 · Component: api · Scope: \`src/**\` · Depends on: — · Done when: POST /login answers 200
- [ ] T2 Login screen · Requirements: RF-01 · Component: web · Scope: \`src/**\` · Depends on: — · Done when: the form renders against the contract
- [ ] T3 Connect the screen · Requirements: RF-01 · Component: web · Scope: \`src/**\` · Depends on: T1, T2 · Done when: the form calls the real endpoint
`);
  const next = await sdd(root, 'next');
  assert.equal(next.code, 0, next.stderr);
  assert.match(next.stdout, /T1 Login endpoint {2}→ {2}backend-dev[\s\S]*T2 Login screen {2}→ {2}frontend-dev/);
  assert.match(next.stdout, /Delégalas a la vez[^\n]*Máximo 2 subagentes/);
  assert.match(next.stdout, /T3 espera a T1, T2/);

  // Both write at the same time, each inside its own scope, with no alert.
  assert.equal(writeTool(root, 'api/src/login.js').stdout, undefined);
  assert.equal(writeTool(root, 'web/src/Login.jsx').stdout, undefined);

  // Verification per component; without --component every component runs.
  fs.writeFileSync(path.join(root, 'api/pass.flag'), '');
  assert.equal((await sdd(root, 'verify', '--component', 'api')).code, 0);
  assert.equal((await sdd(root, 'verify')).code, 2, 'web still fails');
  assert.deepEqual([loadRuntime(root).verify.api.status, loadRuntime(root).verify.web.status], ['pass', 'fail']);
});

test('RF-ORQ-02: never more than 2 tasks at once; the rest wait for a free slot, not for a dependency', () => {
  const tasks = parseTasks(`- [ ] T1 API · Component: api · Depends on: —
- [ ] T2 Screen · Component: web · Depends on: —
- [ ] T3 Jobs · Component: jobs · Depends on: —
- [ ] T4 Connect · Component: web · Depends on: T1
`);
  assert.equal(MAX_PARALLEL, 2);
  const q = taskQueue(tasks);
  assert.deepEqual([q.ready.map((x) => x.id), q.queued.map((x) => x.id), q.waiting.map((x) => x.task.id)], [['T1', 'T2'], ['T3'], ['T4']]);
  // One finishes: a slot frees up. Two running: nothing else starts.
  const running = { T1: tasks[0], T2: tasks[1] };
  assert.deepEqual(taskQueue(tasks, running).ready, []);
  assert.deepEqual(taskQueue(tasks, { T1: tasks[0] }).ready.map((x) => x.id), ['T2']);
});

test('RF-ORQ-02: a third subagent is warned about, not blocked', async (t) => {
  const root = await project(t);
  const launch = (id, role) => hook(root, 'PreToolUse', { tool_use_id: id, tool_name: 'Task', tool_input: { subagent_type: role, prompt: 'x' } }, { snapshot: () => ({}) });
  assert.equal(launch('a', 'backend-dev').stdout, undefined);
  assert.equal(launch('b', 'frontend-dev').stdout, undefined);
  const third = launch('c', 'qa-tester');
  assert.equal(third.code, 0);
  assert.match(alertOf(third), /lanzas qa-tester con 2 subagentes ya trabajando\. El máximo son 2 a la vez/);
  // A subagent that never reported back stops counting after an hour.
  const runtime = loadRuntime(root);
  for (const s of Object.values(runtime.subagents)) s.started = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  fs.writeFileSync(path.join(root, '.harness/state/runtime.json'), JSON.stringify(runtime));
  assert.equal(launch('d', 'reviewer').stdout, undefined);
});

test('RF-VER-02: a component without verification commands is pointed out, not blocked', async (t) => {
  const root = await project(t, CONFIG.replace(', verify: {test: node check.js}', ''));
  const spec = await approved(root);
  fs.writeFileSync(path.join(root, 'specs', spec, 'tasks.md'), TASKS);
  const next = await sdd(root, 'next');
  assert.equal(next.code, 0);
  assert.match(next.stdout, /no tiene comandos de verificación/);
});

test('RF-GAT-07: a schema change outside the approved data model alerts; an ADR only for structural decisions', async (t) => {
  const root = await project(t);
  const spec = await approved(root);
  fs.writeFileSync(path.join(root, 'specs', spec, 'tasks.md'), TASKS);
  const alerted = writeTool(root, 'src/migrations/001.sql');
  assert.equal(alerted.code, 0, 'a protected zone never blocks');
  assert.match(alertOf(alerted), /cambia el esquema.*modelo de datos de plan\.md.*new-adr.*solo si es una decisión estructural/s);
  const adr = await sdd(root, 'new-adr', 'Add health table');
  assert.match(adr.stdout, /docs\/decisions\/ADR-0001-add-health-table\.md/);
});

test('RF-GAT-09: harness.config.yaml can change at any moment and is synced right away', async (t) => {
  const root = await project(t);
  await approved(root);
  const pre = writeTool(root, 'harness.config.yaml');
  assert.deepEqual([pre.code, pre.stdout], [0, undefined], 'no gate: the tool asks natively');
  assert.equal(writeTool(root, '.harness/guards.json').code, 2, 'the harness itself stays blocked');
  let synced = 0;
  const post = hook(root, 'PostToolUse', { tool_name: 'Edit', tool_input: { file_path: path.join(root, 'harness.config.yaml') } }, { runSync: () => { synced += 1; return { ok: true, output: 'Applied 2 changes.' }; } });
  assert.equal(synced, 1);
  assert.match(alertOf(post), /se regeneró \(sdd-harness sync\)\.\nApplied 2 changes\./);
  const failed = hook(root, 'PostToolUse', { tool_name: 'Edit', tool_input: { file_path: path.join(root, 'harness.config.yaml') } }, { runSync: () => ({ ok: false, output: 'invalid field' }) });
  assert.match(alertOf(failed), /no se pudo regenerar la configuración: invalid field/);
});

test('RF-DOM-03/04: a subagent that writes outside its lanes raises an alert', async (t) => {
  const root = await project(t);
  let snap = { 'src/index.js': 'a' };
  const opts = { snapshot: () => snap };
  hook(root, 'PreToolUse', { tool_name: 'Task', tool_input: { subagent_type: 'qa-tester', prompt: 'x' } }, opts);
  snap = { 'src/index.js': 'b', 'tests/a.test.js': 'c' };
  const r = hook(root, 'PostToolUse', { tool_name: 'Task', tool_input: { subagent_type: 'qa-tester' } }, opts);
  assert.equal(r.code, 0);
  assert.match(alertOf(r), /El subagente qa-tester cambió archivos fuera de sus rutas: src\/index\.js\./);
  // Inside its lanes: nothing to report.
  hook(root, 'PreToolUse', { tool_name: 'Task', tool_input: { subagent_type: 'qa-tester' } }, opts);
  snap = { ...snap, 'tests/b.test.js': 'd' };
  assert.equal(hook(root, 'PostToolUse', { tool_name: 'Task', tool_input: { subagent_type: 'qa-tester' } }, opts).stdout, undefined);
});

test('RF-ORQ-09/12: any session may work; a new one sees where things are', async (t) => {
  const root = await project(t);
  const spec = await approved(root);
  fs.writeFileSync(path.join(root, 'specs', spec, 'tasks.md'), TASKS);
  const other = handleHook('PreToolUse', { cwd: root, session_id: 'S2', tool_name: 'Write', tool_input: { file_path: path.join(root, 'src/x.js'), content: '' } }, { env: {} });
  assert.equal(other.code, 0, 'no session lock');
  const resumed = hook(root, 'SessionStart');
  assert.match(resumed.stdout, /trabajo en curso\.\n- Spec en curso: SVC-001-login \(Estado: plan-approved\)\n- Hechas \(0\/2\): —\n- Pendientes: T1, T2\n- Listas para empezar: T1/);
  // Deleting the runtime state loses nothing that matters: the status is in the files.
  fs.rmSync(path.join(root, '.harness', 'state'), { recursive: true, force: true });
  assert.match(hook(root, 'SessionStart').stdout, /Estado: plan-approved/);
});

test('RF-GAT-03/04: commit context per repository, for a commit the user okays', async (t) => {
  const root = await project(t);
  write(root, { 'src/new.js': 'export const a = 1;\n' });
  const ctx = JSON.parse((await sdd(root, 'commit-context')).stdout);
  assert.equal(ctx.convention, 'conventional');
  assert.deepEqual(ctx.repositories.map((x) => x.repo), ['.']);
  assert.ok(ctx.repositories[0].files.some((f) => f.startsWith('src/')));
  assert.match(ctx.note, /only after the user says yes; never push/);
});

test('/sdd:status: what happened, what is pending and the last commits', async (t) => {
  const root = await project(t);
  await approved(root);
  git(root, 'add', '-A');
  git(root, '-c', 'user.email=a@b.c', '-c', 'user.name=A', 'commit', '-q', '-m', 'feat: first');
  const r = await sdd(root, 'status');
  assert.match(r.stdout, /Estado de sdd-harness\n- Spec en curso: SVC-001-login \(Estado: plan-approved\)/);
  assert.match(r.stdout, /Últimos commits:\n {4}\w+ feat: first/);
  const json = JSON.parse((await sdd(root, 'status', '--json')).stdout);
  assert.deepEqual([json.spec, json.status, json.pending], ['SVC-001-login', 'plan-approved', null]);
});

test('focus and --spec: allow selecting active spec when multiple exist', async (t) => {
  const root = await project(t);
  const s1 = await approved(root, 'login');
  const s2 = await approved(root, 'checkout');
  fs.writeFileSync(path.join(root, 'specs', s1, 'tasks.md'), TASKS);
  fs.writeFileSync(path.join(root, 'specs', s2, 'tasks.md'), TASKS.replace('T1', 'T10').replace('T2', 'T20'));

  // Without focus or --spec, s2 is more recent, but focus pins s1
  const f = await sdd(root, 'focus', s1);
  assert.equal(f.code, 0);
  assert.match(f.stdout, new RegExp(`Spec en curso fijada: ${s1}`));

  const next = await sdd(root, 'next');
  assert.match(next.stdout, /T1 Health endpoint/);

  // --spec overrides focus temporarily
  const nextS2 = await sdd(root, 'next', '--spec', s2);
  assert.match(nextS2.stdout, /T10 Health endpoint/);

  // Clear focus restores automatic detection
  const cleared = await sdd(root, 'focus', '--clear');
  assert.equal(cleared.code, 0);
});

test('done and brief commands: brief returns compact context; done marks task and records note in progress.md', async (t) => {
  const root = await project(t);
  const spec = await approved(root);
  fs.writeFileSync(path.join(root, 'specs', spec, 'tasks.md'), TASKS);
  fs.writeFileSync(specFile(root, spec), `---\nstatus: plan-approved\n---\n- **RF-01:** Health check 200.\n`);

  const br = await sdd(root, 'brief', 'T1');
  assert.equal(br.code, 0);
  assert.match(br.stdout, /Brief: T1/);
  assert.match(br.stdout, /Alcance permitido: src\/\*\*/);
  assert.match(br.stdout, /RF-01:?\*\*?\s*Health check 200/);
  // The brief carries the rules the subagent must follow, whatever the tool runs it.
  assert.match(br.stdout, /Reglas para el subagente/);
  assert.match(br.stdout, /Nada de refactors/);
  assert.match(br.stdout, /ejecuta `node check\.js`/);

  // RF-VER-01: done refuses without a green verification, and again when the code changed after it.
  const early = await sdd(root, 'done', 'T1');
  assert.equal(early.code, 2);
  assert.match(early.stderr, /No se cierra T1: la última verificación de "svc" no está en verde/);
  fs.writeFileSync(path.join(root, 'pass.flag'), '');
  assert.equal((await sdd(root, 'verify', '--component', 'svc', '--tests')).code, 0);
  fs.writeFileSync(path.join(root, 'src/index.js'), 'export const changed = true;\n');
  const stale = await sdd(root, 'done', 'T1');
  assert.equal(stale.code, 2);
  assert.match(stale.stderr, /cambiaron después de la última verificación/);
  assert.equal((await sdd(root, 'verify', '--component', 'svc', '--tests')).code, 0);

  const d = await sdd(root, 'done', 'T1', '--note', 'Implemented endpoint');
  assert.equal(d.code, 0, d.stderr);
  assert.match(d.stdout, /Tarea T1 marcada como hecha en tasks\.md/);

  const tasksContent = fs.readFileSync(path.join(root, 'specs', spec, 'tasks.md'), 'utf8');
  assert.match(tasksContent, /- \[x\] T1/);

  const progContent = fs.readFileSync(path.join(root, 'specs', spec, 'progress.md'), 'utf8');
  assert.match(progContent, /T1: Implemented endpoint/);
});

test('orchestration.max_parallel: the queue, next and the hook use the configured limit', async (t) => {
  const tasks = parseTasks(`- [ ] T1 API · Component: api · Depends on: —
- [ ] T2 Screen · Component: web · Depends on: —
- [ ] T3 Jobs · Component: jobs · Depends on: —
`);
  assert.deepEqual(taskQueue(tasks, {}, () => false, 3).ready.map((x) => x.id), ['T1', 'T2', 'T3']);
  assert.deepEqual(taskQueue(tasks, {}, () => false, 1).ready.map((x) => x.id), ['T1']);
  const root = await project(t, `${CONFIG}orchestration: {max_parallel: 3}\n`);
  const launch = (id, role) => hook(root, 'PreToolUse', { tool_use_id: id, tool_name: 'Task', tool_input: { subagent_type: role, prompt: 'x' } }, { snapshot: () => ({}) });
  launch('a', 'backend-dev');
  launch('b', 'frontend-dev');
  assert.equal(launch('c', 'qa-tester').stdout, undefined, 'a third subagent fits');
  assert.match(alertOf(launch('d', 'reviewer')), /El máximo son 3 a la vez/);
  const spec = await approved(root);
  fs.writeFileSync(path.join(root, 'specs', spec, 'tasks.md'), TASKS);
  const next = await sdd(root, 'next');
  assert.equal(next.code, 0, next.stderr);
  assert.match(next.stdout, /Máximo 3 subagentes/);
  assert.match(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), /never more than 3 subagents/);
});

test('sdd.js pause: active subagents finish, nothing new starts; resume lifts it', async (t) => {
  const root = await project(t);
  const spec = await approved(root);
  fs.writeFileSync(path.join(root, 'specs', spec, 'tasks.md'), TASKS);
  const launch = (id, role) => hook(root, 'PreToolUse', { tool_use_id: id, tool_name: 'Task', tool_input: { subagent_type: role, prompt: 'x' } }, { snapshot: () => ({}) });
  assert.equal(launch('a', 'backend-dev').stdout, undefined);

  const p = await sdd(root, 'pause');
  assert.equal(p.code, 0, p.stderr);
  assert.match(p.stdout, /Pausa registrada\. El subagente activo termina su tarea/);
  assert.match((await sdd(root, 'pause')).stdout, /Ya estaba en pausa/);
  // A new subagent is refused, in Claude Code (exit 2) and in Antigravity (deny).
  const blocked = launch('b', 'frontend-dev');
  assert.equal(blocked.code, 2);
  assert.match(blocked.stderr, /el usuario pidió pausar/);
  const agy = hook(root, 'PreToolUse', { toolCall: { name: 'invoke_subagent', args: { Subagents: [{ Role: 'qa-tester' }] } } }, { snapshot: () => ({}) });
  assert.equal(JSON.parse(agy.stdout).decision, 'deny');
  // next lists nothing new; the running subagent reports back as usual.
  const next = await sdd(root, 'next');
  assert.equal(next.code, 0);
  assert.match(next.stdout, /En pausa desde/);
  assert.doesNotMatch(next.stdout, /T1 Health endpoint/);
  assert.equal(hook(root, 'PostToolUse', { tool_use_id: 'a', tool_name: 'Task', tool_input: { subagent_type: 'backend-dev' } }, { snapshot: () => ({}) }).code, 0);
  assert.match((await sdd(root, 'status')).stdout, /En pausa desde/);
  assert.match(hook(root, 'SessionStart').stdout, /En pausa desde/);

  assert.match((await sdd(root, 'resume')).stdout, /Pausa retirada/);
  assert.match((await sdd(root, 'resume')).stdout, /No había ninguna pausa/);
  assert.match((await sdd(root, 'next')).stdout, /T1 Health endpoint/);
  assert.equal(launch('c', 'frontend-dev').stdout, undefined);
});

test('gates.decisions: pending decisions come from the files; interview mode holds the spec stop until clarifications are answered', async (t) => {
  const root = await project(t, CONFIG.replace('gates: {manual_test: story, commits: per-story, deps: ask}', 'gates: {manual_test: story, commits: per-story, deps: ask, decisions: interview}'));
  const id = /Spec (\S+) creada/.exec((await sdd(root, 'new-spec', 'login')).stdout)[1];
  const draft = (extra) => `---\nstatus: draft\n---\n# ${id}\n\n- **RF-01:** WHEN x THE SYSTEM SHALL y.\n${extra}`;
  fs.writeFileSync(specFile(root, id), draft('\n## Open questions\n\n- [NEEDS CLARIFICATION: ¿Se permite el login social?]\n'));
  const stop = await sdd(root, 'stop', 'spec');
  assert.equal(stop.code, 2);
  assert.match(stop.stderr, /1 aclaración pendiente/);
  assert.match(stop.stdout, /login social/);
  const list = await sdd(root, 'decisions');
  assert.match(list.stdout, /Decisiones pendientes de \S+ \(1\):/);
  assert.match(list.stdout, /Entrevista al usuario/);
  assert.match(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), /one question at a time before going on/);

  // Answered in the spec: the stop goes through.
  fs.writeFileSync(specFile(root, id), draft(''));
  assert.equal((await sdd(root, 'stop', 'spec')).code, 0);
  say(root, 'sí');
  await sdd(root, 'stop', 'plan');
  say(root, 'sí');
  assert.equal(statusOf(root, id), 'plan-approved');

  // ADR drafts of this spec, tasks added during implementation and guard alerts are decisions too.
  const adr = await sdd(root, 'new-adr', 'use redis');
  const adrFile = /docs\/decisions\/\S+\.md/.exec(adr.stdout)[0];
  fs.writeFileSync(path.join(root, 'specs', id, 'tasks.md'), `${TASKS.trimEnd()}\n- [ ] T9 Cache layer (añadida en implementación) · Component: svc · Depends on: —\n`);
  writeTool(root, 'db/migrations/001.sql');
  const d = JSON.parse((await sdd(root, 'decisions', '--json')).stdout).decisions;
  assert.deepEqual(d.map((x) => x.kind), ['adr', 'added', 'alert']);
  assert.equal(d[0].file, adrFile);
  assert.match(d[2].text, /Zona protegida "db"/);
  // Keyed alerts are resolved explicitly; the rest by editing the files.
  assert.equal((await sdd(root, 'decisions', '--resolve', d[2].key)).code, 0);
  assert.equal((await sdd(root, 'decisions', '--resolve', d[2].key)).code, 2);
  assert.deepEqual(JSON.parse((await sdd(root, 'decisions', '--json')).stdout).decisions.map((x) => x.kind), ['adr', 'added']);
  assert.match((await sdd(root, 'status')).stdout, /Decisiones pendientes del usuario: 2/);
  assert.match((await sdd(root, 'decisions')).stdout, /Entrevista al usuario/);
});

test('gates.decisions summary (default): the stop is not held and decisions are only reported', async (t) => {
  const root = await project(t);
  const id = /Spec (\S+) creada/.exec((await sdd(root, 'new-spec', 'login')).stdout)[1];
  fs.writeFileSync(specFile(root, id), `---\nstatus: draft\n---\n# ${id}\n\n- [NEEDS CLARIFICATION: ¿MFA?]\n`);
  assert.equal((await sdd(root, 'stop', 'spec')).code, 0);
  assert.match((await sdd(root, 'decisions')).stdout, /Cuéntaselas al usuario en tu resumen/);
});

