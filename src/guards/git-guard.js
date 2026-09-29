// Git guard (RF-GAT-01, RF-GAT-02): blocks agent commands that create commits
// or rewrite history or the remote, including chained, wrapped, aliased and
// indirect invocations. Dependency-free (copied into .harness/scripts/).

import { readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import {
  splitCommands,
  splitWords,
  nameCandidates,
  isDynamic,
  expandVars,
  recordAssignments,
} from './shell.js';

const MAX_DEPTH = 8;
const MAX_FILE_BYTES = 1024 * 1024;

/** Subcommands that always create commits or rewrite history or the remote. */
export const ALWAYS_BLOCKED = new Set([
  'commit', 'commit-tree', 'push', 'rebase', 'merge', 'pull', 'cherry-pick',
  'revert', 'am', 'update-ref', 'filter-branch', 'filter-repo', 'replace',
  'send-pack', 'fast-import', 'subtree',
]);

/** Subcommands that are blocked only with some arguments. */
const CONDITIONAL = new Set(['reset', 'tag', 'stash', 'branch', 'reflog', 'checkout', 'switch']);

// Builtins that cannot be shadowed by aliases and are never blocked, so the
// guard can skip reading the alias table for the most common commands.
const SAFE_BUILTINS = new Set([
  'status', 'diff', 'log', 'show', 'add', 'rm', 'mv', 'fetch', 'blame', 'grep',
  'ls-files', 'rev-parse', 'config', 'init', 'clone', 'restore', 'describe',
  'shortlog', 'ls-tree', 'cat-file', 'remote', 'worktree', 'help', 'version',
]);

const GIT_VALUE_OPTIONS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env', '--super-prefix', '--list-cmds', '--attr-source']);

const KEYWORDS = new Set(['{', '}', '!', 'then', 'do', 'else', 'elif', 'if', 'while', 'until', 'coproc', 'time', '&', '@', 'call']);

const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'mksh', 'ash', 'fish', 'busybox']);
const SHELL_EXT = new Set(['.sh', '.bash', '.zsh', '.ksh', '.ps1', '.psm1', '.cmd', '.bat']);
const SCRIPT_EXT = new Set([...SHELL_EXT, '.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.py', '.rb', '.pl', '.php']);

const COMMIT_TOOLS = {
  'git-cz': () => true,
  cz: () => true,
  commitizen: () => true,
  'semantic-release': () => true,
  'standard-version': () => true,
  'release-it': () => true,
  np: () => true,
  lerna: (args) => args.some((a) => a === 'version' || a === 'publish'),
  changeset: (args) => args.some((a) => a === 'tag' || a === 'publish'),
};

