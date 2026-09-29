// Lenient command-line splitter shared by the guards.
//
// It understands enough of POSIX sh, cmd.exe and PowerShell to find every
// simple command inside a command line: chains (&& || ; | &), newlines,
// subshells, $(...) and backtick substitutions, quoting and line
// continuations. It never throws: malformed input still yields commands, so
// the guards stay fail-safe.
//
// This module must stay dependency-free: it is copied into .harness/scripts/.

const MAX_DEPTH = 8;

/**
 * @typedef {{ words: string[], pipedFrom: string[] | null, redirects: string[] }} SimpleCommand
 * `redirects` lists the targets of output redirections (`> file`, `>> file`, `&> file`).
 */

/**
 * Splits `input` into simple commands. Commands found inside substitutions are
 * emitted before the command that contains them, in execution order.
 * @param {string} input
 * @returns {SimpleCommand[]}
 */
export function splitCommands(input, depth = 0) {
  const s = String(input ?? '').replace(/\r\n?/g, '\n');
  /** @type {SimpleCommand[]} */
  const commands = [];
  if (depth > MAX_DEPTH) return commands;

  let words = [];
  let word = null;
  let skipNextWord = false;
  let redirectOut = false;
  let redirects = [];
  let pipedFrom = null;
  let nextPiped = false;

  const append = (text) => {
    word = (word ?? '') + text;
  };
  const pushWord = () => {
    if (word === null) return;
    if (skipNextWord) {
      if (redirectOut) redirects.push(word);
      skipNextWord = false;
      redirectOut = false;
    } else {
      words.push(word);
    }
    word = null;
  };
  const endCommand = (pipe = false) => {
    pushWord();
    skipNextWord = false;
    if (words.length || redirects.length) {
      commands.push({ words, pipedFrom: nextPiped ? pipedFrom : null, redirects });
      if (words.length) pipedFrom = words;
    }
    nextPiped = pipe;
    words = [];
    redirects = [];
  };
  const substitute = (inner) => {
    const nested = splitCommands(inner, depth + 1);
    commands.push(...nested);
    return resolveSubstitution(nested, inner);
  };

  let i = 0;
  while (i < s.length) {
    const c = s[i];
    const n = s[i + 1];

    if (c === '\\') {
      if (n === '\n') { i += 2; continue; }
      if (n === undefined) { append('\\'); i += 1; continue; }
      // Keep the backslash before word characters so Windows paths survive;
      // name matching later also tries the backslash-free spelling.
      append(/[A-Za-z0-9_.-]/.test(n) ? '\\' + n : n);
      i += 2;
      continue;
    }

    if (c === '`') {
      if (n === '\n') { i += 2; continue; } // PowerShell line continuation
      const end = s.indexOf('`', i + 1);
      if (end === -1) { append(c); i += 1; continue; }
      append(substitute(s.slice(i + 1, end)));
      i = end + 1;
      continue;
    }

    if (c === "'") {
      const end = s.indexOf("'", i + 1);
      const stop = end === -1 ? s.length : end;
      append(s.slice(i + 1, stop));
      i = stop + 1;
      continue;
    }

    if (c === '$' && n === "'") {
      const { text, next } = readAnsiC(s, i + 2);
      append(text);
      i = next;
      continue;
    }

    if (c === '"') {
      const { text, next } = readDoubleQuoted(s, i + 1, substitute);
      append(text);
      i = next;
      continue;
    }

    if (c === '$' && n === '(') {
      if (s[i + 2] === '(') {
        const end = findClosing(s, i + 2);
        append(s.slice(i, end + 1));
        i = end + 1;
        continue;
      }
      const end = findClosing(s, i + 1);
      append(substitute(s.slice(i + 2, end)));
      i = end + 1;
      continue;
    }

    if ((c === '<' || c === '>') && n === '(') {
      const end = findClosing(s, i + 1);
      substitute(s.slice(i + 2, end));
      i = end + 1;
      continue;
    }

    if (c === '#' && word === null) {
      const end = s.indexOf('\n', i);
      i = end === -1 ? s.length : end;
      continue;
    }

    if (c === '\n' || c === ';') { endCommand(); i += 1; continue; }

    if (c === '&' && n === '>') {
      pushWord();
      i = readRedirect(s, i + 1);
      skipNextWord = !redirectHasInlineTarget(s, i);
      redirectOut = skipNextWord;
      continue;
    }

    if (c === '|' && n === '&') { endCommand(true); i += 2; continue; }
    if (c === '|' && n !== '|') { endCommand(true); i += 1; continue; }
    if (c === '|' || c === '&') { endCommand(); i += n === c ? 2 : 1; continue; }

    if (c === '(' || c === ')') { endCommand(); i += 1; continue; }

    if (c === '<' || c === '>') {
      // A bare file-descriptor number before the operator belongs to it.
      if (word !== null && /^\d+$/.test(word)) word = null;
      else pushWord();
      const start = i;
      i = readRedirect(s, i);
      const op = s.slice(start, i);
      if (op.endsWith('&')) {
        // `>&2` style: target is inline digits or nothing.
        while (i < s.length && /[0-9-]/.test(s[i])) i += 1;
        continue;
      }
      skipNextWord = true;
      redirectOut = op.includes('>');
      continue;
    }

    if (c === ' ' || c === '\t') { pushWord(); i += 1; continue; }

    append(c);
    i += 1;
  }
  endCommand();
  return commands;
}

