// MVP additions: sdd-harness upgrade (RF-UPG-01..04) and the event log (RF-OBS-01/02/05).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import { FIXTURES, run } from './fixtures.js';
import { runSdd } from '../src/guards/sdd.js';

const read = (root, p) => fs.readFileSync(path.join(root, p), 'utf8');
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('RF-UPG-01..03: upgrade shows the news and the diff, then records the new version', async (t) => {
  const root = FIXTURES.frontend(t);
  await run(['init', '--yes'], { cwd: root });
  fs.writeFileSync(path.join(root, 'harness.config.yaml'), read(root, 'harness.config.yaml').replace(/harness_version: .*/, 'harness_version: 0.2.0'));
  const r = await run(['upgrade', '--yes'], { cwd: root, env: { HARNESS_LANG: 'es' } });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`Actualización del harness: 0\.2\.0 → ${pkg.version.replace(/\./g, '\.')}`));
  assert.match(r.stdout, /Novedades:\n {2}0\.3\.0: Adaptador de Claude Code/);
  assert.match(r.stdout, /-harness_version: 0\.2\.0\n\+harness_version: /);
  assert.match(read(root, 'harness.config.yaml'), new RegExp(`harness_version: ${pkg.version}`));
  assert.match((await run(['upgrade'], { cwd: root, env: { HARNESS_LANG: 'es' } })).stdout, /No hay nada que actualizar/);
});

test('RF-UPG-04: upgrading a 2.0 project adds the orchestration options with the old behaviour and regenerates the files', async (t) => {
  const root = FIXTURES.frontend(t);
  await run(['init', '--yes', '--tools', 'claude-code,antigravity'], { cwd: root });
  // A project activated before 2.1.0: no orchestration block, no gates.decisions, old generated files.
  const old = read(root, 'harness.config.yaml')
    .replace(/harness_version: .*/, 'harness_version: 2.0.1')
    .replace(/\norchestration:\n {2}max_parallel: \d+\n/, '\n')
    .replace(/\n {2}decisions: \w+\n/, '\n');
  assert.doesNotMatch(old, /max_parallel|decisions:/);
  fs.writeFileSync(path.join(root, 'harness.config.yaml'), old);
  fs.rmSync(path.join(root, '.agents/rules'), { recursive: true, force: true });
  fs.rmSync(path.join(root, '.claude/commands/sdd/pause.md'));

  const r = await run(['upgrade', '--yes'], { cwd: root, env: { HARNESS_LANG: 'es' } });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /2\.1\.0: orchestration\.max_parallel/);
  assert.match(r.stdout, /\+orchestration:\n\+ {2}max_parallel: 2/);
  assert.match(r.stdout, /\+ {2}decisions: summary/);
  const config = read(root, 'harness.config.yaml');
  assert.match(config, /orchestration:\n {2}max_parallel: 2 # subagentes a la vez por defecto/);
  assert.match(config, /decisions: summary # summary/);
  // The sync that follows regenerates what 2.1.0 adds.
  assert.ok(fs.existsSync(path.join(root, '.agents/rules/sdd-harness.md')));
  assert.ok(fs.existsSync(path.join(root, '.claude/commands/sdd/pause.md')));
  assert.match(read(root, '.harness/guards.json'), /"max_parallel": 2/);
  assert.match(read(root, 'AGENTS.md'), /sdd\.js done <TID>/);
});

test('RF-OBS-01/05: flow events go to .harness/logs/events.jsonl, which git ignores', async (t) => {
  const root = FIXTURES.frontend(t);
  await run(['init', '--yes'], { cwd: root });
  const io = { stdout: { write() {} }, stderr: { write() {} }, cwd: root, env: {} };
  await runSdd(['new-spec', 'login'], io);
  await runSdd(['stop', 'spec'], io);
  const events = read(root, '.harness/logs/events.jsonl').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(events.map((e) => e.event), ['spec-created', 'stop-requested']);
  assert.deepEqual([events[1].spec, events[1].stop], ['SPEC-001-login', 'spec']);
  assert.match(read(root, '.git/info/exclude'), /\/\.harness\//);
});