const GIT_SUBS_RE = 'commit|push|rebase|merge|pull|cherry-pick|revert|am|update-ref|filter-branch|filter-repo|tag|reset\\s+--hard|stash\\s+(?:drop|clear)|branch\\s+-[A-Za-z]*D';
const SEP = '[\\s"\'`,\\[\\]()]';
const CODE_GIT_RE = new RegExp(
  `\\bgit(?:\\.exe)?\\b(?:${SEP}+-{1,2}[\\w.=/:-]+(?:${SEP}+[\\w./:-]+)?){0,3}${SEP}+(${GIT_SUBS_RE})\\b`,
  'i',
);
const GIT_LIBRARY_RE = /\b(simple-?git|isomorphic-git|nodegit|gitpython|pygit2|dulwich|from\s+git\s+import|import\s+git\b|require\(\s*['"]git['"]\s*\))/i;
const GIT_LIBRARY_CALL_RE = /\.(commit|push|merge|rebase|tag|reset|cherry_?pick|revert)\s*\(/i;

/**
 * @typedef {{ decision: 'allow' } | { decision: 'block', kind: string, match: string }} GitVerdict
 * @typedef {(cmd: { words: string[], redirects: string[], cwd: string }) => GitVerdict | { decision: 'ask', kind: string, match: string } | null} ExtraCheck
 * @typedef {{ cwd?: string, aliases?: Record<string,string>, readFile?: (p: string) => string | null, extra?: ExtraCheck, trusted?: (absPath: string) => boolean }} GitGuardOptions
 */

/**
 * Checks a command line an agent wants to run.
 * @param {string} command
 * @param {GitGuardOptions} [options]
 * @returns {GitVerdict}
 */
export function checkCommand(command, options = {}) {
  const ctx = {
    cwd: options.cwd ?? process.cwd(),
    readFile: options.readFile ?? readLimited,
    aliasTable: options.aliases,
    visited: new Set(),
    vars: {},
    extra: options.extra,
    trusted: options.trusted,
    asks: [],
  };
  // A block anywhere wins; otherwise the first "ask" (e.g. installing a dependency).
  return analyzeLine(command, ctx, 0) ?? ctx.asks[0] ?? { decision: 'allow' };
}

export { names as commandNames, unwrap as unwrapCommand };

/** Heuristic check of source code executed by an agent (node -e, python x.py…). */
export function scanCode(text) {
  const m = CODE_GIT_RE.exec(text);
  if (m) return m[0].replace(/[\s"'`,[\]()]+/g, ' ').trim();
  if (GIT_LIBRARY_RE.test(text)) {
    const call = GIT_LIBRARY_CALL_RE.exec(text);
    if (call) return call[0].replace(/\s*\($/, '(…)');
  }
  return null;
}

function block(kind, match) {
  return { decision: 'block', kind, match };
}

function analyzeLine(text, ctx, depth) {
  if (depth > MAX_DEPTH) return block('tooDeep', String(text).slice(0, 80));
  for (const cmd of splitCommands(text)) {
    const words = cmd.words.map((w) => expandVars(w, ctx.vars));
    const redirects = (cmd.redirects ?? []).map((w) => expandVars(w, ctx.vars));
    if (ctx.extra && redirects.length) {
      const v = ctx.extra({ words: [], redirects, cwd: ctx.cwd });
      if (v?.decision === 'block') return v;
      if (v?.decision === 'ask') ctx.asks.push(v);
    }
    if (recordAssignments(words, ctx.vars)) continue;
    const verdict = analyzeWords(words, cmd.pipedFrom, ctx, depth);
    if (verdict) return verdict;
  }
  return null;
}

function names(word) {
  return nameCandidates(word);
}

function has(nameSet, ...candidates) {
  return candidates.some((c) => nameSet.has(c));
}

/**
 * Index of the first positional argument, skipping options. Options listed in
 * `withValue` consume the next word unless written as --opt=value.
 */
function firstPositional(args, withValue = new Set()) {
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (a === '--') return i + 1;
    if (!a.startsWith('-') || a === '-') return i;
    i += withValue.has(a) ? 2 : 1;
  }
  return i;
}

const WRAPPERS = {
  sudo: new Set(['-u', '-g', '-h', '-p', '-C', '-D', '-r', '-t', '-U', '-T', '--user', '--group', '--host', '--prompt', '--chdir']),
  doas: new Set(['-u', '-C']),
  nohup: new Set(),
  exec: new Set(['-a']),
  builtin: new Set(),
  nice: new Set(['-n', '--adjustment']),
  ionice: new Set(['-c', '-n', '-p', '--class', '--classdata']),
  stdbuf: new Set(['-i', '-o', '-e']),
  unbuffer: new Set(),
  chronic: new Set(),
  caffeinate: new Set(['-w', '-t']),
  winpty: new Set(),
  strace: new Set(['-o', '-e', '-p', '-s']),
  watch: new Set(['-n', '--interval', '-d']),
};

/** Removes prefixes that only change how the real command runs. */
function unwrap(words) {
  let w = words;
  let xargs = false;
  for (let guard = 0; guard < 32 && w.length; guard += 1) {
    const head = w[0];
    if (KEYWORDS.has(head) || /^[A-Za-z_]\w*=/.test(head)) { w = w.slice(1); continue; }
    const n = names(head);
    const rest = w.slice(1);
    const wrapper = Object.keys(WRAPPERS).find((k) => n.has(k));
    if (wrapper) { w = rest.slice(firstPositional(rest, WRAPPERS[wrapper])); continue; }
    if (n.has('command')) {
      if (rest.some((a) => a === '-v' || a === '-V')) return { words: [], xargs };
      w = rest.slice(firstPositional(rest));
      continue;
    }
    if (n.has('env')) {
      const i = firstPositional(rest, new Set(['-u', '--unset', '-C', '--chdir', '-S', '--split-string']));
      const split = rest.findIndex((a) => a === '-S' || a === '--split-string');
      w = split !== -1 && rest[split + 1] !== undefined
        ? [...splitWords(rest[split + 1]), ...rest.slice(i)]
        : rest.slice(i);
      continue;
    }
    if (n.has('timeout')) {
      const i = firstPositional(rest, new Set(['-s', '-k', '--signal', '--kill-after']));
      w = rest.slice(i + 1);
      continue;
    }
    if (n.has('xargs')) {
      xargs = true;
      w = rest.slice(firstPositional(rest, new Set(['-n', '-I', '-i', '-d', '-L', '-l', '-P', '-s', '-E', '-e', '-a', '--max-args', '--max-procs', '--delimiter', '--arg-file', '--replace'])));
      continue;
    }
    if (n.has('start') && rest.length) {
      let i = 0;
      while (i < rest.length && (/^\/[A-Za-z]/.test(rest[i]) || rest[i] === '')) i += /^\/d$/i.test(rest[i]) ? 2 : 1;
      w = rest.slice(i);
      continue;
    }
    break;
  }
  return { words: w, xargs };
}

function analyzeWords(rawWords, pipedFrom, ctx, depth) {
  const { words, xargs } = unwrap(rawWords);
  if (!words.length) return null;
  if (ctx.extra) {
    const v = ctx.extra({ words, redirects: [], cwd: ctx.cwd });
    if (v?.decision === 'block') return v;
    if (v?.decision === 'ask') ctx.asks.push(v);
  }
  const [head, ...args] = words;
  const n = names(head);

  if (has(n, 'git', 'hub')) return analyzeGit(args, ctx, depth, { xargs });
  const dashed = [...n].find((x) => /^git-[a-z][a-z-]*$/.test(x));
  if (dashed && !COMMIT_TOOLS[dashed]) return analyzeGit([dashed.slice(4), ...args], ctx, depth, { xargs });

  const tool = Object.keys(COMMIT_TOOLS).find((k) => n.has(k));
  if (tool && COMMIT_TOOLS[tool](args)) return block('commitTool', [tool, ...args].join(' ').trim());

  if (has(n, ...SHELLS)) return analyzeShell(args, n, pipedFrom, ctx, depth);
  if (n.has('cmd')) {
    const i = args.findIndex((a) => /^\/[ck]$/i.test(a));
    if (i !== -1) return analyzeLine(args.slice(i + 1).join(' '), ctx, depth + 1);
    return pipedFrom ? analyzePiped(pipedFrom, head, ctx, depth) : null;
  }
  if (has(n, 'powershell', 'pwsh')) return analyzePowerShell(args, pipedFrom, ctx, depth);
  if (has(n, 'eval', 'iex', 'invoke-expression')) {
    const code = args.filter((a) => a.toLowerCase() !== '-command').join(' ');
    if (code) return analyzeLine(code, ctx, depth + 1);
    return pipedFrom ? analyzePiped(pipedFrom, head, ctx, depth) : null;
  }
  if (has(n, 'source', '.') && args[0]) return scanFile(args[0], ctx, depth);
  if (n.has('find')) return analyzeFind(args, ctx, depth);
  if (has(n, 'npx', 'bunx', 'pnpx')) return analyzeExecPackage(args, ctx, depth);
  if (has(n, 'npm', 'pnpm', 'yarn', 'bun')) return analyzePackageManager(n.has('bun') ? 'bun' : n.has('yarn') ? 'yarn' : n.has('pnpm') ? 'pnpm' : 'npm', args, ctx, depth);
  if (has(n, 'node', 'deno', 'tsx', 'ts-node', 'python', 'python3', 'py', 'ruby', 'perl', 'php')) return analyzeInterpreter(n, args, ctx, depth);
  if (has(n, 'gh', 'glab')) return analyzeForge(n.has('gh') ? 'gh' : 'glab', args);
  if (has(n, 'start-process', 'saps')) return analyzeStartProcess(args, ctx, depth);

  if (isDynamic(head) && args.some((a) => ALWAYS_BLOCKED.has(a) || CONDITIONAL.has(a))) {
    return block('gitDynamic', words.join(' '));
  }
  if (looksLikeScript(head)) return scanFile(head, ctx, depth);
  return null;
}

function looksLikeScript(word) {
  const ext = path.extname(word).toLowerCase();
  return SCRIPT_EXT.has(ext) || /^\.{1,2}[\\/]/.test(word);
}

function analyzeShell(args, n, pipedFrom, ctx, depth) {
  let rest = args;
  if (n.has('busybox')) {
    if (!SHELLS.has((rest[0] ?? '').toLowerCase())) return null;
    rest = rest.slice(1);
  }
  let i = 0;
  let inline = false;
  while (i < rest.length && /^[-+]/.test(rest[i]) && rest[i] !== '--' && rest[i] !== '-') {
    const a = rest[i];
    if (!a.startsWith('--') && a.slice(1).includes('c')) inline = true;
    if (a === '--command') inline = true;
    i += ['-o', '+o', '-O', '+O', '--rcfile', '--init-file'].includes(a) ? 2 : 1;
  }
  if (rest[i] === '--') i += 1;
  if (inline) return rest[i] === undefined ? null : analyzeLine(rest[i], ctx, depth + 1);
  if (rest[i] !== undefined && rest[i] !== '-') return scanFile(rest[i], ctx, depth);
  return pipedFrom ? analyzePiped(pipedFrom, 'sh', ctx, depth) : null;
}

const PS_VALUE_OPTIONS = /^-(executionpolicy|ep|ex|windowstyle|w|outputformat|of|o|inputformat|if|workingdirectory|wd|configurationname|config|version|v|psconsolefile|settingsfile|custompipename)$/i;

function analyzePowerShell(args, pipedFrom, ctx, depth) {
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    const lower = a.toLowerCase();
    if (/^-(e|ec|en|enc|enco|encod|encode|encoded|encodedc\w*)$/.test(lower) && lower !== '-ex') {
      return analyzeLine(decodeBase64Utf16(args[i + 1] ?? ''), ctx, depth + 1);
    }
    if (/^-(c|co|com|comm|comma|comman|command)$/.test(lower) || lower === '-commandwithargs' || lower === '-cwa') {
      const code = args.slice(i + 1).join(' ');
      if (code === '-' || code === '') return pipedFrom ? analyzePiped(pipedFrom, 'powershell', ctx, depth) : null;
      return analyzeLine(code, ctx, depth + 1);
    }
    if (/^-(f|fi|fil|file)$/.test(lower)) return args[i + 1] ? scanFile(args[i + 1], ctx, depth) : null;
    if (PS_VALUE_OPTIONS.test(lower)) { i += 1; continue; }
    if (a.startsWith('-')) continue;
    if (/\.ps1$/i.test(a)) return scanFile(a, ctx, depth);
    return analyzeLine(args.slice(i).join(' '), ctx, depth + 1);
  }
  return pipedFrom ? analyzePiped(pipedFrom, 'powershell', ctx, depth) : null;
}

function decodeBase64Utf16(text) {
  try {
    return Buffer.from(text, 'base64').toString('utf16le');
  } catch {
    return text;
  }
}

/** A shell or eval reading its program from a pipe. */
function analyzePiped(pipedFrom, consumer, ctx, depth) {
  const producer = names(pipedFrom[0] ?? '');
  const args = pipedFrom.slice(1).filter((a) => !a.startsWith('-'));
  if (has(producer, 'echo', 'printf', 'write-output', 'write-host')) return analyzeLine(args.join(' '), ctx, depth + 1);
  if (has(producer, 'cat', 'type', 'get-content', 'gc')) {
    for (const f of args) {
      const verdict = scanFile(f, ctx, depth, true);
      if (verdict) return verdict;
    }
    return null;
  }
  return block('gitPiped', `${pipedFrom.join(' ')} | ${consumer}`);
}

function analyzeFind(args, ctx, depth) {
  for (let i = 0; i < args.length; i += 1) {
    if (!['-exec', '-execdir', '-ok', '-okdir'].includes(args[i])) continue;
    const end = args.findIndex((a, j) => j > i && (a === ';' || a === '+'));
    const inner = args.slice(i + 1, end === -1 ? args.length : end);
    const verdict = analyzeWords(inner, null, ctx, depth + 1);
    if (verdict) return verdict;
  }
  return null;
}

function stripVersion(pkg) {
  return pkg.replace(/(.)@[^/]*$/, '$1');
}

function analyzeExecPackage(args, ctx, depth) {
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '-c' || a === '--call') return analyzeLine(args[i + 1] ?? '', ctx, depth + 1);
    if (a.startsWith('--call=')) return analyzeLine(a.slice(7), ctx, depth + 1);
    if (a === '-p' || a === '--package') { i += 1; continue; }
    if (a === '--') return analyzeWords(args.slice(i + 1), null, ctx, depth + 1);
    if (a.startsWith('-')) continue;
    return analyzeWords([stripVersion(a), ...args.slice(i + 1)], null, ctx, depth + 1);
  }
  return null;
}

const PM_BUILTINS = new Set([
  'install', 'i', 'add', 'remove', 'rm', 'uninstall', 'un', 'update', 'up', 'upgrade', 'ci', 'init', 'create',
  'link', 'unlink', 'list', 'ls', 'outdated', 'publish', 'pack', 'audit', 'info', 'view', 'why', 'config',
  'cache', 'store', 'login', 'logout', 'whoami', 'help', 'bin', 'prefix', 'root', 'dedupe', 'prune', 'setup',
  'import', 'patch', 'fetch', 'rebuild', 'workspaces', 'workspace', 'set', 'node', 'env', 'doctor', 'search',
]);

function analyzePackageManager(pm, args, ctx, depth) {
  let dir = ctx.cwd;
  const rest = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (['--prefix', '-C', '--dir', '--cwd'].includes(a)) { dir = path.resolve(ctx.cwd, args[i + 1] ?? '.'); i += 1; continue; }
    const m = /^--(prefix|dir|cwd)=(.*)$/.exec(a);
    if (m) { dir = path.resolve(ctx.cwd, m[2]); continue; }
    rest.push(a);
  }
  const positional = rest.filter((a) => !a.startsWith('-'));
  const sub = positional[0];
  if (sub === undefined) return null;
  const after = rest.slice(rest.indexOf(sub) + 1);

  if (sub === 'version') {
    const noGit = rest.some((a) => a === '--no-git-tag-version' || a === '--git-tag-version=false');
    const bump = after.some((a) => !a.startsWith('-')) || rest.some((a) => /^--(major|minor|patch|premajor|preminor|prepatch|prerelease|new-version)/.test(a));
    if (bump && !noGit) return block('commitTool', `${pm} version ${after.join(' ')}`.trim());
  }
  if (['exec', 'x', 'dlx'].includes(sub)) return analyzeExecPackage(after, ctx, depth);
  if (pm === 'bun' && sub !== 'run' && looksLikeScript(sub)) return scanFile(path.resolve(dir, sub), ctx, depth);

  let script;
  if (sub === 'run' || sub === 'run-script' || sub === 'rum' || sub === 'urn') script = after.find((a) => !a.startsWith('-'));
  else if (['test', 't', 'tst', 'start', 'stop', 'restart'].includes(sub)) script = { t: 'test', tst: 'test' }[sub] ?? sub;
  else if (pm !== 'npm' && !PM_BUILTINS.has(sub)) script = sub;
  if (!script) return null;
  if (pm === 'bun' && sub === 'run' && looksLikeScript(script)) return scanFile(path.resolve(dir, script), ctx, depth);
  return analyzePackageScript(dir, script, ctx, depth);
}

function analyzePackageScript(dir, script, ctx, depth) {
  const file = path.join(dir, 'package.json');
  const key = `${file}#${script}`;
  if (ctx.visited.has(key)) return null;
  ctx.visited.add(key);
  let scripts;
  try {
    scripts = JSON.parse(ctx.readFile(file) ?? '{}').scripts ?? {};
  } catch {
    return null;
  }
  const subCtx = { ...ctx, cwd: dir };
  for (const name of [`pre${script}`, script, `post${script}`]) {
    if (typeof scripts[name] !== 'string') continue;
    const verdict = analyzeLine(scripts[name], subCtx, depth + 1);
    if (verdict) return verdict;
  }
  return null;
}

const INTERPRETER_VALUE_OPTIONS = new Set(['-r', '--require', '--import', '--loader', '--experimental-loader', '-C', '--conditions', '--env-file', '--input-type', '-W', '-X']);

function codeFlagsFor(n) {
  if (has(n, 'python', 'python3', 'py')) return new Set(['-c']);
  if (has(n, 'ruby', 'perl')) return new Set(['-e', '-E']);
  if (n.has('php')) return new Set(['-r']);
  return new Set(['-e', '--eval', '-p', '--print']);
}

function analyzeInterpreter(n, args, ctx, depth) {
  const codeFlags = codeFlagsFor(n);
  let rest = args;
  if (n.has('deno')) {
    if (rest[0] === 'eval') return verdictFromCode(rest.slice(1).find((a) => !a.startsWith('-')) ?? '');
    if (['run', 'task'].includes(rest[0])) rest = rest.slice(1);
  }
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (codeFlags.has(a)) return verdictFromCode(rest[i + 1] ?? '');
    const eq = /^--(eval|print)=(.*)$/s.exec(a);
    if (eq) return verdictFromCode(eq[2]);
    if (a === '-m' && codeFlags.has('-c')) return null;
    if (INTERPRETER_VALUE_OPTIONS.has(a)) { i += 1; continue; }
    if (a.startsWith('-')) continue;
    return scanFile(a, ctx, depth, true);
  }
  return null;
}

function verdictFromCode(code) {
  const m = scanCode(code);
  return m ? block('codeGit', m) : null;
}

const FORGE_WRITES = {
  gh: { pr: ['merge', 'create'], release: ['create', 'delete', 'edit', 'upload'], repo: ['sync', 'delete', 'rename', 'archive'] },
  glab: { mr: ['merge', 'create'], release: ['create', 'delete'] },
};

function analyzeForge(cli, args) {
  const positional = args.filter((a) => !a.startsWith('-'));
  const [group, action] = positional;
  if (FORGE_WRITES[cli][group]?.includes(action)) return block('remoteChange', `${cli} ${group} ${action}`);
  if (group === 'api') {
    const methodIndex = args.findIndex((a) => a === '-X' || a === '--method');
    const method = methodIndex !== -1 ? args[methodIndex + 1] : args.find((a) => /^(-X|--method=)/.test(a))?.replace(/^(-X|--method=)/, '');
    const writes = args.some((a) => /^(-f|-F|--field|--raw-field|--input)$/.test(a));
    if ((method && !/^get$/i.test(method)) || writes) return block('remoteChange', `${cli} api ${method ?? 'POST'}`);
  }
  return null;
}

function analyzeStartProcess(args, ctx, depth) {
  let file;
  const argList = [];
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    const lower = args[i].toLowerCase();
    if (lower === '-filepath') { file = args[++i]; continue; }
    if (lower === '-argumentlist' || lower === '-args') { argList.push(args[++i] ?? ''); continue; }
    if (/^-(workingdirectory|windowstyle|verb|redirectstandard\w+|credential)$/.test(lower)) { i += 1; continue; }
    if (lower.startsWith('-')) continue;
    positional.push(args[i]);
  }
  file ??= positional.shift();
  argList.push(...positional);
  if (!file) return null;
  const words = argList.flatMap((a) => a.split(/[,\s]+/)).filter(Boolean);
  return analyzeWords([file, ...words], null, ctx, depth + 1);
}