function readRedirect(s, i) {
  while (i < s.length && (s[i] === '<' || s[i] === '>' || s[i] === '|')) i += 1;
  if (s[i] === '&') i += 1;
  return i;
}

function redirectHasInlineTarget(s, i) {
  return /[0-9-]/.test(s[i] ?? '');
}

function readDoubleQuoted(s, i, substitute) {
  let text = '';
  while (i < s.length && s[i] !== '"') {
    const c = s[i];
    const n = s[i + 1];
    if (c === '\\' && n !== undefined) {
      if (n === '\n') { i += 2; continue; }
      text += '$`"\\'.includes(n) ? n : c + n;
      i += 2;
      continue;
    }
    if (c === '$' && n === '(' && s[i + 2] !== '(') {
      const end = findClosing(s, i + 1);
      text += substitute(s.slice(i + 2, end));
      i = end + 1;
      continue;
    }
    if (c === '`') {
      const end = s.indexOf('`', i + 1);
      if (end !== -1) {
        text += substitute(s.slice(i + 1, end));
        i = end + 1;
        continue;
      }
    }
    text += c;
    i += 1;
  }
  return { text, next: i + 1 };
}

const ANSI_ESCAPES = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', v: '\v', '\\': '\\', "'": "'", '"': '"', '?': '?' };

function readAnsiC(s, i) {
  let text = '';
  while (i < s.length && s[i] !== "'") {
    if (s[i] !== '\\') { text += s[i]; i += 1; continue; }
    const n = s[i + 1];
    if (n === 'x') {
      const m = /^[0-9a-fA-F]{1,2}/.exec(s.slice(i + 2));
      if (m) { text += String.fromCharCode(parseInt(m[0], 16)); i += 2 + m[0].length; continue; }
    }
    if (n === 'u' || n === 'U') {
      const m = /^[0-9a-fA-F]{1,8}/.exec(s.slice(i + 2));
      if (m) { text += String.fromCodePoint(parseInt(m[0], 16)); i += 2 + m[0].length; continue; }
    }
    if (/[0-7]/.test(n ?? '')) {
      const m = /^[0-7]{1,3}/.exec(s.slice(i + 1));
      text += String.fromCharCode(parseInt(m[0], 8));
      i += 1 + m[0].length;
      continue;
    }
    text += ANSI_ESCAPES[n] ?? n ?? '';
    i += 2;
  }
  return { text, next: i + 1 };
}

/** Index of the parenthesis closing the one at `open`, or the last index. */
function findClosing(s, open) {
  let level = 0;
  for (let i = open; i < s.length; i += 1) {
    const c = s[i];
    if (c === '\\') { i += 1; continue; }
    if (c === "'") {
      const end = s.indexOf("'", i + 1);
      if (end === -1) return s.length - 1;
      i = end;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== '"') j += s[j] === '\\' ? 2 : 1;
      i = j;
      continue;
    }
    if (c === '(') level += 1;
    if (c === ')') {
      level -= 1;
      if (level === 0) return i;
    }
  }
  return s.length - 1;
}

const LOOKUP_COMMANDS = new Set(['which', 'where', 'where.exe', 'get-command', 'gcm', 'command', 'type', 'readlink', 'realpath']);
const PRINT_COMMANDS = new Set(['echo', 'printf', 'write-output', 'write-host']);

