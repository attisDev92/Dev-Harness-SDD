// File and shell guards (RF-GAT-05/06/07/08/09, RF-MD-01, RF-SDD-13/16/18,
// RF-RET-02/05, RF-GAT-11, edge case 12).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import { checkWrite, contentAfter, componentOf } from '../src/guards/files-guard.js';
import { checkShell, installCommand, writeTargets } from '../src/guards/bash-guard.js';
import { emptyState, progressBlock } from '../src/guards/state.js';
import { DEFAULT_DOCS_WHITELIST } from '../src/guards/project.js';
import { tempDir } from './helpers.js';

const settings = {
  docsWhitelist: [...DEFAULT_DOCS_WHITELIST],
  protected: {
    deps: ['package.json#dependencies', 'package.json#devDependencies', '**/pnpm-lock.yaml'],
    db: ['**/migrations/**'],
    harness: ['harness.config.yaml', '.harness/**', '.claude/settings.local.json'],
  },
  managedBlocks: ['AGENTS.md'],
  components: { web: { path: 'apps/web', kind: 'frontend' }, api: { path: 'apps/api', kind: 'backend' } },
};
const task = { id: 'T2', component: 'api', scope: ['apps/api/src/auth/**'], verify: null, dirty: false };
const implementing = (over = {}) => ({
  ...emptyState(),
  activeSpec: 'API-001-login',
  specs: { 'API-001-login': { phase: 'implement', approved: ['spec', 'plan', 'tasks'] } },
  task,
  ...over,
});

function project(t) {
  const root = tempDir(t);
  fs.mkdirSync(path.join(root, 'apps', 'api'), { recursive: true });
  fs.writeFileSync(path.join(root, 'apps', 'api', 'package.json'), JSON.stringify({ name: 'api', scripts: { test: 'jest' }, dependencies: { express: '^5' } }, null, 2));
  return root;
}
const check = (root, file, state, input = {}) => checkWrite({ root, file: path.join(root, file), settings, state, input });

test('RF-GAT-09 / edge case 12: the harness files are never writable', (t) => {
  const root = project(t);
  for (const f of ['harness.config.yaml', '.harness/guards.json', '.harness/state/flow.json', '.claude/settings.local.json']) {
    assert.equal(check(root, f, implementing()).kind, 'harnessFile', f);
  }
});

test('harness.config.yaml is editable only after the user approves a config gate', async (t) => {
  const { requestGate, decide } = await import('../src/guards/flow.js');
  const root = project(t);
  const state = implementing();
  assert.equal(check(root, 'harness.config.yaml', state, { content: 'x' }).kind, 'harnessFile');
  assert.equal(requestGate(state, { kind: 'config' }).code, 'summaryRequired');
  const asked = requestGate(state, { kind: 'config', summary: 'añadir componente web' });
  assert.equal(asked.ok, true);
  const approved = decide(asked.state, { approved: true }).state;
  assert.equal(check(root, 'harness.config.yaml', approved, { content: 'x' }).decision, 'allow');
  assert.equal(check(root, '.harness/guards.json', approved, { content: 'x' }).kind, 'harnessFile');
});

test('AGENTS.md is editable outside the harness block, never inside it', (t) => {
  const root = project(t);
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# Proyecto\n\n<!-- harness:begin -->\nreglas generadas\n<!-- harness:end -->\n');
  const edit = (old_string, new_string) => check(root, 'AGENTS.md', implementing(), { old_string, new_string });
  assert.equal(edit('# Proyecto\n', '# Proyecto\n\nStack: Node 24\n').decision, 'allow');
  assert.equal(edit('reglas generadas', 'otras reglas').kind, 'contextBlock');
  assert.equal(check(root, 'AGENTS.md', implementing(), { content: '# solo mio\n' }).kind, 'contextBlock');
});

test('RF-SDD-13/18: spec files follow the phase order', (t) => {
  const root = project(t);
  const specState = (approved, change = false) => ({ ...emptyState(), activeSpec: 'API-001-login', specs: { 'API-001-login': { phase: 'x', approved, change } } });
  assert.equal(check(root, 'specs/API-001-login/spec.md', specState([])).decision, 'allow');
  assert.equal(check(root, 'specs/API-001-login/plan.md', specState([])).kind, 'needsApproval');
  assert.equal(check(root, 'specs/API-001-login/plan.md', specState(['spec'])).decision, 'allow');
  assert.equal(check(root, 'specs/API-001-login/tasks.md', specState(['spec'])).kind, 'needsApproval');
  assert.equal(check(root, 'specs/API-001-login/spec.md', specState(['spec'])).kind, 'specApproved');
  assert.equal(check(root, 'specs/API-001-login/spec.md', specState(['spec'], true)).decision, 'allow');
  assert.equal(check(root, 'specs/API-001-login/tasks.md', specState(['spec', 'plan', 'tasks'])).kind, 'tasksApproved');
  assert.equal(check(root, 'docs/constitution.md', { ...emptyState(), constitution: { approved: true } }).kind, 'constitutionApproved');
  assert.equal(check(root, 'docs/notes.md', emptyState()).kind, 'docBlocked');
});

