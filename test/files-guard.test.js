// File guard: alerts, and blocks only for the harness itself (RF-GAT-06/07/09,
// RF-MD-01, RF-ORQ-13, edge case 12).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import { checkWrite, contentAfter, componentOf } from '../src/guards/files-guard.js';
import { DEFAULT_DOCS_WHITELIST } from '../src/guards/project.js';
import { tempDir } from './helpers.js';

const settings = {
  docsMode: 'whitelist',
  docsWhitelist: [...DEFAULT_DOCS_WHITELIST],
  protected: {
    deps: ['package.json#dependencies', 'package.json#devDependencies', '**/pnpm-lock.yaml'],
    db: ['**/migrations/**'],
    tooling: ['**/eslint.config.*', '**/tsconfig*.json'],
    harness: ['harness.config.yaml', '.harness/**', '.claude/settings.local.json'],
  },
  managedBlocks: ['AGENTS.md'],
  components: { web: { path: 'apps/web', kind: 'frontend' }, api: { path: 'apps/api', kind: 'backend' } },
};
const T2 = { id: 'T2', done: false, component: 'api', scope: ['apps/api/src/auth/**'] };
const spec = (status) => ({ id: 'API-001-login', dir: 'specs/API-001-login', status });
const implementing = (tasks = [T2]) => ({ spec: spec('plan-approved'), tasks });
const idle = { spec: null, tasks: [] };

function project(t) {
  const root = tempDir(t);
  fs.mkdirSync(path.join(root, 'apps', 'api'), { recursive: true });
  fs.writeFileSync(path.join(root, 'apps', 'api', 'package.json'), JSON.stringify({ name: 'api', scripts: { test: 'jest' }, dependencies: { express: '^5' } }, null, 2));
  return root;
}
const check = (root, file, flow, input = {}) => checkWrite({ root, file: path.join(root, file), settings, flow, input });

test('RF-GAT-09 / edge case 12: the harness files are never writable; its config is', (t) => {
  const root = project(t);
  for (const f of ['.harness/guards.json', '.harness/state/runtime.json', '.claude/settings.local.json']) {
    assert.equal(check(root, f, implementing()).kind, 'harnessFile', f);
  }
  // The tool asks the user natively (permissions.ask); the guard says nothing.
  assert.equal(check(root, 'harness.config.yaml', implementing(), { content: 'x' }).decision, 'allow');
});

test('AGENTS.md is editable outside the harness block, never inside it', (t) => {
  const root = project(t);
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# Proyecto\n\n<!-- harness:begin -->\nreglas generadas\n<!-- harness:end -->\n');
  const edit = (old_string, new_string) => check(root, 'AGENTS.md', implementing(), { old_string, new_string });
  assert.equal(edit('# Proyecto\n', '# Proyecto\n\nStack: Node 24\n').decision, 'allow');
  assert.equal(edit('reglas generadas', 'otras reglas').kind, 'contextBlock');
  assert.equal(check(root, 'AGENTS.md', implementing(), { content: '# solo mio\n' }).kind, 'contextBlock');
});

test('spec documents are always editable; a plan ahead of the spec approval raises an alert', (t) => {
  const root = project(t);
  const dir = path.join(root, 'specs', 'API-001-login');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'spec.md'), '# spec\n');
  fs.writeFileSync(path.join(dir, 'tasks.md'), '- [ ] T1 x\n');
  assert.equal(check(root, 'specs/API-001-login/spec.md', { spec: spec('plan-approved'), tasks: [] }).decision, 'allow');
  const early = check(root, 'specs/API-001-login/plan.md', { spec: spec('draft'), tasks: [] });
  assert.deepEqual([early.decision, early.kind], ['warn', 'needsApproval']);
  assert.equal(check(root, 'specs/API-001-login/plan.md', { spec: spec('spec-approved'), tasks: [] }).decision, 'allow');
  // The agent ticks tasks and adds new ones freely.
  assert.equal(check(root, 'specs/API-001-login/tasks.md', implementing(), { old_string: '- [ ] T1', new_string: '- [x] T1' }).decision, 'allow');
  // With a documentation whitelist configured, a new stray .md is refused.
  assert.equal(check(root, 'docs/notes.md', idle).kind, 'docBlocked');
  assert.equal(checkWrite({ root, file: path.join(root, 'docs/notes.md'), settings: { ...settings, docsMode: 'free' }, flow: idle }).decision, 'allow');
});

