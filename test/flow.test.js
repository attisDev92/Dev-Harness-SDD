// Flow rules as pure functions: tasks, specs, gates and decisions
// (RF-SDD-01/02/04/05/06/12/13, RF-ORQ-01, RF-GAT-10..14, RF-RET-04..06, edge case 14).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import { parseTasks, selectNextTask, markTaskDone, taskProblems, nextSpecId, nextAdrFile, slugify, lintSpec, lintTasks, lintConstitution, parseRequirements } from '../src/guards/tasks.js';
import { requestGate, parseDecision, decide } from '../src/guards/flow.js';
import { emptyState, loadFlow, saveFlow, rebuildFromProgress, touchLock, readLock, releaseLock, FLOW_FILE } from '../src/guards/state.js';
import { template } from '../src/generate/templates.js';
import { tempDir } from './helpers.js';

const TASKS = `# Tasks

- [x] T1 Login form · Requirements: RF-01 · Component: web · Scope: \`apps/web/src/login/**\` · Depends on: — · Done when: the form renders
- [ ] T2 Login API · Requisitos: RF-02, RF-03 · Componente: api · Alcance: \`apps/api/src/auth/**\` · Depende de: T1 · Hecho cuando: POST /login returns 200
- [ ] T3 Logout · Requirements: RF-04 · Component: api · Scope: apps/api/src/auth/** · Depends on: T4 · Done when: session ends · Story: H2
- [ ] T4 Session store · Requirements: RF-05 · Component: api · Depends on: T2 · Done when: sessions persist
`;

test('RF-SDD-12: tasks are parsed in both languages', () => {
  const tasks = parseTasks(TASKS);
  assert.deepEqual(tasks.map((t) => [t.id, t.done]), [['T1', true], ['T2', false], ['T3', false], ['T4', false]]);
  assert.deepEqual(tasks[1], {
    id: 'T2', done: false, title: 'Login API', requirements: ['RF-02', 'RF-03'], component: 'api',
    scope: ['apps/api/src/auth/**'], depends: ['T1'], doneWhen: 'POST /login returns 200', line: 3,
  });
  assert.equal(tasks[2].story, 'H2');
});

test('RF-ORQ-01: the next task is the first pending one with its dependencies done', () => {
  const tasks = parseTasks(TASKS);
  assert.equal(selectNextTask(tasks).id, 'T2');
  tasks[1].done = true;
  assert.equal(selectNextTask(tasks).id, 'T4');
  assert.equal(selectNextTask(tasks.map((t) => ({ ...t, done: true }))), null);
});

test('RF-GAT-12: ticking a task touches only its line', () => {
  const after = markTaskDone(TASKS, 'T2');
  assert.match(after, /- \[x\] T2 Login API/);
  assert.equal(after.replace('- [x] T2', '- [ ] T2'), TASKS);
  assert.equal(markTaskDone(TASKS.replace(/\n/g, '\r\n'), 'T3').includes('\r\n- [x] T3'), true);
});

test('edge case 14: a task without scope cannot run', () => {
  const [, , , t4] = parseTasks(TASKS);
  assert.deepEqual(taskProblems(t4, { api: {} }), ['noScope']);
  assert.deepEqual(taskProblems(parseTasks('- [ ] T9 Nothing')[0], {}), ['noComponent', 'noScope', 'noRequirements', 'noDoneWhen']);
  const lint = lintTasks(TASKS + '- [ ] T5 X · Requirements: RF-1 · Component: api · Scope: a · Depends on: T8 · Done when: y\n', { web: {}, api: {} });
  assert.deepEqual(lint.problems, [{ code: 'noScope', task: 'T4' }, { code: 'unknownDependency', task: 'T5', dep: 'T8' }]);
});

test('RF-SDD-04: spec and ADR numbering', (t) => {
  const root = tempDir(t);
  assert.equal(nextSpecId(root, 'API', 'login'), 'API-001-login');
  for (const d of ['API-001-login', 'API-007-x', 'WEB-003-y', 'notes']) fs.mkdirSync(path.join(root, 'specs', d), { recursive: true });
  assert.equal(nextSpecId(root, 'API', 'reset'), 'API-008-reset');
  assert.equal(nextSpecId(root, 'WEB', 'z'), 'WEB-004-z');
  assert.equal(nextAdrFile(root, 'db'), 'docs/decisions/ADR-0001-db.md');
  fs.mkdirSync(path.join(root, 'docs', 'decisions'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'decisions', 'ADR-0012-x.md'), '');
  assert.equal(nextAdrFile(root, 'db'), 'docs/decisions/ADR-0013-db.md');
  assert.equal(slugify('Login con correo y contraseña!'), 'login-con-correo-y-contrasena');
});

