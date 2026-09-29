// Pieces shared by init, sync and remove.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { generateProject } from '../../generate/index.js';
import { HOOKS_DIR } from '../../generate/githooks.js';
import { loadRegistry, readLock as readSkillsLock } from '../../skills/installer.js';
import { gitPath, gitTopLevel, trackedFiles, getConfig, setConfig } from '../../engine/git.js';
import { unifiedDiff } from '../../engine/diff.js';
import { posix } from '../../engine/text.js';

export function makeReader(root) {
  return (p) => {
    try {
      return readFileSync(path.resolve(root, p), 'utf8');
    } catch {
      return null;
    }
  };
}

/** RF-VER-05: a git hooks setup the project already has. */
export function detectHooksManager(root) {
  const current = gitTopLevel(root) ? getConfig(root, 'core.hooksPath') : null;
  if (existsSync(path.join(root, '.husky'))) {
    return { name: 'husky', hookFile: existsSync(path.join(root, '.husky', 'pre-commit')) ? '.husky/pre-commit' : undefined };
  }
  if (current && current !== HOOKS_DIR) return { name: 'core.hooksPath', path: current };
  for (const [file, name] of [['lefthook.yml', 'lefthook'], ['lefthook.yaml', 'lefthook'], ['.lefthook.yml', 'lefthook'], ['.pre-commit-config.yaml', 'pre-commit']]) {
    if (existsSync(path.join(root, file))) return { name };
  }
  try {
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    if (pkg['simple-git-hooks']) return { name: 'simple-git-hooks' };
  } catch {
    // No package.json.
  }
  return null;
}

/**
 * Repositories of the project (RF-TOP-02): the root one, if any, plus each
 * component that is its own repository in multi-repo and workspace setups.
 * @returns {{ dir: string, abs: string, excludePath: string }[]}
 */
export function detectRepos(root, config) {
  const repos = [];
  if (gitTopLevel(root) !== null) repos.push({ dir: '', abs: root, excludePath: gitPath(root, 'info/exclude') });
  if (['multi-repo', 'workspace'].includes(config.topology)) {
    for (const c of Object.values(config.components ?? {})) {
      const dir = posix(String(c.path)).replace(/^\.\/?/, '').replace(/\/$/, '');
      const abs = path.join(root, dir);
      if (!dir || repos.some((r) => r.dir === dir) || !existsSync(path.join(abs, '.git'))) continue;
      const exclude = gitPath(abs, 'info/exclude');
      if (exclude) repos.push({ dir, abs, excludePath: `${dir}/${exclude}` });
    }
  }
  return repos;
}

/** Desired state of every generator for `config`. */
export function buildDesired(config, root) {
  const repos = detectRepos(root, config);
  const tracked = new Set();
  for (const r of repos) for (const f of trackedFiles(r.abs)) tracked.add(r.dir ? `${r.dir}/${f}` : f);
  const inRepo = repos.some((r) => r.dir === '');
  const registry = loadRegistry();
  const installedSkills = Object.keys(readSkillsLock(root).skills).map((name) => registry.skills.find((s) => s.name === name) ?? { name, roles: [] });
  return generateProject(config, {
    tracked,
    repos,
    installedSkills,
    excludePath: inRepo ? repos[0].excludePath : null,
    read: makeReader(root),
    hooksManager: inRepo ? detectHooksManager(root) : null,
  });
}

/**
 * Git settings the harness owns (core.hooksPath), with the previous value
 * recorded so remove can restore it (RF-REM-07).
 */
export function planGitConfig(root, desired, manifest) {
  const inRepo = gitTopLevel(root) !== null;
  const old = new Map((manifest?.entries ?? []).filter((e) => e.kind === 'git-config').map((e) => [e.key, e]));
  const entries = [];
  const changes = [];
  if (!inRepo) return { entries, changes };
  for (const [key, value] of Object.entries(desired ?? {})) {
    const current = getConfig(root, key);
    entries.push(old.get(key) ?? { kind: 'git-config', key, hadPrevious: current !== null, ...(current !== null ? { previous: current } : {}) });
    if (current !== value) changes.push({ type: 'git-config', key, after: value });
  }
  for (const [key, e] of old) {
    if (!(key in (desired ?? {}))) changes.push({ type: 'git-config', key, after: e.hadPrevious ? e.previous : null });
  }
  return { entries, changes };
}

export function gitConfigAccess(root) {
  return { get: (k) => getConfig(root, k), set: (k, v) => setConfig(root, k, v) };
}

/** Directories that writing `paths` would create, outermost first. */
export function missingDirs(root, paths) {
  const out = new Set();
  for (const p of paths) {
    let dir = path.dirname(path.resolve(root, p));
    const chain = [];
    while (!existsSync(dir) && path.relative(root, dir) && !path.relative(root, dir).startsWith('..')) {
      chain.unshift(posix(path.relative(root, dir)));
      dir = path.dirname(dir);
    }
    chain.forEach((d) => out.add(d));
  }
  return [...out].sort();
}

/**
 * Resolver for plan conflicts. Interactive runs ask (with a "show diff"
 * option); `--yes` runs keep the user's version, never overwriting hand edits.
 */
export function makeResolver({ prompter, t, yes, out }) {
  return async (c) => {
    const header = c.type === 'jsonKey' ? t.conflict.jsonKey(c.path, c.key, c.current, c.desired) : t.conflict[c.type](c.path);
    if (yes) {
      out(`  ! ${header} → ${t.conflict.keep}`);
      return 'keep';
    }
    prompter.say(header);
    const options = [...c.choices, ...(c.type === 'jsonKey' ? [] : ['diff'])];
    for (;;) {
      const choice = await prompter.select(`conflict:${c.path}${c.key ? `#${c.key}` : ''}`, t.conflict.choose, options.map((v) => ({ value: v, label: t.conflict[v] })), { default: 'keep' });
      if (choice !== 'diff') return choice;
      prompter.say(unifiedDiff(c.current, c.desired, c.path) || '(no differences)');
    }
  };
}

export function renderReport(report, t) {
  const shown = report.filter((r) => r.action !== 'unchanged' && r.action !== 'gone');
  const seen = new Set();
  return shown
    .filter((r) => {
      const key = `${r.path}:${r.action}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((r) => `  ${r.action === 'delete' || r.action === 'strip' ? '-' : r.action === 'create' ? '+' : r.action === 'kept' || r.action === 'error' ? '!' : '~'} ${r.path}  (${t.action[r.action] ?? r.action})`);
}

export function renderDiffs(changes) {
  return changes.map((c) => unifiedDiff(c.before, c.after, c.path)).filter(Boolean).join('\n');
}

export function renderNotices(notices, t) {
  return notices.map((n) => `  ! ${t.notice[n.code]?.(n.params) ?? n.code}`);
}

export function renderErrors(errors, t) {
  return errors.map((e) => `  ✖ ${e.code === 'brokenBlock' ? t.errors.brokenBlock(e.path) : t.errors.invalidJson(e.path, e.message)}`);
}

/** Compares dotted versions: -1, 0 or 1. */
export function compareVersions(a, b) {
  const pa = String(a).split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  const pb = String(b).split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
  }
  return 0;
}
