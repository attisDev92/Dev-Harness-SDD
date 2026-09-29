// sdd-harness doctor (RF-DOC-01..06, RF-ADP-03/04 base, edge cases 7, 8, 23, 25).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import { FIXTURES, run, git } from './fixtures.js';
import { tempDir } from './helpers.js';
import { parse, stringify } from 'yaml';

const edit = (root, p, fn) => fs.writeFileSync(path.join(root, p), fn(fs.readFileSync(path.join(root, p), 'utf8')));

async function activated(t, args = []) {
  const root = FIXTURES.frontend(t);
  assert.equal((await run(['init', '--yes', ...args], { cwd: root })).code, 0);
  return root;
}

// A PATH where the tool binaries exist, so tool checks are predictable.
function fakePath(t, bins) {
  const dir = tempDir(t, 'harness-bin-');
  for (const b of bins) {
    fs.writeFileSync(path.join(dir, process.platform === 'win32' ? `${b}.cmd` : b), '');
  }
  return dir;
}

test('RF-DOC-01/05: a healthy project exits 0', async (t) => {
  const root = await activated(t);
  const r = await run(['doctor'], { cwd: root, env: { PATH: fakePath(t, ['claude']) } });
  assert.equal(r.code, 0, r.stdout);
  assert.match(r.stdout, /\[OK\] Configuration is valid/);
  assert.match(r.stdout, /\[OK\] Manifest lists \d+ generated items/);
  assert.match(r.stdout, /\[WARNING\] Skills requeridas sin instalar/);
  assert.match(r.stdout, /\[OK\] Git pre-commit checks are active/);
  assert.match(r.stdout, /\[INFO\] Contract snapshots/);
  assert.match(r.stdout, /0 errors, 1 warning\./);
});

test('RF-DOC-02: real enforcement per tool, rule by rule, never overstated', async (t) => {
  const root = await activated(t, ['--tools', 'claude-code,antigravity']);
  const env = { PATH: fakePath(t, ['claude', 'antigravity']) };
  const json = JSON.parse((await run(['doctor', '--json'], { cwd: root, env })).stdout);
  const claude = json.tools.find((x) => x.tool === 'claude-code');
  assert.deepEqual([claude.potential, claude.current], ['strong', 'strong']);
  assert.deepEqual(Object.values(claude.rules), Array(7).fill('deterministic'));
  // Antigravity has no adapter yet (v0.6): its rules are instruction-only and doctor says so.
  const anti = json.tools.find((x) => x.tool === 'antigravity');
  assert.deepEqual([anti.potential, anti.current, anti.adapter], ['weak', 'none', 'v0.6']);
  assert.deepEqual(Object.values(anti.rules), Array(7).fill('instruction'));
  const text = await run(['doctor'], { cwd: root, env });
  assert.match(text.stdout, /claude-code: current strong · potential strong/);
  assert.match(text.stdout, /antigravity: current instruction only · potential weak\n {4}adapter arrives in v0\.6/);
  // RF-ADP-04
  assert.match(text.stdout, /Antigravity: keep git commit\/push\/merge\/rebase\/reset and package installs out of the terminal allowlist/);
});

test('RF-DOC-02: hooks removed by hand drop the level back to instruction-only', async (t) => {
  const root = await activated(t);
  edit(root, '.claude/settings.local.json', (s) => {
    const settings = JSON.parse(s);
    delete settings.hooks;
    return JSON.stringify(settings);
  });
  const r = await run(['doctor', '--json'], { cwd: root, env: { PATH: fakePath(t, ['claude']) } });
  assert.equal(r.code, 1);
  const json = JSON.parse(r.stdout);
  assert.ok(json.checks.some((c) => c.status === 'error' && /permissions or hooks were removed from \.claude\/settings\.local\.json/.test(c.message)));
  assert.equal(json.tools[0].current, 'none');
});

test('RF-VER-03: git hooks switched off by hand are an error', async (t) => {
  const root = await activated(t);
  git(root, 'config', '--unset', 'core.hooksPath');
  const r = await run(['doctor'], { cwd: root, env: { PATH: fakePath(t, ['claude']) } });
  assert.equal(r.code, 1);
  assert.match(r.stdout, /\[ERROR\] Git hooks are enabled but the pre-commit checks are not active\n {4}fix: Run "sdd-harness sync"\./);
});

test('RF-DOC-03: invocation syntax for each enabled tool', async (t) => {
  const root = await activated(t, ['--tools', 'claude-code,opencode,codex,antigravity']);
  const json = JSON.parse((await run(['doctor', '--json'], { cwd: root })).stdout);
  const inv = Object.fromEntries(json.tools.map((x) => [x.tool, x.invocation.spec]));
  assert.deepEqual(inv, { 'claude-code': '/sdd:spec', opencode: '/sdd-spec', codex: '$sdd-spec', antigravity: '/sdd-spec' });
});