test('dependency sections and lockfiles raise an alert; other package.json edits do not', (t) => {
  const root = project(t);
  const flow = implementing([{ ...T2, scope: ['apps/api/**'] }]);
  const pkg = 'apps/api/package.json';
  assert.equal(check(root, pkg, flow, { old_string: '"jest"', new_string: '"vitest"' }).decision, 'allow');
  const v = check(root, pkg, flow, { old_string: '"express": "^5"', new_string: '"express": "^5",\n    "lodash": "^4"' });
  assert.deepEqual([v.decision, v.kind], ['warn', 'depsEdit']);
  assert.equal(check(root, 'apps/api/pnpm-lock.yaml', flow, { content: 'x' }).decision, 'warn');
});

test('tooling config (lint, tsconfig) is edited freely, with or without a task', (t) => {
  const root = project(t);
  for (const flow of [idle, implementing()]) {
    assert.equal(check(root, 'eslint.config.js', flow, { content: 'export default []' }).decision, 'allow');
    assert.equal(check(root, 'apps/api/tsconfig.json', flow, { content: '{}' }).decision, 'allow');
  }
});

test('protected zones raise an alert, never a block', (t) => {
  const root = project(t);
  const v = check(root, 'apps/api/migrations/002.sql', implementing(), { content: 'ALTER TABLE' });
  assert.deepEqual([v.decision, v.kind, v.zone], ['warn', 'protectedZone', 'db']);
});

test('a migration of the data model in the approved plan raises no alert', (t) => {
  const root = project(t);
  const migration = 'apps/api/migrations/002.sql';
  const withScope = implementing([{ ...T2, scope: ['apps/api/src/auth/**', 'apps/api/migrations/**'] }]);
  fs.mkdirSync(path.join(root, 'specs', 'API-001-login'), { recursive: true });
  const plan = (model) => fs.writeFileSync(path.join(root, 'specs', 'API-001-login', 'plan.md'), `# Plan\n\n## Data model\n\n${model}\n## Decisions\n`);
  plan('');
  assert.equal(check(root, migration, withScope).kind, 'protectedZone', 'an empty data model approves nothing');
  plan('- users (id, email, password_hash)\n');
  assert.equal(check(root, migration, withScope).decision, 'allow');
  assert.equal(check(root, migration, { spec: spec('spec-approved'), tasks: [T2] }).kind, 'protectedZone', 'the plan is not approved yet');
});

test('code without a pending task, or outside its scope, raises an alert; tasks of two components run side by side', (t) => {
  const root = project(t);
  const f = 'apps/api/src/auth/login.ts';
  assert.deepEqual([check(root, f, idle).decision, check(root, f, idle).kind], ['warn', 'noTask']);
  assert.equal(check(root, f, { spec: spec('spec-approved'), tasks: [T2] }).kind, 'noTask', 'the plan is not approved yet');
  assert.equal(check(root, f, implementing()).decision, 'allow');
  assert.equal(check(root, 'apps/api/src/auth/login.test.ts', implementing()).decision, 'allow');
  assert.equal(check(root, 'apps/api/tests/auth.e2e.ts', implementing()).decision, 'allow');
  assert.equal(check(root, 'apps/api/src/db/pool.ts', implementing()).kind, 'outOfScope');
  assert.equal(check(root, 'apps/web/src/App.tsx', implementing()).kind, 'noTask', 'no pending task of that component');
  assert.equal(check(root, f, implementing([{ ...T2, done: true }])).kind, 'noTask', 'done tasks do not count');
  // Frontend and backend tasks at once: each file belongs to the tasks of its component.
  const both = implementing([T2, { id: 'T3', done: false, component: 'web', scope: ['apps/web/src/**'] }]);
  assert.equal(check(root, 'apps/web/src/App.tsx', both).decision, 'allow');
  assert.equal(check(root, f, both).decision, 'allow');
  // A task added during implementation with only its component covers the whole component.
  assert.equal(check(root, 'apps/api/src/db/pool.ts', implementing([T2, { id: 'T9', done: false, component: 'api', scope: [] }])).decision, 'allow');
  // Files outside every component (monorepo root) are not code.
  assert.equal(check(root, 'turbo.json', idle).decision, 'allow');
});

test('content after Write, Edit and MultiEdit', () => {
  assert.equal(contentAfter({ content: 'x' }, 'old'), 'x');
  assert.equal(contentAfter({ old_string: 'a', new_string: 'b' }, 'aaa'), 'baa');
  assert.equal(contentAfter({ old_string: 'a', new_string: 'b', replace_all: true }, 'aaa'), 'bbb');
  assert.equal(contentAfter({ edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'c', new_string: 'd' }] }, 'ac'), 'bd');
  assert.equal(componentOf('apps/api/src/x.ts', settings.components).id, 'api');
  assert.equal(componentOf('README.md', settings.components), null);
});