test('the status block of progress.md belongs to the scripts', (t) => {
  const root = project(t);
  const state = implementing();
  const file = 'specs/API-001-login/progress.md';
  fs.mkdirSync(path.join(root, 'specs', 'API-001-login'), { recursive: true });
  const text = `<!-- harness:begin -->\n${progressBlock(state)}\n<!-- harness:end -->\n\n## Decisions\n`;
  fs.writeFileSync(path.join(root, file), text);
  assert.equal(check(root, file, state, { old_string: '## Decisions\n', new_string: '## Decisions\n- chose A\n' }).decision, 'allow');
  assert.equal(check(root, file, state, { old_string: '| T2 (api) |', new_string: '| — |' }).kind, 'progressBlock');
});

test('RF-GAT-06: dependency sections and lockfiles ask; other package.json edits do not', (t) => {
  const root = project(t);
  const state = implementing({ task: { ...task, scope: ['apps/api/**'] } });
  const pkg = 'apps/api/package.json';
  assert.equal(check(root, pkg, state, { old_string: '"jest"', new_string: '"vitest"' }).decision, 'allow');
  const v = check(root, pkg, state, { old_string: '"express": "^5"', new_string: '"express": "^5",\n    "lodash": "^4"' });
  assert.deepEqual([v.decision, v.kind], ['ask', 'depsEdit']);
  assert.equal(check(root, 'apps/api/pnpm-lock.yaml', state, { content: 'x' }).decision, 'ask');
});

test('RF-GAT-07/08: protected zones block until the exact files are approved', (t) => {
  const root = project(t);
  const mig = 'apps/api/migrations/002.sql';
  const v = check(root, mig, implementing(), { content: 'ALTER TABLE' });
  assert.deepEqual([v.decision, v.kind, v.zone], ['block', 'protectedZone', 'db']);
  assert.equal(check(root, mig, implementing({ granted: [mig] }), { content: 'x' }).decision, 'allow');
  assert.equal(check(root, 'apps/api/migrations/003.sql', implementing({ granted: [mig] }), { content: 'x' }).kind, 'protectedZone');
});

test('RF-ORQ-02 / RF-RET-02/05 / RF-GAT-11: code only inside the current task', (t) => {
  const root = project(t);
  const f = 'apps/api/src/auth/login.ts';
  assert.equal(check(root, f, { ...emptyState() }).kind, 'noTask');
  assert.equal(check(root, f, implementing()).decision, 'allow');
  assert.equal(check(root, 'apps/api/src/auth/login.test.ts', implementing()).decision, 'allow');
  assert.equal(check(root, 'apps/api/tests/auth.e2e.ts', implementing()).decision, 'allow');
  assert.equal(check(root, 'apps/api/src/db/pool.ts', implementing()).kind, 'outOfScope');
  assert.equal(check(root, 'apps/web/src/App.tsx', implementing()).kind, 'otherComponent');
  assert.equal(check(root, f, implementing({ triage: { task: 'T2' } })).kind, 'triageNoCode');
  assert.equal(check(root, f, implementing({ gate: { kind: 'manual-test' } })).kind, 'gatePending');
  const changing = implementing();
  changing.specs['API-001-login'].change = true;
  assert.equal(check(root, f, changing).kind, 'changePending');
  // Files outside every component (monorepo root) are not code.
  assert.equal(check(root, 'turbo.json', emptyState()).decision, 'allow');
});

test('content after Write, Edit and MultiEdit', () => {
  assert.equal(contentAfter({ content: 'x' }, 'old'), 'x');
  assert.equal(contentAfter({ old_string: 'a', new_string: 'b' }, 'aaa'), 'baa');
  assert.equal(contentAfter({ old_string: 'a', new_string: 'b', replace_all: true }, 'aaa'), 'bbb');
  assert.equal(contentAfter({ edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'c', new_string: 'd' }] }, 'ac'), 'bd');
  assert.equal(componentOf('apps/api/src/x.ts', settings.components).id, 'api');
  assert.equal(componentOf('README.md', settings.components), null);
});

