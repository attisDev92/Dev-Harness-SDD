// Generation engine: managed blocks, JSON merge, diff, planning and the
// all-or-nothing writer (RF-MRG-01..05, RF-GEN-11, RF-INI-18, RNF-05, RNF-07).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import { findBlock, upsertBlock, removeBlock } from '../src/engine/blocks.js';
import { unifiedDiff } from '../src/engine/diff.js';
import { planChanges } from '../src/engine/plan.js';
import { applyChanges } from '../src/engine/transaction.js';
import { hashText } from '../src/engine/text.js';
import { tempDir } from './helpers.js';

const keep = async () => 'keep';
const reader = (files) => (p) => (Object.hasOwn(files, p) ? files[p] : null);
const plan = (desired, files, manifest = null, resolve = keep) => planChanges({ desired, manifest, read: reader(files), resolve });

test('RF-MRG-01: blocks are appended, replaced and removed without touching the rest', () => {
  const user = '# Team rules\n\nUse tabs.\n';
  const once = upsertBlock(user, 'harness v1');
  assert.equal(once, '# Team rules\n\nUse tabs.\n\n<!-- harness:begin -->\nharness v1\n<!-- harness:end -->\n');
  const twice = upsertBlock(once, 'harness v2');
  assert.ok(twice.startsWith('# Team rules\n\nUse tabs.\n'));
  assert.equal(findBlock(twice).content, 'harness v2');
  assert.equal(removeBlock(twice), user);
  assert.equal(upsertBlock(null, 'x'), '<!-- harness:begin -->\nx\n<!-- harness:end -->\n');
  assert.equal(removeBlock(upsertBlock(null, 'x')), '');
});

test('edge case 7: a damaged block is detected and never rewritten', () => {
  for (const text of ['<!-- harness:begin -->\nno end\n', 'x\n<!-- harness:end -->\n', '<!-- harness:begin -->\n<!-- harness:end -->\n<!-- harness:begin -->\n<!-- harness:end -->\n']) {
    assert.equal(findBlock(text).status, 'broken');
    assert.throws(() => upsertBlock(text, 'y'), { code: 'EBLOCK' });
  }
});

