// RF-RET-01, RF-RET-02, RF-RET-03, RF-RET-06, RF-RET-07.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { classifyFix, errorSignature, recordFailure, resetTask, loadState, saveState, STATE_FILE } from '../src/guards/retry.js';
import { runCli, tempDir } from './helpers.js';

const fail = (state, signature, extra = {}) => recordFailure(state, { task: 'T1', signature, ...extra });

test('RF-RET-01: up to 2 automatic in-scope attempts, then triage', () => {
  let r = fail(undefined, 'a');
  assert.deepEqual([r.verdict.decision, r.verdict.attempt], ['retry', 1]);
  r = fail(r.state, 'b');
  assert.deepEqual([r.verdict.decision, r.verdict.attempt], ['retry', 2]);
  r = fail(r.state, 'c');
  assert.deepEqual([r.verdict.decision, r.verdict.kind], ['triage', 'retryExhausted']);
});

test('RF-RET-03: the same error twice in a row stops immediately', () => {
  let r = fail(undefined, 'same');
  r = fail(r.state, 'same');
  assert.deepEqual([r.verdict.decision, r.verdict.kind], ['triage', 'retryRepeated']);
});

test('RF-RET-03: once in triage the task stays stopped until reset', () => {
  let r = fail(undefined, 'x');
  r = fail(r.state, 'x');
  r = fail(r.state, 'new error');
  assert.equal(r.verdict.decision, 'triage');
});

test('RF-RET-02: fixes outside the task scope or in protected zones never retry', () => {
  const zones = { deps: ['package.json', '**/package-lock.json'], db: ['**/migrations/**'] };
  const scope = ['src/auth/**', 'tests/auth/**'];
  assert.deepEqual(classifyFix(['src/auth/login.ts'], scope, zones), { scope: 'in', files: [] });
  assert.deepEqual(classifyFix(['src/auth/login.ts', 'src/db/pool.ts'], scope, zones), { scope: 'out', files: ['src/db/pool.ts'] });
  assert.deepEqual(classifyFix(['src/auth/x.ts', 'db/migrations/002.sql'], scope, zones), { scope: 'protected', files: ['db/migrations/002.sql'] });
  // Edge case 14: a task without a declared scope cannot be fixed automatically.
  assert.equal(classifyFix(['src/a.ts'], [], zones).scope, 'out');

  const out = fail(undefined, 'e', { fix: { scope: 'out', files: ['src/db/pool.ts'] } });
  assert.deepEqual([out.verdict.decision, out.verdict.kind, out.state.tasks.T1.attempts], ['triage', 'retryOutOfScope', 0]);
  const prot = fail(undefined, 'e', { fix: { scope: 'protected', files: ['package.json'] } });
  assert.deepEqual([prot.verdict.decision, prot.verdict.kind], ['triage', 'retryProtected']);
});

test('RF-RET-06: choosing a triage option resets the counter of that task only', () => {
  let r = fail(undefined, 'a');
  r = fail(r.state, 'a');
  r.state.tasks.T2 = { attempts: 1, lastSignature: 'z', status: 'active' };
  const state = resetTask(r.state, 'T1');
  assert.equal(state.tasks.T1, undefined);
  assert.equal(state.tasks.T2.attempts, 1);
  assert.equal(fail(state, 'a').verdict.decision, 'retry');
});

test('error signatures ignore volatile details (edge case 15 stays comparable)', () => {
  const a = '\x1b[31mFAIL\x1b[0m src/a.test.ts (12 ms)\n  expected 1 to be 2\n at 2026-09-28T10:00:00Z 0x7ffe12';
  const b = 'FAIL src/a.test.ts (340 ms)\r\n  expected 1 to be 2\r\n at 2026-09-29T11:22:33Z 0x1234';
  assert.equal(errorSignature(a), errorSignature(b));
  assert.notEqual(errorSignature(a), errorSignature('FAIL src/a.test.ts\n expected 3 to be 2'));
});

test('state is persisted atomically under .harness/state/', (t) => {
  const dir = tempDir(t);
  saveState(dir, { version: 1, tasks: { T1: { attempts: 1 } } });
  assert.equal(loadState(dir).tasks.T1.attempts, 1);
  writeFileSync(path.join(dir, STATE_FILE), '{corrupt');
  assert.deepEqual(loadState(dir), { version: 1, tasks: {} });
});

test('RF-RET-07: the counter is enforced by a deterministic script (CLI)', (t) => {
  const dir = tempDir(t);
  writeFileSync(path.join(dir, 'harness.config.yaml'), 'harness_version: 0.1.0\n');
  const record = (error, extra = []) => runCli(['guard', 'retry', 'record', '--task', 'T3', '--error', error, '--json', ...extra], { cwd: dir });

  let r = record('boom 1');
  assert.equal(r.code, 0);
  assert.deepEqual(JSON.parse(r.stdout).attempt, 1);
  r = record('boom 2');
  assert.equal(r.code, 0);
  r = record('boom 3');
  assert.equal(r.code, 2);
  assert.equal(JSON.parse(r.stdout).kind, 'retryExhausted');
  assert.match(r.stderr, /triage/);

  assert.equal(runCli(['guard', 'retry', 'reset', '--task', 'T3'], { cwd: dir }).code, 0);
  r = record('boom 4', ['--files', 'package.json', '--scope', 'src/**']);
  assert.equal(r.code, 2);
  assert.equal(JSON.parse(r.stdout).kind, 'retryOutOfScope');

  const status = JSON.parse(runCli(['guard', 'retry', 'status', '--task', 'T3'], { cwd: dir }).stdout);
  assert.equal(status.status, 'triage');
  assert.ok(JSON.parse(readFileSync(path.join(dir, STATE_FILE), 'utf8')).tasks.T3);
});

test('RF-RET-07 + RF-INS-07: no state is written in a project that is not activated', (t) => {
  const dir = tempDir(t);
  const r = runCli(['guard', 'retry', 'record', '--task', 'T1', '--error', 'x'], { cwd: dir });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /harness init/);
  assert.equal(existsSync(path.join(dir, '.harness')), false);
});
