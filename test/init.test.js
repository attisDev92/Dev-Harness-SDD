// sdd-harness-init (RF-INI-01..18, RF-INS-07, edge cases 1, 2, 3, 4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { FIXTURES, run, snapshot, git, write } from './fixtures.js';
import { runCli, tempDir } from './helpers.js';
import { validateConfig } from '../src/config/schema.js';

const readConfig = (root) => parse(fs.readFileSync(path.join(root, 'harness.config.yaml'), 'utf8'));
const exists = (root, p) => fs.existsSync(path.join(root, p));

test('RF-INI-01/14: init --yes activates the project with the detected values', async (t) => {
  const root = FIXTURES.monorepo(t);
  const r = await run(['init', '--yes'], { cwd: root });
  assert.equal(r.code, 0, r.stderr);
  const config = readConfig(root);
  assert.deepEqual(validateConfig(config), []);
  assert.equal(config.topology, 'monorepo');
  assert.deepEqual(Object.keys(config.components).sort(), ['api', 'web']);
  assert.equal(config.install_mode, 'local');
  assert.deepEqual(config.tools, ['claude-code']);
  assert.equal(config.language.docs, 'es');
  assert.ok(exists(root, '.harness/manifest.lock'));
  assert.ok(exists(root, 'AGENTS.md'));
  assert.ok(exists(root, 'apps/api/AGENTS.md'));
  // RF-GEN-08: every generated item is in the manifest with its path, hash and generator.
  const manifest = JSON.parse(fs.readFileSync(path.join(root, '.harness/manifest.lock'), 'utf8'));
  const owned = manifest.entries.filter((e) => e.kind === 'file' || e.kind === 'block');
  assert.ok(owned.length > 15);
  for (const e of owned) {
    assert.match(e.hash, /^[0-9a-f]{64}$/, e.path);
    assert.ok(['core', 'claude-code', 'githooks'].includes(e.generator), e.path);
    assert.ok(exists(root, e.path), e.path);
  }
  assert.ok(manifest.entries.some((e) => e.kind === 'config' && e.path === 'harness.config.yaml'));
  // RF-MOD-01: nothing shows up for the rest of the team.
  assert.equal(git(root, 'status', '--porcelain'), '');
  assert.equal(exists(root, '.gitignore'), false);
});

test('RF-INI-02..10: every interview answer ends up in the configuration', async (t) => {
  const root = FIXTURES.monorepo(t);
  const answers = {
    topology: 'monorepo',
    'kind:web': 'frontend',
    'prefix:web': 'FRONT',
    'verify:api': false,
    'verify:api:lint': 'pnpm lint',
    'verify:api:typecheck': '',
    'verify:api:test': 'pnpm jest',
    'verify:api:e2e': '',
    tools: ['claude-code', 'opencode'],
    conventions: false,
    commits: 'gitmoji',
    'lang:code': 'en',
    'lang:specs': 'en',
    'lang:docs': 'es',
    'lang:commits': 'en',
    'lang:ui': 'pt-br',
    design: 'penpot',
    tracker: 'linear',
    manualTest: 'story',
    installMode: 'team',
    artifacts: 'local',
    protectedOk: false,
    'protected:deps': 'package.json#dependencies, **/pnpm-lock.yaml',
  };
  const r = await run(['init'], { cwd: root, answers });
  assert.equal(r.code, 0, r.stderr);
  const c = readConfig(root);
  assert.equal(c.components.web.id_prefix, 'FRONT');
  assert.deepEqual(c.components.api.verify, { lint: 'pnpm lint', test: 'pnpm jest' });
  assert.deepEqual(c.tools, ['claude-code', 'opencode']);
  assert.equal(c.conventions.commits, 'gitmoji');
  assert.deepEqual(c.language, { code: 'en', specs: 'en', docs: 'es', commits: 'en', ui: 'pt-br' });
  assert.deepEqual(c.design, { source: 'penpot' });
  assert.deepEqual(c.tracker, { enabled: true, provider: 'linear' });
  assert.equal(c.gates.manual_test, 'story');
  assert.equal(c.install_mode, 'team');
  assert.deepEqual(c.artifacts, { versioned: false });
  assert.deepEqual(c.protected.deps, ['package.json#dependencies', '**/pnpm-lock.yaml']);
  // Team mode: CLAUDE.md, not CLAUDE.local.md.
  assert.ok(exists(root, 'CLAUDE.md'));
  assert.ok(!exists(root, 'CLAUDE.local.md'));
});

