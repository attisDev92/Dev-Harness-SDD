// Where the CLI may and may not write (RF-INS-02, RF-INS-03).

import os from 'node:os';
import path from 'node:path';

/**
 * The only directory the CLI owns in the user profile. It is created lazily,
 * only when something needs caching (skill downloads), and deleting it never
 * affects a project.
 */
export function cacheDir(env = process.env, platform = process.platform, home = os.homedir()) {
  if (env.HARNESS_CACHE_DIR) return path.resolve(env.HARNESS_CACHE_DIR);
  if (platform === 'win32') return path.join(env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local'), 'sdd-harness', 'Cache');
  if (platform === 'darwin') return path.join(home, 'Library', 'Caches', 'sdd-harness');
  return path.join(env.XDG_CACHE_HOME ?? path.join(home, '.cache'), 'sdd-harness');
}

/** Global configuration locations of the supported agent tools. */
export function globalToolDirs(env = process.env, home = os.homedir()) {
  const xdg = env.XDG_CONFIG_HOME ?? path.join(home, '.config');
  const dirs = [
    path.join(home, '.claude'),
    path.join(home, '.claude.json'),
    path.join(home, '.codex'),
    path.join(home, '.gemini'),
    path.join(home, '.opencode'),
    path.join(xdg, 'opencode'),
  ];
  if (env.CODEX_HOME) dirs.push(env.CODEX_HOME);
  if (env.CLAUDE_CONFIG_DIR) dirs.push(env.CLAUDE_CONFIG_DIR);
  if (env.APPDATA) dirs.push(path.join(env.APPDATA, 'opencode'));
  return dirs.map((d) => path.resolve(d));
}

function inside(target, dir, caseInsensitive) {
  const norm = (p) => (caseInsensitive ? p.toLowerCase() : p);
  const rel = path.relative(norm(dir), norm(target));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Throws if `target` is inside a global tool configuration directory. */
export function assertNotGlobalToolPath(target, env = process.env, home = os.homedir(), platform = process.platform) {
  const abs = path.resolve(target);
  const ci = platform === 'win32' || platform === 'darwin';
  const hit = globalToolDirs(env, home).find((dir) => inside(abs, dir, ci));
  if (hit) {
    const err = new Error(`refusing to write into a global tool directory: ${hit}`);
    err.code = 'EHARNESS_GLOBAL';
    throw err;
  }
  return abs;
}
