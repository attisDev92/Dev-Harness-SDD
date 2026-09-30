// Entry point of the `harness` CLI.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../guards/args.js';
import { CONFIG_FILE, findProjectRoot } from '../guards/project.js';
import { loadConfigFile } from '../config/load.js';
import { describeIssues } from '../config/format.js';
import { messages, PLANNED } from './i18n.js';
import { cmdMessages } from './i18n-commands.js';
import { initCommand } from './commands/init.js';
import { syncCommand } from './commands/sync.js';
import { doctorCommand } from './commands/doctor.js';
import { removeCommand } from './commands/remove.js';
import { upgradeCommand } from './commands/upgrade.js';
import { contractsCommand } from './commands/contracts.js';
import { skillsCommand } from './commands/skills.js';
import { trackerCommand } from './commands/tracker.js';

/** RF-TOP-03: `sdd-harness workspace init` is init with the workspace topology. */
async function workspaceCommand(argv, ctx) {
  if (argv[0] !== 'init') {
    ctx.io.stderr.write('Uso: sdd-harness workspace init [opciones de init]\n');
    return 1;
  }
  return initCommand(argv.slice(1), { ...ctx, presetTopology: 'workspace' });
}
const COMMANDS = { init: initCommand, sync: syncCommand, doctor: doctorCommand, remove: removeCommand, upgrade: upgradeCommand, contracts: contractsCommand, workspace: workspaceCommand, skills: skillsCommand, tracker: trackerCommand };

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'));
export const VERSION = pkg.version;

/**
 * Language of CLI messages: --lang, HARNESS_LANG or the project's
 * cli.language. Defaults to Spanish.
 */
export function resolveLang({ flag, env = process.env, cwd = process.cwd() } = {}) {
  const pick = (v) => {
    const s = String(v ?? '').toLowerCase();
    if (s.startsWith('es')) return 'es';
    if (s.startsWith('en')) return 'en';
    return undefined;
  };
  const fromProject = () => {
    const root = findProjectRoot(cwd);
    if (!root) return undefined;
    const result = loadConfigFile(path.join(root, CONFIG_FILE));
    return pick(result.config?.cli?.language);
  };
  return (
    pick(flag) ??
    pick(env.HARNESS_LANG) ??
    fromProject() ??
    // MVP: Spanish unless English is asked for explicitly.
    'es'
  );
}

/** Removes --lang wherever it appears and returns its value. */
function extractLang(argv) {
  const rest = [];
  let lang;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--lang') { lang = argv[i + 1]; i += 1; continue; }
    if (argv[i].startsWith('--lang=')) { lang = argv[i].slice(7); continue; }
    rest.push(argv[i]);
  }
  return { lang, rest };
}

export function processIo() {
  return {
    stdout: process.stdout,
    stderr: process.stderr,
    stdin: process.stdin,
    env: process.env,
    cwd: process.cwd(),
    readStdin: () => new Promise((resolve, reject) => {
      if (process.stdin.isTTY) return resolve('');
      let data = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => { data += chunk; });
      process.stdin.on('end', () => resolve(data));
      process.stdin.on('error', reject);
    }),
  };
}

/**
 * @param {string[]} argv
 * @param {ReturnType<typeof processIo>} io
 * @returns {Promise<number>} exit code
 */
export async function main(argv, io = processIo()) {
  const { lang: langFlag, rest: args } = extractLang(argv);
  const lang = resolveLang({ flag: langFlag, env: io.env, cwd: io.cwd });
  const t = messages(lang);
  const out = (s) => io.stdout.write(s + '\n');
  const err = (s) => io.stderr.write(s + '\n');
  const wantsHelp = (xs) => xs.includes('--help') || xs.includes('-h');

  const index = args.findIndex((a) => !a.startsWith('-'));
  const command = index === -1 ? undefined : args[index];
  const globals = index === -1 ? args : args.slice(0, index);
  const rest = index === -1 ? [] : args.slice(index + 1);

  if (globals.includes('--version') || globals.includes('-v')) {
    out(VERSION);
    return 0;
  }
  if (!command) {
    const unknown = globals.find((a) => a !== '--help' && a !== '-h');
    if (unknown) {
      err(t.unknownOption(unknown));
      return 1;
    }
    out(t.help(VERSION));
    return 0;
  }

  try {
    if (command === 'config') {
      if (wantsHelp(rest) || rest[0] !== 'validate') {
        out(t.configHelp);
        return wantsHelp(rest) ? 0 : 1;
      }
      return configValidate(rest.slice(1), io, t);
    }
    if (COMMANDS[command]) {
      if (wantsHelp(rest)) {
        out(t.commandHelp[command]);
        return 0;
      }
      return await COMMANDS[command](rest, { io, t, tc: cmdMessages(lang), lang, version: VERSION });
    }
    if (PLANNED[command]) {
      if (wantsHelp(rest) || wantsHelp(globals)) {
        out(t.plannedHelp(command, PLANNED[command]));
        return 0;
      }
      err(t.notAvailable(command, PLANNED[command], `v${VERSION}`));
      return 1;
    }
    err(t.unknownCommand(command));
    return 1;
  } catch (e) {
    err(t.internalError(e?.message ?? String(e)));
    return 1;
  }
}

function configValidate(argv, io, t) {
  const { flags, unknown } = parseArgs(argv, { string: ['file'], boolean: ['json'] });
  if (unknown.length) {
    io.stderr.write(t.unknownOption(unknown[0]) + '\n');
    return 1;
  }
  const root = findProjectRoot(io.cwd) ?? io.cwd;
  const file = path.resolve(io.cwd, flags.file ?? path.join(root, CONFIG_FILE));
  const shown = path.relative(io.cwd, file) || file;
  if (!existsSync(file)) {
    if (flags.json) io.stdout.write(JSON.stringify({ ok: false, file, issues: [{ path: '', code: 'missing' }] }) + '\n');
    else io.stderr.write(t.configMissing(shown) + '\n');
    return 1;
  }
  const result = loadConfigFile(file);
  const issues = describeIssues(result.issues, t);
  if (flags.json) {
    io.stdout.write(JSON.stringify({ ok: result.ok, file, issues }, null, 2) + '\n');
    return result.ok ? 0 : 1;
  }
  if (result.ok) {
    io.stdout.write(t.configValid(shown) + '\n');
    return 0;
  }
  io.stderr.write(t.configInvalid(shown, issues.length) + '\n');
  for (const i of issues) {
    const where = i.line ? `${shown}:${i.line}:${i.col}` : shown;
    io.stderr.write(`  ${where}  ${i.path}: ${i.message}\n`);
  }
  return 1;
}
