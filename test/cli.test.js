// RF-INS-01..07 and the guard entry points used by tool hooks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { ROOT, runCli, tempDir, snapshotTree } from './helpers.js';
import { cacheDir, assertNotGlobalToolPath } from '../src/cli/paths.js';
import { resolveLang } from '../src/cli/main.js';
import { runGuard } from '../src/guards/cli.js';

const require = createRequire(import.meta.url);
const nodeCheck = require('../bin/node-check.cjs');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

test('RF-INS-01: the package exposes `sdd-harness` and the `sdd-harness-init` shortcut', () => {
  assert.equal(pkg.name, 'dev-harness-sdd');
  assert.deepEqual(pkg.bin, { 'sdd-harness': 'bin/harness.cjs', 'sdd-harness-init': 'bin/init.cjs' });
  assert.ok(pkg.files.includes('bin/') && pkg.files.includes('src/'));
  for (const bin of Object.values(pkg.bin)) assert.match(readFileSync(path.join(ROOT, bin), 'utf8'), /^#!\/usr\/bin\/env node/);
  // The shortcut runs init: its help is init's help.
  const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'init.cjs'), '--help'], { encoding: 'utf8', env: { ...process.env, HARNESS_LANG: 'es' } });
  assert.match(r.stdout, /^Uso: sdd-harness-init/);
});

test('RF-INS-04: --version prints the installed version', () => {
  for (const flag of ['--version', '-v']) {
    const r = runCli([flag]);
    assert.equal(r.code, 0);
    assert.equal(r.stdout.trim(), pkg.version);
  }
});

test('RF-INS-05: --help is shown in the configured language', () => {
  const en = runCli(['--help']);
  assert.equal(en.code, 0);
  assert.match(en.stdout, /Usage: sdd-harness <command>/);
  const es = runCli(['--help'], { env: { HARNESS_LANG: 'es' } });
  assert.match(es.stdout, /Uso: sdd-harness <comando>/);
  const flag = runCli(['--help', '--lang', 'es']);
  assert.match(flag.stdout, /Comandos:/);
  assert.equal(runCli([]).stdout, en.stdout);
});

test('RF-INS-05: `sdd-harness <command> --help` for every command', () => {
  assert.match(runCli(['guard', '--help']).stdout, /Usage: sdd-harness guard <git\|docs\|retry>/);
  assert.match(runCli(['config', '--help']).stdout, /Usage: sdd-harness config validate/);
  assert.match(runCli(['config', '--help', '--lang', 'es']).stdout, /Uso: sdd-harness config validate/);
  for (const cmd of ['init', 'sync', 'doctor', 'remove']) {
    const r = runCli([cmd, '--help']);
    assert.equal(r.code, 0, cmd);
    assert.match(r.stdout, new RegExp(`^Usage: sdd-harness[ -]${cmd}`), cmd);
    assert.match(runCli([cmd, '--help'], { env: { HARNESS_LANG: 'es' } }).stdout, new RegExp(`^Uso: sdd-harness[ -]${cmd}`), cmd);
  }
  // MVP: messages added after v0.3 exist only in Spanish.
  for (const cmd of ['upgrade', 'skills', 'contracts', 'tracker', 'workspace']) {
    const r = runCli([cmd, '--help']);
    assert.equal(r.code, 0, cmd);
    assert.match(r.stdout, new RegExp(`^Uso: sdd-harness[ -]${cmd}`), cmd);
  }
});

test('commands outside an activated project and unknown input exit 1', () => {
  const r = runCli(['skills', 'list']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /no está activado/);
  assert.equal(runCli(['frobnicate']).code, 1);
  assert.equal(runCli(['--frobnicate']).code, 1);
});