/**
 * Best-effort value of a substitution: `$(which git)` → "git",
 * `$(printf gi)` → "gi". Unknown substitutions keep a `$(...)` marker so the
 * guards can treat them as dynamic.
 */
function resolveSubstitution(nested, inner) {
  if (nested.length === 1) {
    const [name, ...args] = nested[0].words;
    const lname = (name ?? '').toLowerCase();
    const positional = args.filter((a) => !a.startsWith('-'));
    if (LOOKUP_COMMANDS.has(lname) && positional.length) return positional[positional.length - 1];
    if (PRINT_COMMANDS.has(lname)) return positional.join(' ');
  }
  return '$(' + inner + ')';
}

/** Splits a plain argument string on whitespace, honouring quotes. */
export function splitWords(text) {
  const cmds = splitCommands(String(text).replace(/[;&|()]/g, (m) => '\\' + m));
  return cmds.flatMap((c) => c.words);
}

/**
 * Lower-cased spellings under which a command word could run: the path
 * basename with and without escape characters, minus Windows extensions.
 * @returns {Set<string>}
 */
export function nameCandidates(word) {
  const out = new Set();
  const w = String(word ?? '');
  for (const variant of [w, w.replace(/[\\^]/g, '')]) {
    const base = variant.split(/[\\/]/).pop().toLowerCase();
    if (!base) continue;
    out.add(base.replace(/\.(exe|cmd|bat|com|ps1)$/, ''));
  }
  return out;
}

/** True when the word still contains an unresolved variable or substitution. */
export function isDynamic(word) {
  return /\$\(|\$\{?[A-Za-z_]|%[A-Za-z_]\w*%|`/.test(String(word ?? ''));
}

/**
 * Expands $VAR, ${VAR}, $env:VAR and %VAR% from `vars` (case-insensitive
 * fallback, as PowerShell and cmd are). Unknown variables are left as is.
 */
export function expandVars(word, vars) {
  const get = (name) => {
    if (Object.prototype.hasOwnProperty.call(vars, name)) return vars[name];
    const lower = name.toLowerCase();
    const key = Object.keys(vars).find((k) => k.toLowerCase() === lower);
    return key === undefined ? undefined : vars[key];
  };
  return String(word).replace(/\$\{(\w+)\}|\$(?:env:)?(\w+)|%(\w+)%/gi, (m, a, b, c) => {
    const value = get(a ?? b ?? c);
    return value === undefined ? m : value;
  });
}

/**
 * Records variable assignments made by `words` into `vars` (sh, cmd and
 * PowerShell forms). Returns true when the command was only an assignment.
 */
export function recordAssignments(words, vars) {
  if (!words.length) return false;
  const first = words[0];
  const lfirst = first.toLowerCase();
  const assign = (name, value) => {
    vars[name.replace(/^(env|script|global|local):/i, '')] = value;
  };

  if (words.every((w) => /^[A-Za-z_]\w*=/.test(w))) {
    for (const w of words) {
      const eq = w.indexOf('=');
      assign(w.slice(0, eq), w.slice(eq + 1));
    }
    return true;
  }
  if (['export', 'declare', 'typeset', 'local', 'readonly', 'set'].includes(lfirst)) {
    let any = false;
    for (const w of words.slice(1)) {
      const m = /^([A-Za-z_]\w*)=(.*)$/s.exec(w);
      if (m) { assign(m[1], m[2]); any = true; }
    }
    return any;
  }
  let m = /^\$([\w:]+)=(.*)$/s.exec(first);
  if (m) { assign(m[1], [m[2], ...words.slice(1)].join(' ').trim()); return true; }
  if (/^\$[\w:]+$/.test(first) && words[1] === '=') {
    assign(first.slice(1), words.slice(2).join(' '));
    return true;
  }
  if (lfirst === 'set-variable' || lfirst === 'sv') {
    const rest = words.slice(1);
    let name;
    let value;
    const positional = [];
    for (let i = 0; i < rest.length; i += 1) {
      const opt = rest[i].toLowerCase();
      if (opt === '-name') { name = rest[++i]; continue; }
      if (opt === '-value') { value = rest[++i]; continue; }
      positional.push(rest[i]);
    }
    name ??= positional[0];
    value ??= name === positional[0] ? positional[1] : positional[0];
    if (name !== undefined && value !== undefined) { assign(name, value); return true; }
  }
  return false;
}