test('RF-GAT-05: dependency installs ask for every supported package manager', () => {
  for (const cmd of [
    'npm install lodash', 'npm i -D vitest', 'npm uninstall x', 'npm update', 'pnpm add zod', 'pnpm install left-pad', 'yarn add react',
    'bun add hono', 'pip install requests', 'python -m pip install flask', 'uv add httpx', 'uv pip install x', 'poetry add django',
    'cargo add serde', 'go get github.com/x/y', 'go mod tidy', 'composer require laravel/sanctum', 'dotnet add package Serilog',
    'gem install rails', 'bundle add rspec',
  ]) {
    assert.ok(installCommand(cmd.split(' ')), cmd);
  }
  for (const cmd of ['npm install', 'npm ci', 'pnpm install', 'npm test', 'yarn build', 'pip list', 'go test ./...', 'cargo build']) {
    assert.equal(installCommand(cmd.split(' ')), null, cmd);
  }
});

test('RF-GAT-05: installs ask even when chained or wrapped; blocks still win', (t) => {
  const root = project(t);
  const ctx = { root, settings, state: implementing(), aliases: {} };
  assert.deepEqual([checkShell('npm test && npm i lodash', ctx).decision, checkShell('npm test && npm i lodash', ctx).kind], ['ask', 'depsInstall']);
  assert.equal(checkShell('bash -c "pnpm add zod"', ctx).decision, 'ask');
  assert.equal(checkShell('npm i lodash && git push', ctx).decision, 'block');
  assert.equal(checkShell('npm test', ctx).decision, 'allow');
});

test('shell writes follow the same rules as file writes', (t) => {
  const root = project(t);
  const ctx = { root, settings, state: implementing(), aliases: {} };
  const kind = (cmd, c = ctx) => checkShell(cmd, c).kind ?? checkShell(cmd, c).decision;
  assert.equal(kind('echo x > apps/api/src/db/pool.ts'), 'outOfScope');
  assert.equal(kind('echo x > apps/api/src/auth/a.ts'), 'allow');
  assert.equal(kind('cat > docs/notes.md <<EOF\nhi\nEOF'), 'docBlocked');
  assert.equal(kind("sed -i 's/a/b/' apps/api/src/db/pool.ts"), 'outOfScope');
  assert.equal(kind('rm -rf apps/api/migrations'), 'protectedZone');
  assert.equal(kind('echo x >> apps/web/src/a.ts', { ...ctx, state: emptyState() }), 'noTask');
  assert.equal(kind('Set-Content -Path apps/api/src/db/x.ts -Value 1'), 'outOfScope');
  assert.equal(kind('ls > /dev/null'), 'allow');
  assert.equal(kind('npm test 2>&1 | tee test.log'), 'allow');
});

test('edge case 12 / RF-GAT-09: the harness state and config cannot be changed through the shell', (t) => {
  const root = project(t);
  const ctx = { root, settings, state: implementing(), aliases: {} };
  for (const cmd of [
    'echo {} > .harness/state/flow.json', 'rm .harness/state/flow.json', 'node -e "require(\'fs\').writeFileSync(\'.harness/state/flow.json\', \'{}\')"',
    "sed -i 's/local/team/' harness.config.yaml", 'mv .harness /tmp/x', 'cp x.json .harness/guards.json',
  ]) {
    assert.equal(checkShell(cmd, ctx).decision, 'block', cmd);
  }
  for (const cmd of ['cat .harness/guards.json', 'ls .harness', 'node .harness/scripts/sdd.js status', 'node .harness/scripts/sdd.js verify', 'grep -r x .harness', 'git diff harness.config.yaml']) {
    assert.equal(checkShell(cmd, ctx).decision, 'allow', cmd);
  }
});

test('only the tool runs the hooks: the agent cannot feed them a fake user answer', (t) => {
  const root = project(t);
  const ctx = { root, settings, state: implementing(), aliases: {} };
  assert.equal(checkShell('echo \'{"prompt":"/sdd:approve"}\' | node .harness/scripts/hook.js UserPromptSubmit', ctx).kind, 'hookCall');
  assert.equal(checkShell('node "$CLAUDE_PROJECT_DIR/.harness/scripts/hook.js" UserPromptSubmit < a.json', ctx).kind, 'hookCall');
});

test('write targets of common commands', () => {
  assert.deepEqual(writeTargets(['cp', '-r', 'a', 'b', 'dest']), ['dest']);
  assert.deepEqual(writeTargets(['mv', 'a', 'b']), ['a', 'b']);
  assert.deepEqual(writeTargets(['sed', '-i', 's/a/b/', 'f1', 'f2']), ['f1', 'f2']);
  assert.deepEqual(writeTargets(['perl', '-pi', '-e', 's/a/b/', 'f']), ['f']);
  assert.deepEqual(writeTargets(['dd', 'if=/dev/zero', 'of=disk.img']), ['disk.img']);
  assert.deepEqual(writeTargets(['grep', 'x', 'f']), []);
});