test('CLI language resolution order', (t) => {
  const dir = tempDir(t);
  assert.equal(resolveLang({ flag: 'es', env: { HARNESS_LANG: 'en' }, cwd: dir }), 'es');
  assert.equal(resolveLang({ env: { HARNESS_LANG: 'es_ES.UTF-8' }, cwd: dir }), 'es');
  assert.equal(resolveLang({ env: { LANG: 'es_AR.UTF-8' }, cwd: dir }), 'es');
  writeFileSync(path.join(dir, 'harness.config.yaml'), 'cli:\n  language: es\n');
  assert.equal(resolveLang({ env: { LANG: 'en_US' }, cwd: dir }), 'es');
});

test('RF-INS-06: an unsupported Node.js version exits 1 naming the required version', () => {
  const min = nodeCheck.minVersion(pkg.engines.node);
  assert.equal(nodeCheck.satisfies('18.20.0', min), false);
  assert.equal(nodeCheck.satisfies(min, min), true);
  assert.equal(nodeCheck.satisfies('24.1.0', min), true);
  const r = runCli(['--version'], { env: { HARNESS_TEST_NODE_VERSION: '18.19.0' } });
  assert.equal(r.code, 1);
  assert.match(r.stderr, new RegExp(`requires Node\\.js ${min.replace(/\./g, '\\.')} or newer \\(you have 18\\.19\\.0\\)`));
  const es = runCli(['--version'], { env: { HARNESS_TEST_NODE_VERSION: '16.0.0', HARNESS_LANG: 'es' } });
  assert.match(es.stderr, /necesita Node\.js/);
});

test('RF-INS-02: the CLI refuses to write into global tool directories', () => {
  const home = path.resolve('/home/dev');
  const env = { XDG_CONFIG_HOME: undefined };
  for (const p of ['.claude/settings.json', '.codex/config.toml', '.gemini/x', '.config/opencode/opencode.json', '.claude.json']) {
    assert.throws(() => assertNotGlobalToolPath(path.join(home, p), env, home, 'linux'), { code: 'EHARNESS_GLOBAL' }, p);
  }
  assert.doesNotThrow(() => assertNotGlobalToolPath(path.join(home, 'project', '.claude', 'settings.json'), env, home, 'linux'));
  assert.doesNotThrow(() => assertNotGlobalToolPath(path.join(home, '.claudette'), env, home, 'linux'));
});

test('RF-INS-03: a single cache directory of its own, per platform', () => {
  assert.equal(cacheDir({ HARNESS_CACHE_DIR: '/tmp/c' }, 'linux', '/h'), path.resolve('/tmp/c'));
  assert.equal(cacheDir({}, 'linux', '/h'), path.join('/h', '.cache', 'sdd-harness'));
  assert.equal(cacheDir({ XDG_CACHE_HOME: '/x' }, 'linux', '/h'), path.join('/x', 'sdd-harness'));
  assert.equal(cacheDir({}, 'darwin', '/h'), path.join('/h', 'Library', 'Caches', 'sdd-harness'));
  assert.equal(cacheDir({ LOCALAPPDATA: 'C:\\L' }, 'win32', 'C:\\h'), path.join('C:\\L', 'sdd-harness', 'Cache'));
});

test('RF-INS-02, RF-INS-03, RF-INS-07: running the CLI writes nothing to the profile or to a non-activated project', (t) => {
  const home = tempDir(t, 'harness-home-');
  const project = tempDir(t);
  mkdirSync(path.join(project, 'src'));
  writeFileSync(path.join(project, 'README.md'), '# app\n');
  writeFileSync(path.join(project, 'src', 'index.js'), 'console.log(1)\n');
  const before = snapshotTree(project);
  const env = { HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(home, 'AppData', 'Local'), XDG_CONFIG_HOME: undefined, XDG_CACHE_HOME: undefined };
  const runs = [
    ['--version'], ['--help'], ['init', '--help'], ['init'], ['config', 'validate'],
    ['guard', 'git', '--command', 'git status'], ['guard', 'git', '--command', 'git push'],
    ['guard', 'docs', '--file', 'NOTES.md'], ['guard', 'retry', 'record', '--task', 'T1', '--error', 'x'],
    ['guard', 'retry', 'status'],
  ];
  for (const args of runs) runCli(args, { cwd: project, env, input: '' });
  assert.deepEqual(snapshotTree(project), before);
  assert.deepEqual(readdirSync(home), []);
});