test('RF-SDD-05/06: EARS requirements, duplicates and open questions', () => {
  const spec = `## Requisitos\n\n- **RF-01:** CUANDO el usuario envíe el formulario, EL SISTEMA validará el correo.\n- **RF-02:** The login page looks nice.\n- **RF-01:** SI falla, ENTONCES EL SISTEMA mostrará un error.\n\n- [NECESITA ACLARACIÓN: ¿cuántos intentos?]\n`;
  const r = lintSpec(spec);
  assert.equal(r.requirements, 3);
  assert.equal(r.clarifications, 1);
  assert.deepEqual(r.problems, [{ code: 'notEars', id: 'RF-02' }, { code: 'duplicateId', id: 'RF-01' }]);
  assert.deepEqual(parseRequirements(template('spec', 'en')).map((x) => x.id), ['RF-01', 'RF-02', 'RF-03', 'RF-04']);
  assert.deepEqual(lintSpec(template('spec', 'es')).problems, []);
});

test('RF-SDD-01/02: constitution size and mandatory principles', () => {
  const ok = template('constitution', 'es').replace(/<principio>/g, 'Principio verificable');
  assert.deepEqual(lintConstitution(ok).problems, []);
  assert.deepEqual(lintConstitution(template('constitution', 'en')).problems, [{ code: 'principleCount', count: 3 }]);
  const missing = ok.replace('El agente nunca hace commit: propone los mensajes y el commit lo hace el usuario.', 'Principio');
  assert.deepEqual(lintConstitution(missing).problems, [{ code: 'missingPrinciple', index: 1 }]);
});

const withSpec = (over = {}) => ({ ...emptyState(), activeSpec: 'API-001-login', specs: { 'API-001-login': { phase: 'spec', approved: [] } }, ...over });

test('RF-SDD-13: phases are approved in order', () => {
  assert.equal(requestGate(emptyState(), { kind: 'spec' }).code, 'noActiveSpec');
  assert.deepEqual(requestGate(withSpec(), { kind: 'plan' }), { ok: false, code: 'needsApproval', params: { phase: 'spec' } });
  let s = requestGate(withSpec(), { kind: 'spec' }).state;
  assert.equal(requestGate(s, { kind: 'clarify' }).code, 'gatePending');
  s = decide(s, { approved: true }).state;
  assert.deepEqual(s.specs['API-001-login'], { phase: 'plan', approved: ['spec'] });
  s = decide(requestGate(s, { kind: 'plan' }).state, { approved: true }).state;
  s = decide(requestGate(s, { kind: 'tasks' }).state, { approved: true }).state;
  assert.deepEqual(s.specs['API-001-login'], { phase: 'implement', approved: ['spec', 'plan', 'tasks'] });
  const rejected = decide(requestGate(withSpec(), { kind: 'spec' }).state, { approved: false, text: 'missing errors' });
  assert.deepEqual(rejected.state.specs['API-001-login'].approved, []);
  assert.equal(rejected.state.gate, null);
});

test('RF-GAT-10/13: the manual test comes after green verification; KO starts triage', () => {
  const task = { id: 'T2', verify: { status: 'fail' }, dirty: false };
  assert.equal(requestGate(withSpec({ task }), { kind: 'manual-test' }).code, 'verifyFirst');
  assert.equal(requestGate(withSpec({ task: { ...task, verify: { status: 'pass' }, dirty: true } }), { kind: 'manual-test' }).code, 'verifyFirst');
  const s = requestGate(withSpec({ task: { ...task, verify: { status: 'pass' } } }), { kind: 'manual-test' }).state;
  assert.equal(decide(s, { approved: true }).state.task.manualApproved, true);
  const ko = decide(s, { approved: false, text: 'the button does nothing' }).state;
  assert.deepEqual([ko.triage.task, ko.triage.reason, ko.task.manualApproved], ['T2', 'the button does nothing', false]);
});

