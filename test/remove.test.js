// sdd-harness remove (RF-REM-01..08, RNF-06, completion criterion 6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import { FIXTURES, run, snapshot, git, write } from './fixtures.js';
import { readManifest, serializeManifest } from '../src/engine/manifest.js';

const read = (root, p) => fs.readFileSync(path.join(root, p), 'utf8');

for (const [name, args] of [
  ['frontend', []],
  ['monorepo', []],
  ['monorepo', ['--mode', 'team']],
  ['workspace', []],
  ['multiRepo', []],
  ['existingConfig', []],
  ['existingConfig', ['--mode', 'team', '--tools', 'claude-code,codex']],
]) {
  test(`criterion 6: init → sync → remove leaves the "${name}" fixture${args.length ? ` (${args.join(' ')})` : ''} as it was`, async (t) => {
    const root = FIXTURES[name](t);
    const before = snapshot(root);
    assert.equal((await run(['init', '--yes', ...args], { cwd: root })).code, 0);
    assert.equal((await run(['sync', '--yes'], { cwd: root })).code, 0);
    const r = await run(['remove', '--yes'], { cwd: root });
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(snapshot(root), before);
  });
}

test('RF-REM-01: the list of changes is shown and nothing happens without confirmation', async (t) => {
  const root = FIXTURES.frontend(t);
  await run(['init', '--yes'], { cwd: root });
  const before = snapshot(root);
  const r = await run(['remove'], { cwd: root, answers: { apply: false } });
  assert.equal(r.code, 1);
  assert.match(r.stdout, /Changes to revert:\n/);
  assert.match(r.stdout, /- AGENTS\.md {2}\(delete\)/);
  assert.match(r.stdout, /- \.git\/info\/exclude {2}\(remove block\)/);
  assert.match(r.stdout, /- harness\.config\.yaml {2}\(delete\)/);
  assert.deepEqual(snapshot(root), before);
  assert.equal((await run(['remove', '--dry-run'], { cwd: root })).code, 0);
  assert.deepEqual(snapshot(root), before);
});

test('RF-REM-03: hand-edited generated files are asked about (and kept with --yes)', async (t) => {
  const root = FIXTURES.frontend(t);
  await run(['init', '--yes'], { cwd: root });
  fs.appendFileSync(path.join(root, '.harness/templates/spec.md'), '\nmine\n');
  fs.appendFileSync(path.join(root, '.harness/templates/plan.md'), '\nmine\n');
  const r = await run(['remove'], { cwd: root, answers: { 'conflict:.harness/templates/spec.md': 'delete', 'conflict:.harness/templates/plan.md': 'keep', apply: true } });
  assert.equal(r.code, 0, r.stderr);
  assert.ok(!fs.existsSync(path.join(root, '.harness/templates/spec.md')));
  assert.match(read(root, '.harness/templates/plan.md'), /mine/);
  assert.ok(!fs.existsSync(path.join(root, 'harness.config.yaml')));
});

test('RF-REM-04: blocks are removed from files the user owns, the rest of the file stays', async (t) => {
  const root = FIXTURES.existingConfig(t);
  await run(['init', '--yes', '--mode', 'team'], { cwd: root });
  fs.appendFileSync(path.join(root, 'AGENTS.md'), '\n## Added later by the team\n');
  const r = await run(['remove', '--yes'], { cwd: root });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(read(root, 'AGENTS.md'), '# Team rules\n\nUse 2 spaces. Commit messages in English.\n\n## Added later by the team\n');
  assert.equal(read(root, 'CLAUDE.md'), '# Claude\n\nRead AGENTS.md.\n');
});

test('RF-REM-05: specs/ and docs/ are never touched', async (t) => {
  const root = FIXTURES.frontend(t);
  await run(['init', '--yes'], { cwd: root });
  write(root, { 'specs/SW-001-login/spec.md': '# spec\n', 'docs/constitution.md': '# c\n', 'docs/decisions/ADR-0001-x.md': '# adr\n' });
  // Even a manifest that (wrongly) lists an artifact cannot make remove delete it.
  const { manifest } = readManifest(root);
  manifest.entries.push({ kind: 'file', path: 'docs/constitution.md', hash: 'x', generator: 'core' });
  fs.writeFileSync(path.join(root, '.harness/manifest.lock'), serializeManifest({ harnessVersion: manifest.harness_version, installMode: 'local', entries: manifest.entries, dirs: manifest.dirs }));
  const r = await run(['remove', '--yes'], { cwd: root });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(read(root, 'specs/SW-001-login/spec.md'), '# spec\n');
  assert.equal(read(root, 'docs/constitution.md'), '# c\n');
  assert.equal(read(root, 'docs/decisions/ADR-0001-x.md'), '# adr\n');
});