test('RF-INI-05: an invalid prefix is asked again and the proposal is kept', async (t) => {
  const root = FIXTURES.frontend(t);
  const r = await run(['init'], { cwd: root, answers: { 'prefix:shop-web': 'bad prefix!' } });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(readConfig(root).components['shop-web'].id_prefix, 'SW');
});

test('RF-INI-06: the design source is only asked when there is a frontend', async (t) => {
  const ws = FIXTURES.workspace(t);
  const answers = {};
  const r = await run(['init'], { cwd: ws, answers });
  assert.equal(r.code, 0, r.stderr);
  const cfg = readConfig(ws);
  assert.equal(cfg.topology, 'workspace');
  assert.deepEqual(cfg.design, { source: 'none' });

  const api = tempDir(t);
  write(api, { 'go.mod': 'module x\n' });
  git(api, 'init', '-q');
  const { createScriptedPrompter } = await import('../src/cli/prompt.js');
  const prompter = createScriptedPrompter({});
  const { main } = await import('../src/cli/main.js');
  await main(['init'], { stdout: { write() {} }, stderr: { write() {} }, env: { HARNESS_LANG: 'en' }, cwd: api, readStdin: async () => '', prompter });
  assert.ok(!prompter.asked.includes('design'));
  assert.ok(prompter.asked.includes('tracker'));
});

test('RF-INI-13: the summary lists every file before anything is written; --dry-run writes nothing', async (t) => {
  const root = FIXTURES.frontend(t);
  const before = snapshot(root);
  const r = await run(['init', '--yes', '--dry-run'], { cwd: root });
  assert.equal(r.code, 0, r.stderr);
  for (const f of ['harness.config.yaml', 'AGENTS.md', 'CLAUDE.local.md', '.harness/guards.json', '.harness/manifest.lock', '.git/info/exclude']) {
    assert.match(r.stdout, new RegExp(`[+~] ${f.replace(/\./g, '\\.')}`), f);
  }
  assert.match(r.stdout, /Dry run: nothing was written/);
  assert.deepEqual(snapshot(root), before);
});

test('RF-INI-13: declining the final confirmation writes nothing', async (t) => {
  const root = FIXTURES.frontend(t);
  const before = snapshot(root);
  const r = await run(['init'], { cwd: root, answers: { apply: false } });
  assert.equal(r.code, 1);
  assert.deepEqual(snapshot(root), before);
});

test('RF-INI-15: init --config <file> --yes skips the interview', async (t) => {
  const root = FIXTURES.frontend(t);
  const cfgDir = tempDir(t);
  const cfgFile = path.join(cfgDir, 'preset.yaml');
  fs.writeFileSync(cfgFile, 'harness_version: 0.2.0\ninstall_mode: team\ntools: [codex]\ntopology: single\ncomponents:\n  app: {path: ., kind: frontend, id_prefix: SHOP}\nlanguage: {docs: es, specs: es}\n');
  const r = await run(['init', '--config', cfgFile, '--yes'], { cwd: root });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(readConfig(root).tools, ['codex']);
  assert.ok(!exists(root, 'CLAUDE.md'));
  assert.match(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), /Reglas innegociables/);

  const bad = path.join(cfgDir, 'bad.yaml');
  fs.writeFileSync(bad, 'harness_version: 0.2.0\ntools: [vim]\ntopology: single\ncomponents: {app: {path: .}}\n');
  const other = FIXTURES.frontend(t);
  const r2 = await run(['init', '--config', bad, '--yes'], { cwd: other });
  assert.equal(r2.code, 1);
  assert.match(r2.stderr, /tools\[0\]: "vim" is not allowed/);
  assert.ok(!exists(other, 'harness.config.yaml'));
});

test('RF-INI-16: an activated project is not reinstalled', async (t) => {
  const root = FIXTURES.frontend(t);
  assert.equal((await run(['init', '--yes'], { cwd: root })).code, 0);
  const before = snapshot(root);
  const r = await run(['init', '--yes'], { cwd: root });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /harness sync.*sdd-harness upgrade/);
  assert.deepEqual(snapshot(root), before);
});

test('RF-INI-17: cancelling at any question writes nothing', async (t) => {
  for (const cancelAt of ['topology', 'tools', 'installMode', 'protectedOk', 'apply']) {
    const root = FIXTURES.monorepo(t);
    const before = snapshot(root);
    const r = await run(['init'], { cwd: root, cancelAt });
    assert.equal(r.code, 130, cancelAt);
    assert.match(r.stderr, /Cancelled\. Nothing was written/);
    assert.deepEqual(snapshot(root), before, cancelAt);
  }
});

