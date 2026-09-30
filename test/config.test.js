// RF-GEN-12 (configuration schema), edge case 5, RNF-05.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseConfig } from '../src/config/load.js';
import { runCli, tempDir } from './helpers.js';

// The example published in the README must always be valid.
const README_EXAMPLE = `harness_version: 1.0.0
install_mode: local            # local (default) | team
tools: [claude-code, opencode]

language:
  code: en
  specs: es
  docs: es
  commits: en
  ui: es

topology: workspace
components:
  web: { path: ./web-app, id_prefix: WEB, stack: "react+vite+ts" }
  api: { path: ./api,     id_prefix: API, stack: "nestjs+postgres" }

design:
  source: none

tracker:
  enabled: false

gates:
  manual_test: task
  commits: human-only
  deps: ask

retries:
  in_scope: 2
  protected: 0

protected:
  deps:         [package.json#dependencies, lockfiles]
  db:           ["**/migrations/**", "**/schema.prisma", "**/*.sql"]
  contracts:    ["specs/**/contracts/**"]
  architecture: ["tsconfig*.json", "**/eslint.config.*", "docker*", ".env*"]
  security:     [auth, cors, csp]

docs_whitelist:
  - README.md
  - CHANGELOG.md
  - "specs/*/{spec,plan,tasks,progress}.md"
  - "docs/decisions/ADR-*.md"
  - "docs/architecture/*.md"
  - docs/lessons.md
`;

const byPath = (issues) => Object.fromEntries(issues.map((i) => [i.path.join('.'), i]));

test('RF-GEN-12: the README example is a valid configuration', () => {
  const r = parseConfig(README_EXAMPLE);
  assert.deepEqual(r.issues, []);
  assert.equal(r.ok, true);
});

test('RNF-05: CRLF line endings are tolerated', () => {
  assert.equal(parseConfig(README_EXAMPLE.replace(/\n/g, '\r\n')).ok, true);
});

test('RF-GEN-12: every invalid field is reported with its path and location', () => {
  const text = [
    'harness_version: one',          // 1
    'install_mode: shared',          // 2
    'tools: [claude-code, cursor]',  // 3
    'topology: single',              // 4
    'components:',                   // 5
    '  web:',                        // 6
    '    id_prefix: web',            // 7
    '  Api:',                        // 8
    '    path: ./api',               // 9
    'retries:',                      // 10
    '  in_scope: 5',                 // 11
    'colour: blue',                  // 12
    '',
  ].join('\n');
  const r = parseConfig(text);
  assert.equal(r.ok, false);
  const issues = byPath(r.issues);
  assert.equal(issues.harness_version.code, 'pattern');
  assert.equal(issues.harness_version.line, 1);
  assert.equal(issues.install_mode.code, 'enum');
  assert.equal(issues.install_mode.line, 2);
  assert.equal(issues['tools.1'].code, 'enum');
  assert.equal(issues['tools.1'].line, 3);
  assert.equal(issues['components.web.path'].code, 'required');
  assert.equal(issues['components.web.id_prefix'].code, 'pattern');
  assert.equal(issues['components.web.id_prefix'].line, 7);
  assert.equal(issues['components.Api'].code, 'keyPattern');
  assert.equal(issues['retries.in_scope'].code, 'max');
  assert.equal(issues['retries.in_scope'].line, 11);
  assert.equal(issues.colour.code, 'unknownKey');
  assert.equal(issues.colour.line, 12);
});

test('RF-GEN-12: required top-level fields', () => {
  const issues = byPath(parseConfig('install_mode: local\n').issues);
  for (const key of ['harness_version', 'tools', 'topology', 'components']) assert.equal(issues[key]?.code, 'required', key);
});

test('RF-GEN-12: type errors and empty lists', () => {
  const issues = byPath(parseConfig('harness_version: 1.0.0\ntools: []\ntopology: single\ncomponents: {app: {path: .}}\ngit_hooks: {enabled: "yes"}\n').issues);
  assert.equal(issues.tools.code, 'minItems');
  assert.equal(issues['git_hooks.enabled'].code, 'type');
});