test('hash-comment blocks for .git/info/exclude', () => {
  const text = upsertBlock('# git ls-files --others\n', '/.harness/', 'hash');
  assert.match(text, /# harness:begin\n\/\.harness\/\n# harness:end\n$/);
  assert.equal(removeBlock(text, 'hash'), '# git ls-files --others\n');
});

test('unified diff', () => {
  assert.equal(unifiedDiff('a\nb\n', 'a\nb\n', 'f'), '');
  const d = unifiedDiff('a\nb\nc\n', 'a\nB\nc\n', 'f.md');
  assert.equal(d, '--- a/f.md\n+++ b/f.md\n@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n');
  assert.match(unifiedDiff(null, 'x\n', 'n.md'), /^--- \/dev\/null\n\+\+\+ b\/n\.md\n@@ -0,0 \+1,1 @@\n\+x\n$/);
  assert.match(unifiedDiff('x\n', null, 'n.md'), /\+\+\+ \/dev\/null/);
  const long = Array.from({ length: 30 }, (_, i) => `l${i}`);
  const changed = [...long];
  changed[2] = 'X';
  changed[25] = 'Y';
  assert.equal((unifiedDiff(long.join('\n'), changed.join('\n'), 'f').match(/^@@/gm) ?? []).length, 2);
});

test('plan: create, unchanged and update of generated files', async () => {
  const desired = [{ kind: 'file', path: 'a.txt', content: 'v2\n', generator: 'core' }];
  let r = await plan(desired, {});
  assert.deepEqual(r.changes, [{ path: 'a.txt', before: null, after: 'v2\n' }]);
  r = await plan(desired, { 'a.txt': 'v2\r\n' });
  assert.deepEqual(r.changes, []);
  const manifest = { entries: [{ kind: 'file', path: 'a.txt', hash: hashText('v1\n'), generator: 'core' }] };
  r = await plan(desired, { 'a.txt': 'v1\n' }, manifest);
  assert.deepEqual(r.changes, [{ path: 'a.txt', before: 'v1\n', after: 'v2\n' }]);
});

test('RF-GEN-11: hand-edited generated files are only overwritten when the user says so', async () => {
  const desired = [{ kind: 'file', path: 'a.txt', content: 'v2\n', generator: 'core' }];
  const manifest = { entries: [{ kind: 'file', path: 'a.txt', hash: hashText('v1\n'), generator: 'core' }] };
  const asked = [];
  const r = await plan(desired, { 'a.txt': 'mine\n' }, manifest, async (c) => { asked.push(c); return 'keep'; });
  assert.equal(asked[0].type, 'modifiedFile');
  assert.deepEqual(asked[0].choices, ['keep', 'overwrite']);
  assert.deepEqual(r.changes, []);
  assert.equal(r.entries[0].hash, hashText('v1\n'));
  const o = await plan(desired, { 'a.txt': 'mine\n' }, manifest, async () => 'overwrite');
  assert.deepEqual(o.changes[0].after, 'v2\n');
  const u = await plan(desired, { 'a.txt': 'not ours\n' }, null, async (c) => { assert.equal(c.type, 'unmanagedFile'); return 'keep'; });
  assert.deepEqual(u.entries, []);
});

test('RF-MRG-01 + RNF-05: blocks in existing files keep the user text and its CRLF line endings', async () => {
  const desired = [{ kind: 'block', path: 'AGENTS.md', content: 'rules', generator: 'core' }];
  const r = await plan(desired, { 'AGENTS.md': '# Team\r\nMine\r\n' });
  assert.equal(r.changes[0].after, '# Team\r\nMine\r\n\r\n<!-- harness:begin -->\r\nrules\r\n<!-- harness:end -->\r\n');
  assert.equal(r.entries[0].createdFile, false);
  const edited = await plan(desired, { 'AGENTS.md': '<!-- harness:begin -->\nmine\n<!-- harness:end -->\n' }, { entries: [{ ...r.entries[0], hash: hashText('rules') }] }, async (c) => { assert.equal(c.type, 'modifiedBlock'); return 'keep'; });
  assert.deepEqual(edited.changes, []);
  const broken = await plan(desired, { 'AGENTS.md': '<!-- harness:begin -->\n' });
  assert.deepEqual(broken.errors, [{ path: 'AGENTS.md', code: 'brokenBlock' }]);
  assert.deepEqual(broken.changes, []);
});

test('RF-MRG-02/04/05: JSON keys are merged, conflicts asked, originals recorded and reverted', async () => {
  const desired = [{ kind: 'json', path: 's.json', values: { 'permissions.deny': ['Bash(git push:*)'], 'hooks.x': 1 }, generator: 'claude' }];
  const original = '{\n  "model": "opus",\n  "hooks": { "x": 5 }\n}\n';
  const conflicts = [];
  const r = await plan(desired, { 's.json': original }, null, async (c) => { conflicts.push(c); return 'harness'; });
  assert.equal(conflicts.length, 1);
  assert.deepEqual([conflicts[0].type, conflicts[0].key, conflicts[0].current, conflicts[0].desired], ['jsonKey', 'hooks.x', 5, 1]);
  const merged = JSON.parse(r.changes[0].after);
  assert.deepEqual(merged, { model: 'opus', hooks: { x: 1 }, permissions: { deny: ['Bash(git push:*)'] } });
  assert.deepEqual(r.entries[0].keys['hooks.x'], { hash: hashText('1'), hadPrevious: true, previous: 5 });

  // Removal restores exactly the previous values and drops the new keys.
  const removal = await planChanges({ desired: [], manifest: { entries: r.entries }, read: reader({ 's.json': r.changes[0].after }), resolve: keep });
  assert.deepEqual(JSON.parse(removal.changes[0].after), { model: 'opus', hooks: { x: 5 } });
});

test('RF-MRG-03: an unparsable JSON file is reported and left alone', async () => {
  const r = await plan([{ kind: 'json', path: 'bad.json', values: { a: 1 }, generator: 'x' }], { 'bad.json': '{ nope' });
  assert.equal(r.errors[0].code, 'invalidJson');
  assert.deepEqual(r.changes, []);
});

test('RF-REM-02/03: stale files are deleted when intact and asked about when edited', async () => {
  const manifest = {
    entries: [
      { kind: 'file', path: 'a', hash: hashText('A\n'), generator: 'core' },
      { kind: 'file', path: 'b', hash: hashText('B\n'), generator: 'core' },
      { kind: 'block', path: 'AGENTS.md', hash: hashText('rules'), generator: 'core', createdFile: true },
      { kind: 'config', path: 'harness.config.yaml' },
    ],
  };
  const files = { a: 'A\n', b: 'edited\n', 'AGENTS.md': '<!-- harness:begin -->\nrules\n<!-- harness:end -->\n' };
  const asked = [];
  const r = await plan([], files, manifest, async (c) => { asked.push(c.path); return 'keep'; });
  assert.deepEqual(asked, ['b']);
  assert.deepEqual(r.changes.map((c) => [c.path, c.after]), [['a', null], ['AGENTS.md', null]]);
  assert.deepEqual(r.entries, [{ kind: 'config', path: 'harness.config.yaml' }]);
});

test('RF-INI-18 / RNF-07: a failed write restores every file and removes new directories', (t) => {
  const root = tempDir(t);
  fs.writeFileSync(path.join(root, 'AGENTS.md'), 'original\n');
  let writes = 0;
  const failing = { ...fs, renameSync: (a, b) => { writes += 1; if (writes === 3) throw new Error('disk full'); return fs.renameSync(a, b); } };
  const changes = [
    { path: 'AGENTS.md', before: 'original\n', after: 'changed\n' },
    { path: '.harness/scripts/a.js', before: null, after: 'a' },
    { path: '.harness/templates/b.md', before: null, after: 'b' },
  ];
  assert.throws(() => applyChanges(root, changes, { fs: failing }), /disk full/);
  assert.equal(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), 'original\n');
  assert.deepEqual(fs.readdirSync(root), ['AGENTS.md']);
});

test('RF-INS-02: the writer refuses global tool directories', (t) => {
  const root = tempDir(t);
  const home = (process.env.USERPROFILE ?? process.env.HOME);
  assert.throws(() => applyChanges(root, [{ path: path.join(home, '.claude', 'x.json'), before: null, after: '{}' }]), { code: 'EHARNESS_GLOBAL' });
});