function scanFile(file, ctx, depth, codeOnly = false) {
  if (depth > MAX_DEPTH) return block('tooDeep', file);
  const abs = path.resolve(ctx.cwd, file);
  if (ctx.visited.has(abs) || ctx.trusted?.(abs)) return null;
  ctx.visited.add(abs);
  const text = ctx.readFile(abs);
  if (text == null) return null;
  const ext = path.extname(abs).toLowerCase();
  const shellLike = SHELL_EXT.has(ext) || (!ext && /^#!.*\b(sh|bash|zsh|dash|ksh|pwsh|powershell)\b/.test(text));
  if (shellLike && !codeOnly) {
    const verdict = analyzeLine(text, { ...ctx, cwd: path.dirname(abs) }, depth + 1);
    if (verdict) return verdict;
  }
  return verdictFromCode(text);
}

function readLimited(file) {
  try {
    const st = statSync(file);
    if (!st.isFile()) return null;
    const buf = readFileSync(file);
    return buf.subarray(0, MAX_FILE_BYTES).toString('utf8');
  } catch {
    return null;
  }
}

function loadAliases(ctx, gitCwd) {
  if (ctx.aliasTable) return ctx.aliasTable;
  const table = {};
  const r = spawnSync('git', ['config', '--get-regexp', '^alias\\.'], {
    cwd: gitCwd,
    encoding: 'utf8',
    timeout: 3000,
    windowsHide: true,
  });
  if (r.status === 0 && r.stdout) {
    for (const line of r.stdout.split(/\r?\n/)) {
      const m = /^alias\.(\S+)\s+(.*)$/.exec(line);
      if (m) table[m[1].toLowerCase()] = m[2];
    }
  }
  ctx.aliasTable = table;
  return table;
}

function analyzeGit(args, ctx, depth, { xargs = false } = {}) {
  if (depth > MAX_DEPTH) return block('tooDeep', `git ${args.join(' ')}`);
  const inlineAliases = {};
  const globals = [];
  let gitCwd = ctx.cwd;
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (GIT_VALUE_OPTIONS.has(a)) {
      const value = args[i + 1] ?? '';
      if (a === '-c') recordInlineAlias(value, inlineAliases);
      if (a === '-C') gitCwd = path.resolve(gitCwd, value);
      globals.push(a, value);
      i += 2;
      continue;
    }
    if (/^-c./.test(a)) recordInlineAlias(a.slice(2), inlineAliases);
    if (!a.startsWith('-')) break;
    globals.push(a);
    i += 1;
  }
  const sub = args[i];
  const rest = args.slice(i + 1);
  if (sub === undefined) return xargs ? block('gitPiped', 'xargs git') : null;
  if (isDynamic(sub)) return block('gitDynamic', `git ${sub}`);

  const lower = sub.toLowerCase();
  const direct = checkGitSubcommand(lower, rest, gitCwd);
  if (direct) return block('gitBlocked', direct);
  if (SAFE_BUILTINS.has(lower) || CONDITIONAL.has(lower)) return null;

  const alias = inlineAliases[lower] ?? loadAliases(ctx, gitCwd)[lower];
  if (alias === undefined) return null;
  const aliasCtx = { ...ctx, aliasTable: { ...loadAliases(ctx, gitCwd), ...inlineAliases } };
  if (alias.startsWith('!')) {
    return analyzeLine([alias.slice(1), ...rest.map(quote)].join(' '), aliasCtx, depth + 1);
  }
  const expanded = splitWords(alias);
  if (expanded[0]?.toLowerCase() === lower) return null;
  return analyzeGit([...globals, ...expanded, ...rest], aliasCtx, depth + 1, { xargs });
}

