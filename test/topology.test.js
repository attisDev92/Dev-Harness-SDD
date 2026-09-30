// Several repositories (RF-TOP-01..11), main path only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import { FIXTURES, run, write } from './fixtures.js';
import { runSdd } from '../src/guards/sdd.js';
import { handleHook } from '../src/guards/hook.js';
import { parse, stringify } from 'yaml';

const read = (root, p) => fs.readFileSync(path.join(root, p), 'utf8');
const sdd = async (root, ...argv) => {
  let stdout = '';
  let stderr = '';
  const code = await runSdd(argv, { stdout: { write: (s) => { stdout += s; } }, stderr: { write: (s) => { stderr += s; } }, cwd: root, env: {} });
  return { code, stdout, stderr };
};

test('workspace: by default the specs live at the root with one project prefix, without --component', async (t) => {
  const root = FIXTURES.workspace(t);
  assert.equal((await run(['workspace', 'init', '--yes'], { cwd: root })).code, 0);
  assert.match((await sdd(root, 'new-spec', 'auth')).stdout, /specs\/SPEC-001-auth\/spec\.md/);
  assert.match((await sdd(root, 'new-spec', 'login')).stdout, /specs\/SPEC-002-login\/spec\.md/);
});

test('workspace: specs per repo, cross-repo dependency and contract snapshot', async (t) => {
  const root = FIXTURES.workspace(t);
  const init = await run(['workspace', 'init', '--yes'], { cwd: root });
  assert.equal(init.code, 0, init.stderr);

  // RF-TOP-03 and per-repo exclusion (RF-MOD-01).
  assert.equal(read(root, 'harness.workspace.yaml').split('\n').slice(1).join('\n'), 'repos:\n  - api\n  - web\n');
  assert.match(read(root, 'api/.git/info/exclude'), /# harness:begin\n\/AGENTS\.md/);

  // Git hooks in every repository of the workspace (RF-VER-03, RF-TOP-02).
  const { spawnSync } = await import('node:child_process');
  const gitIn = (dir, ...args) => spawnSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=U', ...args], { cwd: path.join(root, dir), encoding: 'utf8' });
  assert.equal(gitIn('api', 'config', 'core.hooksPath').stdout.trim(), '../.harness/githooks');
  write(root, { 'api/secret.go': `package main\nconst token = "${'gh' + 'p_'}${'a'.repeat(36)}"\n` });
  gitIn('api', 'add', 'secret.go');
  const blocked = gitIn('api', 'commit', '-qm', 'feat: x');
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /secrets: possible GitHub token in api\/secret\.go/);
  gitIn('api', 'reset', '-q', 'secret.go');
  fs.rmSync(path.join(root, 'api/secret.go'));

  // RF-TOP-02: with `specs.location: per-repo` each repo owns its specs (component prefixes are optional).
  const cfgFile = path.join(root, 'harness.config.yaml');
  const cfg = parse(fs.readFileSync(cfgFile, 'utf8'));
  cfg.specs = { location: 'per-repo', id_prefix: 'SPEC' };
  cfg.components.api.id_prefix = 'API';
  cfg.components.web.id_prefix = 'WEB';
  fs.writeFileSync(cfgFile, stringify(cfg));
  assert.equal((await run(['sync', '--yes'], { cwd: root })).code, 0);
  assert.match((await sdd(root, 'new-spec', 'auth', '--component', 'api')).stdout, /api\/specs\/API-001-auth\/spec\.md/);
  write(root, { 'api/specs/API-001-auth/contracts/openapi.yaml': 'openapi: 3.1.0\npaths: {}\n' });
  assert.match((await sdd(root, 'new-spec', 'login', '--component', 'web')).stdout, /web\/specs\/WEB-001-login\/spec\.md/);
  const spec = read(root, 'web/specs/WEB-001-login/spec.md').replace(/\| (Depends on|Depende de) \|[^\n]*/, '| Depende de | api#API-001, api#API-009 |');
  fs.writeFileSync(path.join(root, 'web/specs/WEB-001-login/spec.md'), spec);

  // RF-TOP-04/05: the missing dependency is reported.
  assert.match((await sdd(root, 'status')).stdout, /depende de api#API-009, que no existe/);
  const doctor = await run(['doctor', '--json'], { cwd: root });
  assert.ok(JSON.parse(doctor.stdout).checks.some((c) => c.id === 'dependencies' && /api#API-009/.test(c.message)));

  // RF-TOP-06: snapshot with its origin.
  const imp = await sdd(root, 'contract', 'import', 'api#API-001');
  assert.equal(imp.code, 0, imp.stderr);
  const snap = 'web/specs/WEB-001-login/contracts/external/api-openapi.yaml';
  assert.equal(read(root, snap), 'openapi: 3.1.0\npaths: {}\n');
  const source = JSON.parse(read(root, `${snap}.source.json`));
  assert.deepEqual([source.repo, source.spec, source.path], ['api', 'API-001-auth', 'api/specs/API-001-auth/contracts/openapi.yaml']);
  assert.match(source.hash, /^[0-9a-f]{64}$/);

  // Contracts are a protected zone: touching one raises an alert (RF-TOP-10).
  const hook = handleHook('PreToolUse', { cwd: root, session_id: 's', tool_name: 'Write', tool_input: { file_path: path.join(root, snap), content: 'x' } }, { env: {} });
  assert.equal(hook.code, 0);
  assert.match(JSON.parse(hook.stdout).systemMessage, /zona protegida "contracts"/);

  // RF-TOP-08: the provider changes → stale; RF-TOP-07: sync updates it.
  fs.appendFileSync(path.join(root, 'api/specs/API-001-auth/contracts/openapi.yaml'), 'info: {title: v2}\n');
  const stale = JSON.parse((await run(['doctor', '--json'], { cwd: root })).stdout);
  assert.ok(stale.checks.some((c) => c.id === 'contracts' && c.status === 'warn'));
  const sync = await run(['contracts', 'sync', '--yes'], { cwd: root, env: { HARNESS_LANG: 'es' } });
  assert.equal(sync.code, 0, sync.stderr);
  assert.match(sync.stdout, /\+info: \{title: v2\}/);
  assert.match(read(root, snap), /title: v2/);
  assert.match((await run(['contracts', 'sync'], { cwd: root, env: { HARNESS_LANG: 'es' } })).stdout, /1 snapshot al día/);

  // RF-TOP-09: provider not available locally → kept, reported.
  fs.rmSync(path.join(root, 'api/specs/API-001-auth/contracts'), { recursive: true });
  assert.match((await run(['contracts', 'sync', '--yes'], { cwd: root, env: { HARNESS_LANG: 'es' } })).stdout, /no está disponible localmente; se mantiene/);
  assert.match(read(root, snap), /title: v2/);

  // RF-TOP-11 / RF-GAT-04: commit context separates the repositories.
  write(root, { 'api/handler.go': 'package main\n', 'web/src/login.vue': '<template />\n' });
  const ctx = JSON.parse((await sdd(root, 'commit-context')).stdout);
  assert.deepEqual(ctx.repositories.map((r) => r.repo).sort(), ['api', 'web']);
});
