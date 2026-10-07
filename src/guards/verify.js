// Verification runner (RF-ORQ-05, RF-VER-01/02) and the
// change snapshot used to check role lanes (RF-DOM-03). Dependency-free.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const VERIFY_ORDER = ['lint', 'typecheck', 'test', 'e2e'];
const QUICK = ['lint', 'typecheck'];

function tail(text, lines = 60) {
  const all = String(text ?? '').replace(/\r\n?/g, '\n').trimEnd().split('\n');
  return all.slice(-lines).join('\n');
}

/**
 * Runs the configured commands of one component, stopping at the first
 * failure. `quick` runs only lint and typecheck (pre-commit). `evals` runs
 * only `verify.eval`: AI evaluations cost money and are not deterministic, so
 * they never run with the rest, only when a story closes.
 * @returns {{ status: 'pass' | 'fail' | 'unconfigured', results: { name: string, command: string, code: number, output: string }[], failing?: { name: string, command: string } }}
 */
export function runVerify(root, component, { quick = false, evals = false, run = defaultRun } = {}) {
  const commands = evals
    ? ['eval'].filter((k) => component.verify?.[k])
    : VERIFY_ORDER.filter((k) => component.verify?.[k] && (!quick || QUICK.includes(k)));
  if (!commands.length) return { status: quick ? 'pass' : 'unconfigured', results: [] };
  const cwd = path.resolve(root, component.path ?? '.');
  const results = [];
  for (const name of commands) {
    const command = component.verify[name];
    const { code, output } = run(command, cwd);
    results.push({ name, command, code, output: tail(output) });
    if (code !== 0) {
      return { status: 'fail', results, failing: { name, command } };
    }
  }
  return { status: 'pass', results };
}

function defaultRun(command, cwd) {
  const r = spawnSync(command, {
    cwd,
    shell: true,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15 * 60 * 1000,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, CI: process.env.CI ?? '1', FORCE_COLOR: '0' },
  });
  return { code: r.status ?? 1, output: `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? `\n${r.error.message}` : ''}` };
}

// Change snapshots (RF-DOM-03) ------------------------------------------------

/** Changed and untracked files of the repository with a content hash each. */
export function changeSnapshot(root) {
  const r = spawnSync('git', ['status', '--porcelain', '-z', '--untracked-files=all'], { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) return null;
  const snap = {};
  const parts = r.stdout.split('\0').filter(Boolean);
  for (let i = 0; i < parts.length; i += 1) {
    const status = parts[i].slice(0, 2);
    const file = parts[i].slice(3);
    if (status[0] === 'R' || status[0] === 'C') i += 1; // the next entry is the source path
    snap[file] = hashFile(path.join(root, file));
  }
  return snap;
}

function hashFile(file) {
  try {
    return createHash('sha1').update(readFileSync(file)).digest('hex');
  } catch {
    return 'deleted';
  }
}

/** Files that changed between two snapshots. */
export function changedSince(before, after) {
  const files = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  return [...files].filter((f) => (before?.[f] ?? 'clean') !== (after?.[f] ?? 'clean')).sort();
}
