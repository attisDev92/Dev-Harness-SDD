// The whole flow through sdd.js and the Claude Code hooks, on a real project
// (RF-SDD-*, RF-ORQ-*, RF-GAT-10..14, RF-RET-*, RF-DOM-03/04, RF-VER-01/02).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import { runSdd } from '../src/guards/sdd.js';
import { handleHook } from '../src/guards/hook.js';
import { loadFlow } from '../src/guards/state.js';
import { loadState as loadRetries } from '../src/guards/retry.js';
import { run, write, git } from './fixtures.js';
import { tempDir } from './helpers.js';

const CONFIG = `harness_version: 0.3.0
install_mode: local
cli: {language: en}
tools: [claude-code]
language: {code: en, specs: en, docs: en, commits: en, ui: en}
topology: single
components:
  svc: {path: ., kind: backend, id_prefix: SVC, stack: node, verify: {test: node check.js}}
git_hooks: {enabled: false}
protected:
  db: ["**/migrations/**"]
`;

async function project(t, config = CONFIG) {
  const root = tempDir(t);
  write(root, {
    'package.json': { name: 'svc', type: 'module' },
    // The "test suite": passes when pass.flag exists, fails with the flag's absence otherwise.
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
  return runSdd(argv, { stdout: { write: (s) => { stdout += s; } }, stderr: { write: (s) => { stderr += s; } }, cwd: root, env: { HARNESS_LANG: 'en' } })
    .then((code) => ({ code, stdout, stderr }));
}

const hook = (root, event, payload = {}) => handleHook(event, { cwd: root, session_id: 'S1', ...payload }, { env: { HARNESS_LANG: 'en' } });
const writeTool = (root, file, extra = {}) => hook(root, 'PreToolUse', { tool_name: 'Write', tool_input: { file_path: path.join(root, file), content: 'x' }, ...extra });
const say = (root, prompt) => hook(root, 'UserPromptSubmit', { prompt });
const state = (root) => loadFlow(root).state;

async function approvePhases(root) {
  assert.equal((await sdd(root, 'new-spec', 'login')).code, 0);
  for (const phase of ['spec', 'plan', 'tasks']) {
    assert.equal((await sdd(root, 'gate', 'request', phase)).code, 0);
    assert.match(say(root, '/sdd:approve').stdout, new RegExp(`APPROVED the pending decision \\(${phase}\\)`));
  }
}

const TASKS = `# Tasks

- [ ] T1 Health endpoint · Requirements: RF-01 · Component: svc · Scope: \`src/**\` · Depends on: — · Done when: GET /health returns 200
- [ ] T2 Metrics · Requirements: RF-02 · Component: svc · Scope: \`src/metrics/**\` · Depends on: T1 · Done when: /metrics lists counters
`;

test('RF-SDD-13 + RF-SDD-04: phases in order, approvals only from the user', async (t) => {
  const root = await project(t);
  // No spec, no task: code is off limits.
  assert.match(writeTool(root, 'src/app.js').stderr, /no task is in progress/);

  const created = await sdd(root, 'new-spec', 'Health check');
  assert.equal(created.code, 0, created.stderr);
  assert.match(created.stdout, /Spec SVC-001-health-check created: specs\/SVC-001-health-check\/spec\.md/);
  assert.match(fs.readFileSync(path.join(root, 'specs/SVC-001-health-check/spec.md'), 'utf8'), /^# SVC-001 — Health check/);
  assert.equal((await sdd(root, 'new-spec', 'other')).stdout.includes('SVC-002-other'), true);

  assert.equal(writeTool(root, 'specs/SVC-002-other/plan.md').code, 2, 'plan before the spec is approved');
  assert.equal((await sdd(root, 'gate', 'request', 'plan')).code, 2);
  assert.equal((await sdd(root, 'gate', 'request', 'spec')).code, 0);
  assert.equal((await sdd(root, 'gate', 'request', 'clarify')).code, 2, 'one decision at a time');

  // Words that are not a decision do not approve anything.
  assert.equal(say(root, 'looks fine, go ahead').stdout, undefined);
  assert.equal(state(root).gate.kind, 'spec');
  assert.match(say(root, '/sdd:reject add the error case').stdout, /REJECTED the pending decision \(spec\): "add the error case"/);
  assert.equal(writeTool(root, 'specs/SVC-002-other/plan.md').code, 2);

  await sdd(root, 'gate', 'request', 'spec');
  say(root, '/sdd:approve');
  assert.equal(writeTool(root, 'specs/SVC-002-other/plan.md').code, 0);
  assert.equal(writeTool(root, 'specs/SVC-002-other/spec.md').code, 2, 'approved spec is frozen (RF-SDD-18)');
  assert.match(say(root, '/sdd:approve').stdout, /no pending decision/);
});

test('one task end to end: tests-first scope, verification, retries, triage, manual test, done', async (t) => {
  const root = await project(t);
  await approvePhases(root);
  const spec = state(root).activeSpec;
  fs.writeFileSync(path.join(root, 'specs', spec, 'tasks.md'), TASKS);
  fs.writeFileSync(path.join(root, 'specs', spec, 'spec.md'), '- **RF-01:** WHEN GET /health is called, THE SYSTEM SHALL answer 200.\n- **RF-02:** THE SYSTEM SHALL expose counters.\n');

  // RF-ORQ-01/03: the first ready task, delegated to the role of its component.
  const next = await sdd(root, 'next');
  assert.equal(next.code, 0, next.stderr);
  assert.match(next.stdout, /Task T1: Health endpoint\nComponent: svc · Role: backend-dev · Scope: src\/\*\*/);
  assert.equal((await sdd(root, 'next')).code, 2, 'one task per invocation (RF-ORQ-02)');

  assert.equal(writeTool(root, 'src/health.js').code, 0);
  assert.equal(writeTool(root, 'check.js').code, 2, 'outside the task scope (RF-RET-02)');
  hook(root, 'PostToolUse', { tool_name: 'Write', tool_input: { file_path: path.join(root, 'src/health.js') } });
  assert.equal(state(root).task.dirty, true);

  // RF-VER-01: no finishing with unverified changes (once, to avoid loops).
  assert.match(hook(root, 'Stop').stderr, /changes that were not verified/);
  assert.equal(hook(root, 'Stop', { stop_hook_active: true }).code, 0);

  // RF-RET-01/03/07: counted by the script; the same error twice → triage.
  let v = await sdd(root, 'verify');
  assert.equal(v.code, 2);
  assert.match(v.stderr, /Automatic fix attempt 1 of 2 allowed/);
  v = await sdd(root, 'verify');
  assert.match(v.stderr, /same error happened twice in a row/);
  assert.equal(state(root).triage.task, 'T1');
  assert.match(writeTool(root, 'src/health.js').stderr, /triage is in progress/, 'RF-RET-05');
  assert.equal((await sdd(root, 'gate', 'request', 'manual-test')).code, 2);

  // RF-RET-04/06: the user picks an option; the counter starts again.
  assert.equal((await sdd(root, 'gate', 'request', 'triage')).code, 0);
  assert.match(say(root, '/sdd:approve option 2: add the flag').stdout, /APPROVED.*triage.*option 2/);
  assert.equal(state(root).triage, null);
  assert.equal(loadRetries(root).tasks.T1, undefined);

  fs.writeFileSync(path.join(root, 'pass.flag'), '');
  v = await sdd(root, 'verify');
  assert.equal(v.code, 0, v.stderr);
  assert.equal(state(root).task.dirty, false);
  assert.equal(hook(root, 'Stop').code, 0);

  // RF-GAT-10/11/12: nothing is done before the user's manual test.
  assert.match((await sdd(root, 'task', 'done', 'T1')).stderr, /has not approved the manual test/);
  assert.equal((await sdd(root, 'gate', 'request', 'manual-test')).code, 0);
  assert.match((await sdd(root, 'next')).stderr, /decision is pending/);
  assert.match(say(root, 'KO: /health returns 500').stdout, /REJECTED.*manual-test.*\n.*start the debugger triage/);
  assert.equal(state(root).triage.reason, '/health returns 500', 'RF-GAT-13');
  await sdd(root, 'gate', 'request', 'triage');
  say(root, '/sdd:approve fix the route');
  await sdd(root, 'verify');
  await sdd(root, 'gate', 'request', 'manual-test');
  say(root, 'OK');
  const done = await sdd(root, 'task', 'done', 'T1');
  assert.equal(done.code, 0, done.stderr);
  assert.match(fs.readFileSync(path.join(root, 'specs', spec, 'tasks.md'), 'utf8'), /- \[x\] T1 Health endpoint/);
  assert.match(fs.readFileSync(path.join(root, 'specs', spec, 'progress.md'), 'utf8'), /\| Current task \| — \|/);

  // RF-SDD-14/15: requirement → test coverage.
  write(root, { 'src/health.test.js': "test('RF-01 health answers 200', () => {});\n" });
  const val = await sdd(root, 'validate');
  assert.equal(val.code, 2);
  assert.match(val.stdout, /✔ RF-01: src\/health\.test\.js\n {2}✖ RF-02: not covered by any test\n1 of 2 requirements/);
});

test('RF-VER-02 and edge case 14: tasks need verification commands and a scope', async (t) => {
  const root = await project(t, CONFIG.replace(', verify: {test: node check.js}', ''));
  await approvePhases(root);
  const spec = state(root).activeSpec;
  fs.writeFileSync(path.join(root, 'specs', spec, 'tasks.md'), TASKS);
  assert.match((await sdd(root, 'next')).stderr, /no verification commands/);
  const root2 = await project(t);
  await approvePhases(root2);
  fs.writeFileSync(path.join(root2, 'specs', state(root2).activeSpec, 'tasks.md'), '- [ ] T1 X · Requirements: RF-01 · Component: svc · Done when: y\n');
  assert.match((await sdd(root2, 'next')).stderr, /cannot run yet: noScope/);
});

test('RF-SDD-16: a change updates the spec first, and blocks code until approved', async (t) => {
  const root = await project(t);
  await approvePhases(root);
  const spec = state(root).activeSpec;
  fs.writeFileSync(path.join(root, 'specs', spec, 'tasks.md'), TASKS);
  await sdd(root, 'next');
  assert.equal((await sdd(root, 'change', 'start')).code, 0);
  assert.equal(writeTool(root, `specs/${spec}/spec.md`).code, 0);
  assert.match(writeTool(root, 'src/health.js').stderr, /spec change is in progress/);
  await sdd(root, 'gate', 'request', 'change');
  say(root, '/sdd:approve');
  assert.equal(writeTool(root, 'src/health.js').code, 0);
  assert.equal(writeTool(root, `specs/${spec}/spec.md`).code, 2);
});

test('RF-GAT-07/08: protected change through an ADR and an approved gate', async (t) => {
  const root = await project(t);
  await approvePhases(root);
  fs.writeFileSync(path.join(root, 'specs', state(root).activeSpec, 'tasks.md'), TASKS);
  await sdd(root, 'next');
  const blocked = writeTool(root, 'src/migrations/001.sql');
  assert.match(blocked.stderr, /protected zone "db".*gate request protected --files src\/migrations\/001\.sql/s);
  const adr = await sdd(root, 'new-adr', 'Add health table');
  assert.match(adr.stdout, /docs\/decisions\/ADR-0001-add-health-table\.md/);
  assert.equal((await sdd(root, 'gate', 'request', 'protected', '--files', 'src/migrations/001.sql', '--adr', 'docs/decisions/ADR-0001-add-health-table.md')).code, 0);
  say(root, '/sdd:approve');
  assert.equal(writeTool(root, 'src/migrations/001.sql').code, 0);
  assert.equal(writeTool(root, 'src/migrations/002.sql').code, 2, 'only the approved change');
});

test('RF-GAT-05/06 through the hook: installs ask the user', async (t) => {
  const root = await project(t);
  const r = hook(root, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: 'npm install lodash' } });
  const out = JSON.parse(r.stdout);
  assert.deepEqual([out.hookSpecificOutput.hookEventName, out.hookSpecificOutput.permissionDecision], ['PreToolUse', 'ask']);
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /adds, removes or upgrades dependencies/);
  assert.match(hook(root, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: 'git commit -am x' } }).stderr, /Committing is the user's job/);
});

