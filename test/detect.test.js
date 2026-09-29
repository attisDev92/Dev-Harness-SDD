// Detection used by init (RF-INI-02, 03, 05, 11, 12; RF-CNV-01..03, RF-CNV-06; edge cases 1, 3, 4, 22).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { detectProject, detectTopology, proposeProtected } from '../src/detect/project.js';
import { analyzeDir, proposePrefix } from '../src/detect/stack.js';
import { detectConventions, detectTextLanguage } from '../src/detect/conventions.js';
import { FIXTURES, write, initRepo } from './fixtures.js';
import { tempDir } from './helpers.js';

test('RF-INI-02: topology of each fixture', (t) => {
  assert.equal(detectProject(FIXTURES.frontend(t)).topology, 'single');
  assert.equal(detectProject(FIXTURES.monorepo(t)).topology, 'monorepo');
  const ws = detectTopology(FIXTURES.workspace(t));
  assert.deepEqual([ws.topology, ws.isRepo, ws.childRepos], ['workspace', false, ['api', 'web']]);
  const multi = detectTopology(FIXTURES.multiRepo(t));
  assert.deepEqual([multi.isRepo, multi.ambiguous, multi.childRepos], [true, true, ['client']]);
  const empty = detectTopology(tempDir(t));
  assert.deepEqual([empty.topology, empty.isRepo], [null, false]);
});

test('RF-INI-03 / RF-INI-11: components, stack, kind and verification commands', (t) => {
  const front = detectProject(FIXTURES.frontend(t)).components;
  assert.equal(front.length, 1);
  assert.deepEqual(
    [front[0].path, front[0].kind, front[0].stack, front[0].verify],
    ['.', 'frontend', 'react+vite+ts', { lint: 'npm run lint', typecheck: 'npm run typecheck', test: 'npm test', e2e: 'npm run test:e2e' }],
  );

  const mono = Object.fromEntries(detectProject(FIXTURES.monorepo(t)).components.map((c) => [c.id, c]));
  assert.deepEqual(Object.keys(mono).sort(), ['api', 'web']);
  assert.deepEqual([mono.web.path, mono.web.kind, mono.web.stack], ['apps/web', 'frontend', 'next+ts']);
  assert.deepEqual([mono.api.kind, mono.api.stack], ['backend', 'nestjs+prisma+postgres']);
  assert.deepEqual(mono.api.verify, { test: 'pnpm test', e2e: 'pnpm run test:e2e' });
  assert.deepEqual([mono.web.id_prefix, mono.api.id_prefix], ['WEB', 'API']);

  const ws = Object.fromEntries(detectProject(FIXTURES.workspace(t)).components.map((c) => [c.id, c]));
  assert.deepEqual([ws.api.kind, ws.api.stack, ws.api.verify.test], ['backend', 'chi', 'go test ./...']);
  assert.deepEqual([ws.web.kind, ws.web.stack], ['frontend', 'vue']);

  const multi = Object.fromEntries(detectProject(FIXTURES.multiRepo(t)).components.map((c) => [c.path, c]));
  assert.deepEqual([multi['.'].stack, multi['.'].verify], ['fastapi+postgres', { test: 'pytest', lint: 'ruff check .' }]);
  assert.equal(multi.client.kind, 'frontend');
});

test('RF-INI-03: other ecosystems', (t) => {
  const root = tempDir(t);
  write(root, {
    'php/composer.json': { require: { 'laravel/framework': '^11' }, scripts: { test: 'phpunit' } },
    'rs/Cargo.toml': '[package]\nname = "x"\n[dependencies]\naxum = "0.7"\n',
    'rb/Gemfile': "gem 'rails'\n",
    'net/App.csproj': '<Project Sdk="Microsoft.NET.Sdk.Web"></Project>\n',
    'lib/package.json': { name: 'lib', main: 'index.js', scripts: { test: 'echo "Error: no test specified" && exit 1' } },
  });
  assert.deepEqual([analyzeDir(root, 'php').stack, analyzeDir(root, 'php').verify.test], ['laravel', 'composer test']);
  assert.deepEqual([analyzeDir(root, 'rs').stack, analyzeDir(root, 'rs').kind], ['axum', 'backend']);
  assert.equal(analyzeDir(root, 'rb').stack, 'rails');
  assert.equal(analyzeDir(root, 'net').stack, 'aspnet');
  const lib = analyzeDir(root, 'lib');
  assert.deepEqual([lib.kind, lib.verify], ['other', {}]);
  assert.equal(analyzeDir(root, 'nothing-here'), null);
});

