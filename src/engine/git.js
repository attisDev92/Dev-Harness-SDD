// Thin wrappers around the git CLI. All of them are read-only except the
// core.hooksPath helpers, which only `remove` (and later `init`) use.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { posix } from './text.js';

function run(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, out: r.stdout ?? '', err: r.stderr ?? '' };
}

/** Top-level directory of the repository containing `dir`, or null. */
export function gitTopLevel(dir) {
  const r = run(dir, ['rev-parse', '--show-toplevel']);
  return r.ok ? path.resolve(r.out.trim()) : null;
}

/** True when `dir` itself is the root of a git repository. */
export function isRepoRoot(dir) {
  return existsSync(path.join(dir, '.git'));
}

/** Tracked (or staged) files, as posix paths relative to `root`. */
export function trackedFiles(root) {
  if (!gitTopLevel(root)) return new Set();
  const r = run(root, ['ls-files', '-z', '--full-name']);
  if (!r.ok) return new Set();
  const top = gitTopLevel(root);
  const prefix = posix(path.relative(top, root));
  const files = r.out.split('\0').filter(Boolean);
  return new Set(
    files
      .filter((f) => !prefix || f.startsWith(prefix + '/'))
      .map((f) => (prefix ? f.slice(prefix.length + 1) : f)),
  );
}

/** Path of a file inside the git directory (handles worktrees), relative to root. */
export function gitPath(root, name) {
  const r = run(root, ['rev-parse', '--git-path', name]);
  if (!r.ok) return null;
  return posix(path.relative(root, path.resolve(root, r.out.trim())));
}

export function getConfig(root, key) {
  const r = run(root, ['config', '--local', '--get', key]);
  return r.ok ? r.out.trim() : null;
}

export function setConfig(root, key, value) {
  const r = value === null ? run(root, ['config', '--local', '--unset', key]) : run(root, ['config', '--local', key, value]);
  if (!r.ok && value !== null) throw new Error(`git config ${key}: ${r.err.trim()}`);
}

export function hasCommits(root) {
  return run(root, ['rev-parse', '--verify', 'HEAD']).ok;
}

export function recentCommitSubjects(root, n = 50) {
  const r = run(root, ['log', `-n${n}`, '--format=%s']);
  return r.ok ? r.out.split(/\r?\n/).filter(Boolean) : [];
}

/** Direct child directories that are git repositories. */
export function childRepos(dir) {
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
    .filter((e) => {
      try {
        return statSync(path.join(dir, e.name, '.git')) != null;
      } catch {
        return false;
      }
    })
    .map((e) => e.name)
    .sort();
}

export function gitAvailable() {
  return run(process.cwd(), ['--version']).ok;
}