test('RF-DOM-03/04: a subagent that writes outside its lanes stops the flow', async (t) => {
  const root = await project(t);
  let snap = { 'src/index.js': 'a' };
  const opts = { env: { HARNESS_LANG: 'en' }, snapshot: () => snap };
  handleHook('PreToolUse', { cwd: root, session_id: 'S1', tool_name: 'Task', tool_input: { subagent_type: 'qa-tester', prompt: 'x' } }, opts);
  snap = { 'src/index.js': 'b', 'tests/a.test.js': 'c' };
  const r = handleHook('PostToolUse', { cwd: root, session_id: 'S1', tool_name: 'Task', tool_input: { subagent_type: 'qa-tester' } }, opts);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /The qa-tester subagent changed files outside its paths: src\/index\.js\. .*Do not revert anything yourself/);
  // Inside its lanes: nothing to report.
  handleHook('PreToolUse', { cwd: root, session_id: 'S1', tool_name: 'Task', tool_input: { subagent_type: 'qa-tester' } }, opts);
  snap = { ...snap, 'tests/b.test.js': 'd' };
  assert.equal(handleHook('PostToolUse', { cwd: root, session_id: 'S1', tool_name: 'Task', tool_input: {} }, opts).code, 0);
});

test('RF-ORQ-12 and RF-ORQ-09: one session at a time; a new session resumes', async (t) => {
  const root = await project(t);
  await approvePhases(root);
  fs.writeFileSync(path.join(root, 'specs', state(root).activeSpec, 'tasks.md'), TASKS);
  assert.equal(hook(root, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: 'node .harness/scripts/sdd.js next' } }).code, 0);
  await sdd(root, 'next');
  const other = handleHook('PreToolUse', { cwd: root, session_id: 'S2', tool_name: 'Write', tool_input: { file_path: path.join(root, 'src/x.js'), content: '' } }, { env: { HARNESS_LANG: 'en' } });
  assert.match(other.stderr, /Another session \(S1\) is running tasks/);
  const resumed = handleHook('SessionStart', { cwd: root, session_id: 'S2' }, { env: { HARNESS_LANG: 'en' } });
  assert.match(resumed.stdout, /resuming the work in progress\.\n- Active spec: SVC-001-login \(Phase: implement\)\n- Current task: T1 Health endpoint/);
  hook(root, 'SessionEnd');
  assert.equal(handleHook('PreToolUse', { cwd: root, session_id: 'S2', tool_name: 'Write', tool_input: { file_path: path.join(root, 'src/x.js'), content: '' } }, { env: { HARNESS_LANG: 'en' } }).code, 0);
});