test('RF-REM-06: the harness entries leave .git/info/exclude, the rest stays', async (t) => {
  const root = FIXTURES.frontend(t);
  fs.appendFileSync(path.join(root, '.git/info/exclude'), '*.local\n');
  const before = read(root, '.git/info/exclude');
  await run(['init', '--yes'], { cwd: root });
  assert.match(read(root, '.git/info/exclude'), /# harness:begin/);
  await run(['remove', '--yes'], { cwd: root });
  assert.equal(read(root, '.git/info/exclude'), before);
});

test('RF-REM-07: core.hooksPath is restored or unset', async (t) => {
  for (const [previous, expected] of [['.husky', '.husky'], [null, '']]) {
    const root = FIXTURES.frontend(t);
    if (previous) git(root, 'config', 'core.hooksPath', previous);
    await run(['init', '--yes'], { cwd: root });
    // What the git hooks step (v0.3) records when it takes over core.hooksPath.
    git(root, 'config', 'core.hooksPath', '.harness/githooks');
    const { manifest } = readManifest(root);
    manifest.entries.push(previous ? { kind: 'git-config', key: 'core.hooksPath', hadPrevious: true, previous } : { kind: 'git-config', key: 'core.hooksPath', hadPrevious: false });
    fs.writeFileSync(path.join(root, '.harness/manifest.lock'), serializeManifest({ harnessVersion: manifest.harness_version, installMode: 'local', entries: manifest.entries, dirs: manifest.dirs }));
    const r = await run(['remove', '--yes'], { cwd: root });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, previous ? /core\.hooksPath: restore "\.husky"/ : /core\.hooksPath: unset/);
    let value = '';
    try { value = git(root, 'config', '--get', 'core.hooksPath').trim(); } catch { value = ''; }
    assert.equal(value, expected);
  }
});

test('RF-REM-08: without a trustworthy manifest nothing is deleted', async (t) => {
  for (const damage of ['missing', 'corrupt']) {
    const root = FIXTURES.frontend(t);
    await run(['init', '--yes'], { cwd: root });
    if (damage === 'missing') fs.rmSync(path.join(root, '.harness/manifest.lock'));
    else fs.writeFileSync(path.join(root, '.harness/manifest.lock'), 'garbage');
    const before = snapshot(root);
    const r = await run(['remove', '--yes'], { cwd: root });
    assert.equal(r.code, 1);
    assert.match(r.stderr, new RegExp(`manifest\\.lock is ${damage === 'missing' ? 'missing' : 'damaged'}`));
    for (const c of ['harness.config.yaml', '.harness/', 'AGENTS.md (harness block)', 'CLAUDE.local.md (harness block)', '.git/info/exclude (harness block)']) {
      assert.ok(r.stderr.includes(`? ${c}`), c);
    }
    assert.deepEqual(snapshot(root), before);
  }
});

test('RNF-06: remove is idempotent and runtime state is cleaned up', async (t) => {
  const root = FIXTURES.frontend(t);
  const before = snapshot(root);
  await run(['init', '--yes'], { cwd: root });
  write(root, { 'harness.config.yaml': read(root, 'harness.config.yaml') });
  assert.equal((await run(['guard', 'retry', 'record', '--task', 'T1', '--error', 'x'], { cwd: root })).code, 0);
  write(root, { '.harness/logs/events.jsonl': '{}\n' });
  assert.equal((await run(['remove', '--yes'], { cwd: root })).code, 0);
  assert.deepEqual(snapshot(root), before);
  const again = await run(['remove', '--yes'], { cwd: root });
  assert.equal(again.code, 0);
  assert.match(again.stdout, /not installed here/);
});