test('RF-INI-05: prefix proposals are derived from the id and unique', () => {
  assert.equal(proposePrefix('web'), 'WEB');
  assert.equal(proposePrefix('api'), 'API');
  assert.equal(proposePrefix('admin-panel'), 'AP');
  assert.equal(proposePrefix('backoffice'), 'BAC');
  assert.equal(proposePrefix('web', new Set(['WEB'])), 'WEB2');
  assert.equal(proposePrefix('3d'), 'C3D');
});

test('RF-INI-12: protected zones follow the detected stack', (t) => {
  const zones = detectProject(FIXTURES.monorepo(t)).protected;
  assert.ok(zones.deps.includes('package.json#dependencies'));
  assert.ok(zones.deps.includes('**/pnpm-lock.yaml'));
  assert.ok(zones.db.includes('**/schema.prisma'));
  assert.ok(zones.architecture.includes('**/tsconfig*.json'));
  assert.ok(zones.architecture.includes('**/next.config.*'));
  assert.deepEqual(zones.contracts, ['**/specs/**/contracts/**']);
  const go = proposeProtected([{ ecosystems: ['go'], databases: [], frameworks: [] }]);
  assert.deepEqual(go.deps, ['**/go.mod', '**/go.sum']);
  // Edge case 22: unknown package manager → nothing proposed, the user fills it in.
  assert.deepEqual(proposeProtected([{ ecosystems: [], databases: [], frameworks: [] }]).deps, []);
});

test('RF-CNV-01/02: declared conventions are read from the project files', (t) => {
  const conv = detectConventions(FIXTURES.existingConfig(t));
  assert.deepEqual(conv.sources.slice(0, 4), ['AGENTS.md', 'CLAUDE.md', 'CONTRIBUTING.md', '.editorconfig']);
  assert.equal(conv.commits, 'conventional');
  assert.equal(conv.languages.commits, 'en');
  assert.ok(conv.style.includes('indent: 2 space'));
});

test('RF-CNV-06: commit conventions from tooling, guidance and history', (t) => {
  assert.equal(detectConventions(FIXTURES.frontend(t)).commits, 'conventional'); // history
  const custom = tempDir(t);
  write(custom, { 'CONTRIBUTING.md': '# Contributing\n\n## Commit messages\n\nUse "[AREA] Summary", e.g. "[API] Add login".\n' });
  initRepo(custom);
  assert.deepEqual([detectConventions(custom).commits, detectConventions(custom).commitsNote], ['custom', 'CONTRIBUTING.md']);
  const gitmoji = tempDir(t);
  write(gitmoji, { 'a.txt': 'x' });
  initRepo(gitmoji, { messages: [':sparkles: add', ':bug: fix', ':memo: docs', ':art: style', ':fire: remove'] });
  assert.equal(detectConventions(gitmoji).commits, 'gitmoji');
  const none = tempDir(t);
  write(none, { 'a.txt': 'x' });
  initRepo(none, { messages: ['wip'] });
  assert.equal(detectConventions(none).commits, undefined);
});

test('RF-CNV-03: languages are detected when there is a signal and left undefined otherwise', (t) => {
  assert.equal(detectTextLanguage('Este es el proyecto de la clínica para la gestión de las citas y de los pacientes que se atienden en el centro.'), 'es');
  assert.equal(detectTextLanguage('This is the web shop for the store. It is used by the customers to browse and buy the products that are in stock.'), 'en');
  assert.equal(detectTextLanguage('Hola'), undefined);
  const mono = detectConventions(FIXTURES.monorepo(t), ['apps/web', 'apps/api']);
  assert.deepEqual([mono.languages.docs, mono.languages.specs], ['es', 'es']);
  const front = detectConventions(FIXTURES.frontend(t));
  // Five short subjects are not enough signal: commits stays undefined and init asks.
  assert.deepEqual([front.languages.docs, front.languages.ui, front.languages.commits], ['en', 'en', undefined]);
  const bare = tempDir(t);
  write(bare, { 'x.txt': '1' });
  initRepo(bare, { commit: false });
  assert.deepEqual(detectConventions(bare).languages, { code: undefined, specs: undefined, docs: undefined, commits: undefined, ui: undefined });
});

test('agent tools already present are proposed', (t) => {
  assert.deepEqual(detectProject(FIXTURES.existingConfig(t)).tools, ['claude-code']);
  const root = tempDir(t);
  write(root, { 'opencode.json': '{}', '.agents/workflows/x.md': '' });
  initRepo(root);
  assert.deepEqual(detectProject(root).tools, ['opencode', 'antigravity']);
  assert.ok(path.isAbsolute(detectProject(root).root));
});
