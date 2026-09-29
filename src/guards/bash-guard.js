// Shell guard: everything an agent runs in a terminal (RF-GAT-01/02/05,
// RF-GAT-09, and the file rules applied to shell writes). Dependency-free.

import path from 'node:path';
import { checkCommand, commandNames } from './git-guard.js';
import { checkWrite } from './files-guard.js';

const has = (n, ...xs) => xs.some((x) => n.has(x));
const positional = (args) => args.filter((a) => !a.startsWith('-'));

/**
 * RF-GAT-05: commands that add, remove or upgrade dependencies, for the
 * package managers of the proposal in the spec's open questions.
 */
export function installCommand(words) {
  const [head, ...args] = words;
  const n = commandNames(head);
  const pos = positional(args);
  const sub = pos[0];
  const withPkgs = pos.length > 1;
  const is = (...subs) => subs.includes(sub);
  let hit = false;
  if (has(n, 'npm')) hit = (is('install', 'i', 'in', 'isntall', 'add') && withPkgs) || is('uninstall', 'un', 'remove', 'rm', 'r', 'update', 'up', 'upgrade');
  else if (has(n, 'pnpm')) hit = is('add', 'remove', 'rm', 'un', 'uninstall', 'update', 'up', 'upgrade') || (is('install', 'i') && withPkgs);
  else if (has(n, 'yarn')) hit = is('add', 'remove', 'upgrade', 'up', 'upgrade-interactive');
  else if (has(n, 'bun')) hit = is('add', 'a', 'remove', 'rm', 'update') || (is('install', 'i') && withPkgs);
  else if (has(n, 'pip', 'pip3')) hit = is('install', 'uninstall');
  else if (has(n, 'python', 'python3', 'py') && args[0] === '-m' && ['pip', 'pip3'].includes(args[1])) hit = ['install', 'uninstall'].includes(positional(args.slice(2))[0]);
  else if (has(n, 'uv')) hit = is('add', 'remove') || (sub === 'pip' && ['install', 'uninstall'].includes(pos[1]));
  else if (has(n, 'poetry')) hit = is('add', 'remove', 'update');
  else if (has(n, 'pipenv')) hit = (is('install') && withPkgs) || is('uninstall', 'update');
  else if (has(n, 'cargo')) hit = is('add', 'remove', 'rm', 'install', 'update');
  else if (has(n, 'go')) hit = is('get', 'install') || (sub === 'mod' && pos[1] === 'tidy');
  else if (has(n, 'composer')) hit = is('require', 'remove', 'update', 'upgrade');
  else if (has(n, 'dotnet')) hit = (is('add', 'remove') && pos[2] === 'package') || (is('add', 'remove') && pos[1] === 'package');
  else if (has(n, 'gem')) hit = is('install', 'uninstall', 'update');
  else if (has(n, 'bundle', 'bundler')) hit = is('add', 'remove', 'update');
  return hit ? words.join(' ') : null;
}

const READ_ONLY = new Set(['cat', 'type', 'less', 'more', 'head', 'tail', 'ls', 'dir', 'grep', 'rg', 'wc', 'stat', 'file', 'get-content', 'gc', 'get-childitem', 'gci', 'select-string', 'sls', 'diff', 'git', 'echo', 'printf', 'test', '[', 'realpath']);

/** Files a command writes to, when that can be told from its arguments. */
export function writeTargets(words) {
  const [head, ...args] = words;
  const n = commandNames(head);
  const pos = positional(args);
  if (has(n, 'rm', 'del', 'erase', 'rmdir', 'unlink', 'remove-item', 'ri', 'touch', 'truncate', 'mkdir', 'new-item', 'ni', 'tee', 'chmod', 'chown')) {
    return has(n, 'chmod', 'chown') ? pos.slice(1) : pos;
  }
  if (has(n, 'mv', 'move', 'move-item', 'mi', 'rename', 'ren')) return pos;
  if (has(n, 'cp', 'copy', 'copy-item', 'cpi', 'install')) return pos.slice(-1);
  if (has(n, 'set-content', 'sc', 'add-content', 'ac', 'out-file', 'clear-content')) {
    const i = args.findIndex((a) => /^-(path|filepath|literalpath)$/i.test(a));
    return i !== -1 ? [args[i + 1]] : pos.slice(0, 1);
  }
  if (has(n, 'sed', 'perl') && args.some((a) => /^-[a-zA-Z]*i/.test(a) || a === '--in-place')) {
    const skip = new Set();
    args.forEach((a, i) => { if (a === '-e' || a === '-f') skip.add(i + 1); });
    const files = args.filter((a, i) => !a.startsWith('-') && !skip.has(i));
    return args.some((a) => a === '-e') ? files : files.slice(1);
  }
  if (has(n, 'dd')) return args.filter((a) => a.startsWith('of=')).map((a) => a.slice(3));
  return [];
}

const mentionsHarness = (w) => /(^|[\\/"'\s=])\.harness([\\/]|$)|harness\.config\.ya?ml/.test(w);

function isOwnScript(words) {
  const n = commandNames(words[0]);
  const script = positional(words.slice(1))[0] ?? '';
  return has(n, 'node') && /\.harness[\\/]scripts[\\/](sdd|guard)\.js$/.test(script);
}

/**
 * @param {string} command
 * @param {{ root: string, cwd?: string, settings: object, state: object, aliases?: object }} ctx
 */
export function checkShell(command, { root, cwd = root, settings, state, aliases }) {
  const extra = ({ words, redirects }) => {
    if (words.length) {
      // Only the user answers gates: the agent may not feed the hooks itself.
      if (words.some((w) => /\.harness[\\/]scripts[\\/]hook\.js/.test(w))) return { decision: 'block', kind: 'hookCall', match: words.join(' ') };
      const install = installCommand(words);
      if (install) return { decision: 'ask', kind: 'depsInstall', match: install };
    }
    const n = words.length ? commandNames(words[0]) : new Set();
    const readOnly = words.length && [...n].some((x) => READ_ONLY.has(x)) && !redirects.length;
    if (words.length && !readOnly && !isOwnScript(words) && words.slice(1).some(mentionsHarness)) {
      return { decision: 'block', kind: 'harnessFile', match: words.join(' ') };
    }
    for (const target of [...redirects, ...(words.length ? writeTargets(words) : [])]) {
      if (!target || /^(\/dev\/null|nul|\$null)$/i.test(target)) continue;
      const v = checkWrite({ root, file: path.resolve(cwd, target), settings, state, via: 'shell' });
      if (v.decision !== 'allow') return v;
    }
    return null;
  };
  // The harness's own scripts are protected from edits, so their text is trusted.
  const scripts = path.join(root, '.harness', 'scripts') + path.sep;
  const trusted = (abs) => abs.toLowerCase().startsWith(scripts.toLowerCase());
  return checkCommand(command, { cwd, aliases, extra, trusted });
}
