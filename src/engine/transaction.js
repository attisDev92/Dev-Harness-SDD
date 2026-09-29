// All-or-nothing application of file changes (RF-INI-18, RNF-07).
//
// Every original is kept in memory before the first write. If any step fails,
// the files written so far are restored, created files are deleted and new
// directories are removed, so the project is left exactly as it was.

import * as nodeFs from 'node:fs';
import path from 'node:path';
import { assertNotGlobalToolPath } from '../cli/paths.js';

/**
 * @typedef {{ path: string, before: string | null, after: string | null }} FileChange
 * @typedef {{ type: 'git-config', key: string, before: string | null, after: string | null }} GitConfigChange
 */

/**
 * @param {string} root
 * @param {FileChange[]} changes
 * @param {{ fs?: typeof nodeFs, gitConfig?: { get(k: string): string|null, set(k: string, v: string|null): void }, configChanges?: GitConfigChange[], pruneDirs?: string[] }} [options]
 * @returns {{ createdDirs: string[], removedDirs: string[] }}
 */
export function applyChanges(root, changes, options = {}) {
  const fs = options.fs ?? nodeFs;
  const done = [];
  const createdDirs = [];
  const configDone = [];

  const ensureDir = (dir) => {
    const missing = [];
    let d = dir;
    while (!fs.existsSync(d)) {
      missing.unshift(d);
      const parent = path.dirname(d);
      if (parent === d) break;
      d = parent;
    }
    for (const m of missing) {
      fs.mkdirSync(m);
      createdDirs.push(m);
    }
  };

  try {
    for (const change of changes) {
      const abs = assertNotGlobalToolPath(path.resolve(root, change.path));
      const original = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
      done.push({ abs, original });
      if (change.after === null) {
        if (original !== null) fs.unlinkSync(abs);
        continue;
      }
      ensureDir(path.dirname(abs));
      writeFile(fs, abs, change.after);
      if (change.executable) {
        try {
          fs.chmodSync(abs, 0o755);
        } catch {
          // Windows has no executable bit; git runs the hook through its shell.
        }
      }
    }
    for (const c of options.configChanges ?? []) {
      configDone.push({ key: c.key, repo: c.repo ?? '', original: options.gitConfig.get(c.key, c.repo ?? '') });
      options.gitConfig.set(c.key, c.after, c.repo ?? '');
    }
  } catch (error) {
    rollback(fs, done, createdDirs, configDone, options.gitConfig);
    throw error;
  }

  const removedDirs = [];
  const prune = [...new Set((options.pruneDirs ?? []).map((d) => path.resolve(root, d)))].sort((a, b) => b.length - a.length);
  for (const dir of prune) {
    try {
      if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
        fs.rmdirSync(dir);
        removedDirs.push(dir);
      }
    } catch {
      // A directory that cannot be removed is left in place.
    }
  }
  return { createdDirs, removedDirs };
}

const BUSY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);

// Windows rejects a rename over a file another process (e.g. an open Claude Code
// session) is watching. Retry briefly, then write in place: the original is
// already held in memory, so the rollback still works.
function writeFile(fs, abs, content) {
  const tmp = `${abs}.harness-${process.pid}.tmp`;
  fs.writeFileSync(tmp, content);
  for (let attempt = 0; ; attempt += 1) {
    try {
      fs.renameSync(tmp, abs);
      return;
    } catch (error) {
      if (!BUSY_CODES.has(error.code)) throw error;
      if (attempt >= 4) break;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (attempt + 1));
    }
  }
  fs.writeFileSync(abs, content);
  try {
    fs.unlinkSync(tmp);
  } catch {
    // The rollback removes leftover temporary files.
  }
}

function rollback(fs, done, createdDirs, configDone, gitConfig) {
  for (const { abs, original } of done.reverse()) {
    try {
      for (const leftover of fs.readdirSync(path.dirname(abs)).filter((n) => n.startsWith(path.basename(abs) + '.harness-'))) {
        fs.unlinkSync(path.join(path.dirname(abs), leftover));
      }
    } catch {
      // Directory may not exist.
    }
    try {
      if (original === null) {
        if (fs.existsSync(abs)) fs.unlinkSync(abs);
      } else {
        fs.writeFileSync(abs, original);
      }
    } catch {
      // Best effort: keep restoring the rest.
    }
  }
  for (const { key, repo, original } of configDone.reverse()) {
    try {
      gitConfig.set(key, original, repo);
    } catch {
      // Best effort.
    }
  }
  for (const dir of createdDirs.reverse()) {
    try {
      fs.rmdirSync(dir);
    } catch {
      // Not empty or already gone.
    }
  }
}
