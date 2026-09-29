import { mkdtempSync, rmSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BIN = path.join(ROOT, 'bin', 'harness.cjs');

/** Temporary directory with a non-ASCII name and a space (RNF-04). */
export function tempDir(t, prefix = 'harness ñandú-') {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Runs the CLI in a child process with an isolated, predictable environment. */
export function runCli(args, { cwd = ROOT, env = {}, input } = {}) {
  const merged = { ...process.env, HARNESS_LANG: 'en', NO_COLOR: '1', ...env };
  for (const key of Object.keys(merged)) if (merged[key] === undefined) delete merged[key];
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, input, encoding: 'utf8', env: merged, windowsHide: true });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** Relative paths and mtimes of every file under `dir`. */
export function snapshotTree(dir) {
  const out = {};
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      out[path.relative(dir, full)] = statSync(full).mtimeMs;
    }
  };
  walk(dir);
  return out;
}

export function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}
