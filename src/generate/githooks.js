// Universal safety net: git pre-commit hook and CI template (RF-VER-03..06).

import { HEADER } from './core.js';

export const HOOKS_DIR = '.harness/githooks';
const CHECK_LINE = 'node .harness/scripts/checks.js pre-commit';

const PRE_COMMIT = `#!/usr/bin/env node
${HEADER.js}
// Runs the same checks as CI: docs whitelist, secrets, quick verification.
const { spawnSync } = require('child_process');
const path = require('path');
const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'checks.js'), 'pre-commit'], { stdio: 'inherit' });
process.exit(r.status === null ? 1 : r.status);
`;

/** Path from a repository folder back to the project root ('' → '.'). */
const upTo = (dir) => (dir ? dir.split('/').map(() => '..').join('/') : '.');

/**
 * One pre-commit for the whole project, wired into every repository: the
 * root one and, in multi-repo and workspace setups, each component repo.
 * @param {object} config
 * @param {{ repos: { dir: string, hooksManager: { name: string, hookFile?: string } | null }[], tracked: Set<string> }} env
 * @returns {{ entries: object[], notices: object[], gitConfig: { repo: string, key: string, value: string }[] }}
 */
export function generateGitHooks(config, env) {
  const out = { entries: [], notices: [], gitConfig: [] };
  if (!config.git_hooks?.enabled) return out;
  const local = (config.install_mode ?? 'local') === 'local';
  let needsHook = false;
  for (const repo of env.repos ?? []) {
    const up = upTo(repo.dir);
    const manager = repo.hooksManager;
    if (!manager) {
      needsHook = true;
      out.gitConfig.push({ repo: repo.dir, key: 'core.hooksPath', value: up === '.' ? HOOKS_DIR : `${up}/${HOOKS_DIR}` });
      continue;
    }
    // RF-VER-05: an existing hooks setup is never replaced; the checks are chained or skipped.
    const line = up === '.' ? CHECK_LINE : CHECK_LINE.replace('.harness/', `${up}/.harness/`);
    const hookFile = manager.hookFile ? (repo.dir ? `${repo.dir}/${manager.hookFile}` : manager.hookFile) : null;
    if (manager.name === 'husky' && hookFile && !(local && env.tracked?.has(hookFile))) {
      out.entries.push({ kind: 'block', style: 'hash', path: hookFile, content: line, generator: 'githooks' });
    } else {
      out.notices.push({ code: 'hooksChainManual', params: { manager: repo.dir ? `${manager.name} (${repo.dir})` : manager.name, line } });
    }
  }
  if (needsHook) out.entries.push({ kind: 'file', path: `${HOOKS_DIR}/pre-commit`, content: PRE_COMMIT, executable: true, generator: 'githooks' });
  return out;
}

function installStep(config) {
  const cmds = Object.values(config.components ?? {}).flatMap((c) => Object.values(c.verify ?? {}));
  if (cmds.some((c) => /^pnpm\b/.test(c))) return ['      - uses: pnpm/action-setup@v4', '      - run: pnpm install --frozen-lockfile'];
  if (cmds.some((c) => /^yarn\b/.test(c))) return ['      - run: yarn install --frozen-lockfile'];
  if (cmds.some((c) => /^bun\b/.test(c))) return ['      - uses: oven-sh/setup-bun@v2', '      - run: bun install --frozen-lockfile'];
  if (cmds.some((c) => /^npm\b/.test(c))) return ['      - run: npm ci'];
  return ['      # Install the project dependencies here.'];
}

/** RF-VER-06: GitHub Actions workflow with the hook checks plus the full suite. */
export function generateCi(config) {
  const out = { entries: [], notices: [] };
  if (config.ci?.provider !== 'github') return out;
  if ((config.install_mode ?? 'local') === 'local') {
    out.notices.push({ code: 'ciNeedsTeam', params: {} });
    return out;
  }
  const verify = Object.keys(config.components ?? {}).map((id) => `      - run: node .harness/scripts/sdd.js verify --component ${id}`);
  const content = [
    HEADER.hash,
    'name: sdd-harness',
    '',
    'on:',
    '  pull_request:',
    '  push:',
    '    branches: [main, master]',
    '',
    'jobs:',
    '  checks:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '        with:',
    '          fetch-depth: 0',
    '      - uses: actions/setup-node@v4',
    '        with:',
    "          node-version: '22'",
    ...installStep(config),
    '      - name: Hook checks (docs whitelist, secrets, verification)',
    '        run: node .harness/scripts/checks.js ci --range "${{ github.event.pull_request.base.sha || github.event.before }}...${{ github.sha }}"',
    '      # Full suite of every component',
    ...verify,
    '',
  ].join('\n');
  out.entries.push({ kind: 'file', path: '.github/workflows/sdd-harness.yml', content, generator: 'ci' });
  return out;
}