test('guard git: hook payloads from stdin (Claude Code / opencode / plain text)', () => {
  const claude = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm test && git commit -m x' }, cwd: ROOT });
  const r = runCli(['guard', 'git'], { input: claude });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /Committing is the user's job/);
  assert.equal(runCli(['guard', 'git'], { input: JSON.stringify({ tool_input: { command: 'git status' } }) }).code, 0);
  assert.equal(runCli(['guard', 'git'], { input: JSON.stringify({ args: { command: 'git push' } }) }).code, 2);
  assert.equal(runCli(['guard', 'git'], { input: 'git push --force' }).code, 2);
  assert.equal(runCli(['guard', 'git'], { input: '' }).code, 0);
  const json = JSON.parse(runCli(['guard', 'git', '--json', '--command', 'git push']).stdout);
  assert.deepEqual([json.decision, json.kind, json.match], ['block', 'gitBlocked', 'git push']);
  assert.match(runCli(['guard', 'git', '--command', 'git push'], { env: { HARNESS_LANG: 'es' } }).stderr, /El commit lo hace el usuario/);
});

test('guard docs: payload from stdin and project whitelist from .harness/guards.json', (t) => {
  const dir = tempDir(t);
  writeFileSync(path.join(dir, 'harness.config.yaml'), 'harness_version: 0.1.0\n');
  const payload = (file) => JSON.stringify({ tool_name: 'Write', tool_input: { file_path: path.join(dir, file), content: '#' }, cwd: dir });
  let r = runCli(['guard', 'docs'], { cwd: dir, input: payload('NOTES.md') });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /not in the documentation whitelist/);
  assert.equal(runCli(['guard', 'docs'], { cwd: dir, input: payload('docs/lessons.md') }).code, 0);
  assert.equal(runCli(['guard', 'docs'], { cwd: dir, input: payload('src/app.ts') }).code, 0);

  mkdirSync(path.join(dir, '.harness'));
  writeFileSync(path.join(dir, '.harness', 'guards.json'), JSON.stringify({ docs_whitelist: ['NOTES.md'], language: 'es' }));
  r = runCli(['guard', 'docs', '--file', 'NOTES.md'], { cwd: dir, env: { HARNESS_LANG: undefined } });
  assert.equal(r.code, 0);
  r = runCli(['guard', 'docs', '--file', 'README.md'], { cwd: dir, env: { HARNESS_LANG: undefined } });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /no está en la lista blanca/);
});

test('guards fail safe on internal errors', async () => {
  let stderr = '';
  const io = {
    stdout: { write() {} },
    stderr: { write(s) { stderr += s; } },
    env: { HARNESS_LANG: 'en' },
    cwd: ROOT,
    readStdin: () => Promise.reject(new Error('stdin closed')),
  };
  assert.equal(await runGuard(['git'], io), 2);
  assert.match(stderr, /Fail-safe: the action was not allowed/);
  assert.equal(runCli(['guard', 'nope']).code, 1);
});

test('RNF-08: a guard process answers in under 300 ms', () => {
  runCli(['guard', 'git', '--command', 'git status']); // warm the file cache
  // Other test files run in parallel and load the machine: keep the best of
  // several runs, stopping as soon as one meets the limit.
  const times = [];
  for (let i = 0; i < 8 && !(times.length && Math.min(...times) < 300); i += 1) {
    const start = process.hrtime.bigint();
    runCli(['guard', 'git', '--command', 'npm test && git commit -m x']);
    times.push(Number(process.hrtime.bigint() - start) / 1e6);
  }
  const best = Math.min(...times);
  assert.ok(best < 300, `best of ${times.length}: ${best.toFixed(0)} ms`);
});