test('RF-GEN-12: YAML syntax errors and duplicate keys carry a line number', () => {
  const syntax = parseConfig('harness_version: 1.0.0\ntools: [claude-code\ntopology: single\n');
  assert.equal(syntax.ok, false);
  assert.equal(syntax.issues[0].code, 'yaml');
  assert.ok(syntax.issues[0].line >= 2);
  const dup = parseConfig('harness_version: 1.0.0\nharness_version: 1.0.1\n');
  assert.equal(dup.issues[0].code, 'yaml');
  assert.equal(dup.issues[0].line, 2);
});

test('edge case 5: overlapping component paths are a configuration error', () => {
  const base = 'harness_version: 1.0.0\ntools: [codex]\ntopology: monorepo\ncomponents:\n';
  const same = byPath(parseConfig(base + '  web: {path: ./apps/web}\n  admin: {path: apps/web/}\n').issues);
  assert.equal(same['components.admin.path'].code, 'overlap');
  const nested = byPath(parseConfig(base + '  web: {path: apps}\n  admin: {path: apps/admin}\n').issues);
  assert.equal(nested['components.admin.path'].code, 'overlap');
  assert.equal(parseConfig(base + '  web: {path: apps/web}\n  webhooks: {path: apps/webhooks}\n').ok, true);
  // A repository nested in another one is a different repo, not an overlap…
  const multi = 'harness_version: 1.0.0\ntools: [codex]\ntopology: multi-repo\ncomponents:\n';
  assert.equal(parseConfig(multi + '  svc: {path: .}\n  client: {path: client}\n').ok, true);
  // …but two components can never share the same path.
  assert.equal(parseConfig(multi + '  a: {path: x}\n  b: {path: ./x}\n').ok, false);
});

test('cross-field rules: tracker provider, unique prefixes, models per enabled tool', () => {
  const text = `harness_version: 1.0.0
tools: [claude-code]
topology: monorepo
components:
  web: {path: web, id_prefix: APP}
  api: {path: api, id_prefix: APP}
tracker: {enabled: true}
models:
  codex: {high: gpt-x}
`;
  const issues = byPath(parseConfig(text).issues);
  assert.equal(issues['tracker.provider'].code, 'requiredIf');
  assert.equal(issues['components.api.id_prefix'].code, 'duplicate');
  assert.equal(issues['models.codex'].code, 'toolNotEnabled');
});

test('specs.location per-repo needs several repositories', () => {
  const cfg = (topology, location) => `harness_version: 1.0.0
tools: [claude-code]
topology: ${topology}
specs: {location: ${location}, id_prefix: SPEC}
components:
  web: {path: web}
  api: {path: api}
`;
  assert.equal(byPath(parseConfig(cfg('monorepo', 'per-repo')).issues)['specs.location'].code, 'requiredIf');
  assert.deepEqual(parseConfig(cfg('workspace', 'per-repo')).issues, []);
  assert.deepEqual(parseConfig(cfg('monorepo', 'root')).issues, []);
});

test('RF-GEN-12: `sdd-harness config validate` exits 1 listing each field and location', (t) => {
  const dir = tempDir(t);
  writeFileSync(path.join(dir, 'harness.config.yaml'), 'harness_version: 1.0.0\ntools: [vim]\ntopology: single\ncomponents: {app: {path: .}}\n');
  const r = runCli(['config', 'validate'], { cwd: dir });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /harness\.config\.yaml:2:\d+ {2}tools\[0\]: "vim" is not allowed; use one of: claude-code, opencode, codex, antigravity/);

  const es = runCli(['config', 'validate', '--lang', 'es'], { cwd: dir });
  assert.match(es.stderr, /"vim" no está permitido/);

  const json = JSON.parse(runCli(['config', 'validate', '--json'], { cwd: dir }).stdout);
  assert.equal(json.ok, false);
  assert.deepEqual(json.issues.map((i) => [i.path, i.code, i.line]), [['tools[0]', 'enum', 2]]);

  writeFileSync(path.join(dir, 'harness.config.yaml'), README_EXAMPLE);
  const ok = runCli(['config', 'validate'], { cwd: dir });
  assert.equal(ok.code, 0, ok.stderr);
  assert.match(ok.stdout, /valid/);
});

test('`sdd-harness config validate` without a configuration exits 1', (t) => {
  const dir = tempDir(t);
  const r = runCli(['config', 'validate'], { cwd: dir });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /sdd-harness-init/);
});
