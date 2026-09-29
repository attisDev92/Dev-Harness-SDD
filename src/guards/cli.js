#!/usr/bin/env node
// Guard runner. Tool hooks call it (through `sdd-harness guard …` or directly as
// .harness/scripts/guard.js) with the hook payload on stdin.
//
// Exit codes: 0 = allowed, 2 = blocked / stop (reason on stderr), 1 = usage.
// Any internal error blocks the action (fail-safe) with exit code 2.

import path from 'node:path';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs, isMainModule } from './args.js';
import { checkCommand } from './git-guard.js';
import { checkDocWrite } from './docs-guard.js';
import { guardMessages } from './messages.js';
import { findProjectRoot, loadGuardSettings } from './project.js';
import { classifyFix, errorSignature, loadState, recordFailure, resetTask, saveState } from './retry.js';

const EXIT_ALLOW = 0;
const EXIT_USAGE = 1;
const EXIT_BLOCK = 2;

/**
 * @typedef {{ stdout: { write(s: string): void }, stderr: { write(s: string): void }, readStdin: () => Promise<string>, env: Record<string,string|undefined>, cwd: string }} GuardIo
 */

/** @param {string[]} argv @param {GuardIo} io @returns {Promise<number>} */
export async function runGuard(argv, io) {
  const lang = pickLang(io.env);
  try {
    const [name, ...rest] = argv;
    if (name === 'git') return await gitGuard(rest, io, lang);
    if (name === 'docs') return await docsGuard(rest, io, lang);
    if (name === 'retry') return await retryGuard(rest, io, lang);
    io.stderr.write('usage: guard <git|docs|retry> [options]\n');
    return EXIT_USAGE;
  } catch (err) {
    io.stderr.write(guardMessages(lang).internalError(err?.message ?? String(err)) + '\n');
    return EXIT_BLOCK;
  }
}

function pickLang(env, settings) {
  const value = (env.HARNESS_LANG ?? settings?.language ?? '').toLowerCase();
  return value.startsWith('en') ? 'en' : 'es';
}

/** Reads the hook payload: JSON from any supported tool, or plain text. */
async function readPayload(io) {
  const raw = (await io.readStdin()).trim();
  if (!raw) return { text: '' };
  try {
    const j = JSON.parse(raw);
    if (typeof j === 'string') return { text: j };
    const input = j.tool_input ?? j.toolInput ?? j.args ?? j.input ?? j;
    return {
      command: input.command ?? j.command,
      file: input.file_path ?? input.filePath ?? input.path ?? input.notebook_path ?? j.file_path ?? j.path,
      cwd: j.cwd,
    };
  } catch {
    return { text: raw };
  }
}

function report(io, verdict, message, json) {
  if (json) io.stdout.write(JSON.stringify({ ...verdict, reason: message }) + '\n');
  if (verdict.decision === 'block' || verdict.decision === 'triage') {
    io.stderr.write(message + '\n');
    return EXIT_BLOCK;
  }
  if (!json && message) io.stdout.write(message + '\n');
  return EXIT_ALLOW;
}

async function gitGuard(argv, io, lang) {
  const { flags } = parseArgs(argv, { string: ['command', 'cwd'], boolean: ['json'] });
  const payload = flags.command === undefined ? await readPayload(io) : { command: flags.command };
  const command = payload.command ?? payload.text ?? '';
  const cwd = path.resolve(io.cwd, flags.cwd ?? payload.cwd ?? '.');
  const settings = loadGuardSettings(findProjectRoot(cwd));
  const msgs = guardMessages(pickLang(io.env, settings) ?? lang);
  const verdict = checkCommand(command, { cwd });
  const message = verdict.decision === 'block' ? msgs[verdict.kind](verdict.match) : '';
  return report(io, verdict, message, flags.json);
}