test('RF-GAT-07/08: a protected change needs files and an ADR, and grants only those files', () => {
  assert.equal(requestGate(withSpec(), { kind: 'protected' }).code, 'filesRequired');
  assert.equal(requestGate(withSpec(), { kind: 'protected', files: ['db/migrations/002.sql'] }).code, 'adrRequired');
  const s = requestGate(withSpec(), { kind: 'protected', files: ['db/migrations/002.sql'], adr: 'docs/decisions/ADR-0001-x.md' }).state;
  assert.deepEqual(decide(s, { approved: true }).state.granted, ['db/migrations/002.sql']);
  assert.deepEqual(decide(s, { approved: false }).state.granted, []);
});

test('RF-RET-06: choosing a triage option ends triage and resets the counter', () => {
  assert.equal(requestGate(withSpec(), { kind: 'triage' }).code, 'noTriage');
  const s = requestGate(withSpec({ task: { id: 'T2' }, triage: { task: 'T2' } }), { kind: 'triage' }).state;
  const r = decide(s, { approved: true, text: 'option 2' });
  assert.deepEqual([r.state.triage, r.state.task.option, r.resetRetries], [null, 'option 2', 'T2']);
});

test('RF-SDD-16: a change needs change mode first', () => {
  assert.equal(requestGate(withSpec(), { kind: 'change' }).code, 'noChange');
  const s = withSpec();
  s.specs['API-001-login'] = { phase: 'implement', approved: ['spec', 'plan', 'tasks'], change: true };
  const approved = decide(requestGate(s, { kind: 'change' }).state, { approved: true }).state;
  assert.equal(approved.specs['API-001-login'].change, false);
});

test('only what the user types decides a gate', () => {
  assert.deepEqual(parseDecision('/sdd:approve'), { approved: true, text: '' });
  assert.deepEqual(parseDecision('/sdd:reject falta el caso de error'), { approved: false, text: 'falta el caso de error' });
  assert.deepEqual(parseDecision('OK'), { approved: true, text: '' });
  assert.deepEqual(parseDecision('ok, funciona'), { approved: true, text: 'funciona' });
  assert.deepEqual(parseDecision('KO: el botón no hace nada'), { approved: false, text: 'el botón no hace nada' });
  for (const p of ['looks ok to me', 'okay-ish maybe', 'kodak', 'please continue', '']) {
    assert.equal(parseDecision(p)?.approved === true && !/^ok/i.test(p) ? 'bad' : 'fine', 'fine', p);
  }
  assert.equal(parseDecision('looks ok to me'), null);
  assert.equal(parseDecision('kodak'), null);
  assert.equal(decide(emptyState(), { approved: true }), null);
});

test('edge case 13: the state is rebuilt from progress.md when .harness/state is deleted', (t) => {
  const root = tempDir(t);
  fs.mkdirSync(path.join(root, 'specs', 'API-001-login'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', 'API-001-login', 'progress.md'), '# Progress\n\nMy notes.\n');
  const state = withSpec({ task: { id: 'T2', component: 'api' } });
  state.specs['API-001-login'] = { phase: 'implement', approved: ['spec', 'plan', 'tasks'] };
  saveFlow(root, state, 'es');
  const progress = fs.readFileSync(path.join(root, 'specs', 'API-001-login', 'progress.md'), 'utf8');
  assert.match(progress, /^<!-- harness:begin -->\n<!-- harness-state: /);
  assert.match(progress, /\| Tarea actual \| T2 \(api\) \|/);
  assert.match(progress, /My notes\.\n$/);
  fs.rmSync(path.join(root, FLOW_FILE));
  const { state: rebuilt, rebuilt: flag } = loadFlow(root);
  assert.equal(flag, true);
  assert.deepEqual([rebuilt.activeSpec, rebuilt.task.id, rebuilt.specs['API-001-login'].approved], ['API-001-login', 'T2', ['spec', 'plan', 'tasks']]);
  assert.equal(rebuildFromProgress(tempDir(t)).activeSpec, null);
});

test('RF-ORQ-12: one live session holds the lock', (t) => {
  const root = tempDir(t);
  assert.equal(touchLock(root, 'A').ok, true);
  assert.equal(touchLock(root, 'A').ok, true);
  const busy = touchLock(root, 'B');
  assert.deepEqual([busy.ok, busy.holder.session], [false, 'A']);
  // A stale lock (no activity for 30 minutes) can be taken over.
  assert.equal(touchLock(root, 'B', new Date(Date.now() + 31 * 60 * 1000)).ok, true);
  assert.equal(readLock(root).session, 'B');
  releaseLock(root, 'A');
  assert.equal(readLock(root).session, 'B');
  releaseLock(root, 'B');
  assert.equal(readLock(root), null);
});