function recordInlineAlias(setting, table) {
  const m = /^alias\.([^=]+)=(.*)$/is.exec(setting);
  if (m) table[m[1].toLowerCase()] = m[2];
}

function quote(word) {
  return `'${word.replace(/'/g, `'\\''`)}'`;
}

/** Returns a description of the blocked operation, or null when it is safe. */
export function checkGitSubcommand(sub, rest, cwd = process.cwd()) {
  const describe = () => `git ${[sub, ...rest].join(' ')}`.trim();
  if (ALWAYS_BLOCKED.has(sub)) return describe();
  const flags = rest.filter((a) => a.startsWith('-'));
  const shortHas = (chars) => flags.some((f) => /^-[A-Za-z]+$/.test(f) && [...chars].some((c) => f.includes(c)));

  switch (sub) {
    case 'stash':
      return ['drop', 'clear'].includes(rest[0]) ? describe() : null;
    case 'reflog':
      return ['expire', 'delete'].includes(rest[0]) ? describe() : null;
    case 'branch':
      return shortHas('DMCf') || flags.includes('--force') ? describe() : null;
    case 'checkout':
      return shortHas('B') ? describe() : null;
    case 'switch':
      return shortHas('C') || flags.includes('--force-create') ? describe() : null;
    case 'tag': {
      const listing = flags.some((f) => /^(-l|--list|-n\d*|--contains|--no-contains|--points-at|--merged|--no-merged|--sort.*|--format.*|--column.*|-v|--verify)$/.test(f));
      if (listing) return null;
      const positional = rest.filter((a) => !a.startsWith('-'));
      return positional.length || flags.length ? describe() : null;
    }
    case 'reset': {
      if (flags.some((f) => ['--hard', '--soft', '--keep', '--merge'].includes(f))) return describe();
      const sep = rest.indexOf('--');
      const beforeSep = (sep === -1 ? rest : rest.slice(0, sep)).filter((a) => !a.startsWith('-'));
      const revision = beforeSep.find((a) => a !== 'HEAD' && !pathExists(cwd, a));
      return revision ? describe() : null;
    }
    default:
      return null;
  }
}

function pathExists(cwd, p) {
  try {
    statSync(path.resolve(cwd, p));
    return true;
  } catch {
    return false;
  }
}