test('RF-DOC-04/05: problems come with cause and fix; errors exit 1, warnings do not', async (t) => {
  const root = await activated(t);
  const env = { PATH: fakePath(t, ['claude']) };
  edit(root, '.harness/templates/spec.md', (s) => s + 'x');
  let r = await run(['doctor'], { cwd: root, env });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /\[WARNING\] \.harness\/templates\/spec\.md was modified by hand\n {4}cause: .+\n {4}fix: .+sdd-harness sync/);

  fs.rmSync(path.join(root, '.harness/scripts/guard.js'));
  r = await run(['doctor'], { cwd: root, env });
  assert.equal(r.code, 1);
  assert.match(r.stdout, /\[ERROR\] \.harness\/scripts\/guard\.js is missing\n {4}fix: Run "sdd-harness sync"\./);

  edit(root, 'AGENTS.md', (s) => s.replace('<!-- harness:end -->', ''));
  r = await run(['doctor'], { cwd: root, env });
  assert.match(r.stdout, /\[ERROR\] The harness block in AGENTS\.md is damaged/);

  edit(root, 'harness.config.yaml', (s) => s.replace('topology: single', 'topology: star'));
  r = await run(['doctor'], { cwd: root, env });
  assert.match(r.stdout, /\[ERROR\] Configuration has 1 invalid field\n {4}fix: Run "sdd-harness config validate"/);
});

test('RF-DOC-01: manifest and git exclusion checks (edge case 8)', async (t) => {
  const root = await activated(t);
  edit(root, '.git/info/exclude', () => '');
  let r = await run(['doctor'], { cwd: root });
  assert.equal(r.code, 1);
  assert.match(r.stdout, /The harness block in \.git\/info\/exclude is missing/);
  fs.rmSync(path.join(root, '.harness/manifest.lock'));
  r = await run(['doctor'], { cwd: root });
  assert.match(r.stdout, /\[ERROR\] Manifest is missing\n {4}fix: Run "sdd-harness sync": it rebuilds the manifest\./);
});

test('local mode: generated files committed by someone are reported', async (t) => {
  const root = await activated(t);
  git(root, 'add', '-f', '.harness/guards.json');
  const r = await run(['doctor'], { cwd: root });
  assert.match(r.stdout, /\[WARNING\] \.harness\/guards\.json is committed but the install mode is local/);
});

test('edge case 23: an enabled tool that is not installed is a warning', async (t) => {
  const root = await activated(t, ['--tools', 'codex']);
  const r = await run(['doctor'], { cwd: root, env: { PATH: fakePath(t, []) } });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /\[WARNING\] codex is enabled but "codex" was not found on PATH/);
});

test('edge case 25 and RF-UPG-02: version differences are warnings', async (t) => {
  const root = await activated(t);
  edit(root, 'harness.config.yaml', (s) => s.replace(/harness_version: .*/, 'harness_version: 3.0.0'));
  const r = await run(['doctor', '--json'], { cwd: root });
  const check = JSON.parse(r.stdout).checks.find((c) => c.id === 'version');
  assert.equal(check.status, 'warn');
  assert.match(check.message, /newer than the CLI/);
});

test('missing verification commands are flagged (RF-VER-02 preview)', async (t) => {
  const root = await activated(t);
  edit(root, 'harness.config.yaml', (s) => {
    const config = parse(s);
    delete config.components['shop-web'].verify;
    return stringify(config);
  });
  const r = await run(['doctor'], { cwd: root });
  assert.match(r.stdout, /Component "shop-web" has no verification commands/);
});

test('RF-DOC-06: --json output, also outside an activated project', async (t) => {
  const root = await activated(t);
  const json = JSON.parse((await run(['doctor', '--json'], { cwd: root })).stdout);
  assert.equal(typeof json.ok, 'boolean');
  assert.ok(Array.isArray(json.checks) && json.checks.every((c) => ['ok', 'warn', 'error', 'info'].includes(c.status)));
  const outside = await run(['doctor', '--json'], { cwd: FIXTURES.frontend(t) });
  assert.equal(outside.code, 1);
  assert.equal(JSON.parse(outside.stdout).checks[0].id, 'activation');
});

test('doctor speaks the CLI language', async (t) => {
  const root = await activated(t);
  const r = await run(['doctor', '--lang', 'es'], { cwd: root });
  assert.match(r.stdout, /La configuración es válida/);
  assert.match(r.stdout, /Enforcement por herramienta/);
});