async function docsGuard(argv, io) {
  const { flags } = parseArgs(argv, { string: ['file', 'cwd'], boolean: ['json'] });
  const payload = flags.file === undefined ? await readPayload(io) : { file: flags.file };
  const file = payload.file ?? payload.text ?? '';
  const cwd = path.resolve(io.cwd, flags.cwd ?? payload.cwd ?? '.');
  const root = findProjectRoot(cwd) ?? cwd;
  const settings = loadGuardSettings(findProjectRoot(cwd));
  const msgs = guardMessages(pickLang(io.env, settings));
  if (!file) return report(io, { decision: 'allow' }, '', flags.json);
  const verdict = checkDocWrite({ file: path.resolve(cwd, file), root, whitelist: settings.docsWhitelist });
  const message = verdict.decision === 'block' ? msgs.docBlocked(verdict.match, settings.docsWhitelist) : '';
  return report(io, verdict, message, flags.json);
}

async function retryGuard(argv, io) {
  const { flags, positional } = parseArgs(argv, {
    string: ['task', 'error-file', 'error', 'files', 'scope', 'cwd'],
    boolean: ['json'],
  });
  const action = positional[0];
  const cwd = path.resolve(io.cwd, flags.cwd ?? '.');
  const root = findProjectRoot(cwd);
  const settings = loadGuardSettings(root);
  const msgs = guardMessages(pickLang(io.env, settings));
  // RF-INS-07: never write state into a project that is not activated.
  if (!root) {
    io.stderr.write(msgs.notActivated() + '\n');
    return EXIT_USAGE;
  }
  if (!['record', 'reset', 'status'].includes(action) || (action !== 'status' && !flags.task)) {
    io.stderr.write('usage: guard retry <record|reset|status> --task <id> [--error-file <f>|--error <text>] [--files a,b] [--scope glob,glob] [--json]\n');
    return EXIT_USAGE;
  }
  const state = loadState(root);

  if (action === 'status') {
    const data = flags.task ? state.tasks[flags.task] ?? null : state.tasks;
    io.stdout.write(JSON.stringify(data, null, 2) + '\n');
    return EXIT_ALLOW;
  }
  if (action === 'reset') {
    saveState(root, resetTask(state, flags.task));
    return report(io, { decision: 'allow', task: flags.task }, msgs.retryReset(flags.task), flags.json);
  }

  const errorText = flags['error-file'] !== undefined
    ? readFileSync(path.resolve(cwd, flags['error-file']), 'utf8')
    : flags.error ?? (await io.readStdin());
  const list = (v) => (v ? v.split(',').map((s) => s.trim().replace(/\\/g, '/')).filter(Boolean) : []);
  const files = list(flags.files);
  const fix = files.length ? classifyFix(files, list(flags.scope), settings.protected) : { scope: 'in', files: [] };
  const max = fix.scope === 'protected' ? settings.retries.protected : settings.retries.in_scope;
  const { state: next, verdict } = recordFailure(state, { task: flags.task, signature: errorSignature(errorText), fix, max });
  saveState(root, next);
  const message = verdict.kind === 'retryAllowed'
    ? msgs.retryAllowed(verdict.attempt, verdict.max)
    : verdict.kind === 'retryExhausted'
      ? msgs.retryExhausted(verdict.max)
      : msgs[verdict.kind](verdict.files);
  return report(io, { ...verdict, task: flags.task }, message, flags.json);
}

export function processIo() {
  return {
    stdout: process.stdout,
    stderr: process.stderr,
    env: process.env,
    cwd: process.cwd(),
    readStdin: () => readAll(process.stdin),
  };
}

function readAll(stream) {
  if (stream.isTTY) return Promise.resolve('');
  return new Promise((resolve, reject) => {
    let data = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => { data += chunk; });
    stream.on('end', () => resolve(data));
    stream.on('error', reject);
  });
}

if (isMainModule(import.meta.url)) {
  runGuard(process.argv.slice(2), processIo()).then((code) => { process.exitCode = code; });
}