test('RF-INI-17: end of input (Ctrl+D / closed pipe) cancels too', (t) => {
  const root = FIXTURES.frontend(t);
  const before = snapshot(root);
  const r = runCli(['init'], { cwd: root, input: '\n\n' });
  assert.equal(r.code, 130, r.stdout + r.stderr);
  assert.deepEqual(snapshot(root), before);
});

test('RF-INI-01: the interview also works with piped answers', (t) => {
  const root = FIXTURES.frontend(t);
  // topology, kind, prefix, verify, tools, conventions, lang:code, lang:commits, design, tracker, manual, mode, artifacts, gitHooks, ci, protected, apply
  const input = ['', '', 'SHOP', '', '2', '', '', 'es', '2', '', '', '', '', '', '', '', 'y'].join('\n') + '\n';
  const r = runCli(['init'], { cwd: root, input });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const c = readConfig(root);
  assert.deepEqual([c.components['shop-web'].id_prefix, c.tools, c.language.commits, c.design.source], ['SHOP', ['opencode'], 'es', 'tokens-in-code']);
});

test('RF-INI-18: a write failure rolls everything back', async (t) => {
  const root = FIXTURES.existingConfig(t);
  const before = snapshot(root);
  let n = 0;
  const failing = { ...fs, renameSync: (a, b) => { n += 1; if (n === 6) throw new Error('EACCES: permission denied'); return fs.renameSync(a, b); } };
  const r = await run(['init', '--yes'], { cwd: root, fs: failing });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /rolled back/);
  assert.deepEqual(snapshot(root), before);
});

test('edge case 1: a folder without git is only accepted as a workspace', async (t) => {
  const plain = tempDir(t);
  write(plain, { 'package.json': { name: 'x' } });
  const r = await run(['init', '--yes'], { cwd: plain });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /not a git repository/);
  assert.deepEqual(fs.readdirSync(plain), ['package.json']);
});

test('edge case 2: a repository without commits can be activated', async (t) => {
  const root = tempDir(t);
  write(root, { 'package.json': { name: 'fresh', dependencies: { express: '^5' } } });
  git(root, 'init', '-q');
  const r = await run(['init', '--yes'], { cwd: root });
  assert.equal(r.code, 0, r.stderr);
});

test('edge cases 3 and 4: a repo with nested repos asks monorepo or workspace, then each nested repo', async (t) => {
  const root = FIXTURES.multiRepo(t);
  const r = await run(['init'], { cwd: root, answers: { topology: 'monorepo', 'nested:client': false } });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /also contains other repositories \(client\)/);
  assert.deepEqual(Object.values(readConfig(root).components).map((c) => c.path), ['.']);
});

test('existing agent files: user content is kept and the block is added (team mode)', async (t) => {
  const root = FIXTURES.existingConfig(t);
  const r = await run(['init', '--yes', '--mode', 'team'], { cwd: root });
  assert.equal(r.code, 0, r.stderr);
  const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  assert.ok(agents.startsWith('# Team rules\n\nUse 2 spaces. Commit messages in English.\n\n<!-- harness:begin -->'));
  const claude = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8');
  assert.equal(claude, '# Claude\n\nRead AGENTS.md.\n\n<!-- harness:begin -->\n@AGENTS.md\n<!-- harness:end -->\n');
  const config = readConfig(root);
  assert.equal(config.conventions.commits, 'conventional');
  assert.ok(config.conventions.sources.includes('CONTRIBUTING.md'));
  // The existing hooks manager is left alone (RF-VER-05 arrives in v0.3).
  assert.equal(git(root, 'config', 'core.hooksPath').trim(), '.husky');
});

test('existing agent files in local mode: committed files are not modified (RF-MOD-02/04)', async (t) => {
  const root = FIXTURES.existingConfig(t);
  const r = await run(['init', '--yes', '--tools', 'claude-code,codex'], { cwd: root });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(git(root, 'status', '--porcelain'), '');
  assert.equal(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), '# Team rules\n\nUse 2 spaces. Commit messages in English.\n');
  assert.equal(fs.readFileSync(path.join(root, 'CLAUDE.local.md'), 'utf8'), '<!-- harness:begin -->\n@.harness/context/AGENTS.md\n<!-- harness:end -->\n');
  assert.match(r.stdout, /codex is not configured: in local mode it would need to modify AGENTS\.md/);
});

test('invalid --tools and --mode values are rejected before anything is asked', async (t) => {
  const root = FIXTURES.frontend(t);
  assert.equal((await run(['init', '--tools', 'vim'], { cwd: root })).code, 1);
  assert.equal((await run(['init', '--mode', 'shared'], { cwd: root })).code, 1);
  assert.ok(!exists(root, 'harness.config.yaml'));
});