test('edge case 13: deleting .harness/state mid-spec rebuilds it and says so', async (t) => {
  const root = await project(t);
  await approvePhases(root);
  fs.writeFileSync(path.join(root, 'specs', state(root).activeSpec, 'tasks.md'), TASKS);
  await sdd(root, 'next');
  fs.rmSync(path.join(root, '.harness', 'state'), { recursive: true });
  const r = hook(root, 'SessionStart');
  assert.match(r.stdout, /state was rebuilt from progress\.md/);
  assert.equal(state(root).task.id, 'T1');
});

test('RF-GAT-03/04: commit context per repository, never a commit', async (t) => {
  const root = await project(t);
  write(root, { 'src/new.js': 'export const a = 1;\n' });
  const r = await sdd(root, 'commit-context');
  const ctx = JSON.parse(r.stdout);
  assert.equal(ctx.convention, 'conventional');
  assert.deepEqual(ctx.repositories.map((x) => x.repo), ['.']);
  assert.ok(ctx.repositories[0].files.some((f) => f.startsWith('src/')));
  assert.match(ctx.note, /Never run git commit/);
});

test('/sdd:status shows spec, task, blockers and cost as not available', async (t) => {
  const root = await project(t);
  await approvePhases(root);
  const r = await sdd(root, 'status');
  assert.match(r.stdout, /Active spec: SVC-001-login\n {2}Phase: implement · Approved: spec, plan, tasks\n {2}Current task: —\n {2}Pending decision: —\n {2}Blockers: —\n {2}Cost: not available/);
  const json = JSON.parse((await sdd(root, 'status', '--json')).stdout);
  assert.equal(json.cost, null);
});
