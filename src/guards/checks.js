#!/usr/bin/env node
// Checks shared by the git pre-commit hook and the CI template (RF-VER-03..06).
//   node .harness/scripts/checks.js pre-commit
//   node .harness/scripts/checks.js ci --range <base>...<head> [--full]
// Exit 0 when everything passes, 1 otherwise. Dependency-free.

import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs, isMainModule } from './args.js';
import { findProjectRoot, loadGuardSettings } from './project.js';
import { matchesAny } from './glob.js';
import { componentOf } from './files-guard.js';
import { runVerify } from './verify.js';

/** Well-known credential formats plus generic assignments of long secrets. */
export const SECRET_PATTERNS = [
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['private key', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/],
  ['GitHub token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/],
  ['Anthropic key', /\bsk-ant-[A-Za-z0-9_-]{20,}\b/],
  ['OpenAI key', /\bsk-(?:proj-)?[A-Za-z0-9]{32,}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Stripe key', /\b(?:sk|rk)_live_[0-9A-Za-z]{20,}\b/],
  ['secret assignment', /\b(?:api[_-]?key|secret|token|passw(?:or)?d|client[_-]?secret)\b["']?\s*[:=]\s*["'][^"'\s$<>{}]{16,}["']/i],
];
const ENV_FILE = /(^|\/)\.env(\.(?!example$|sample$|template$)[^/]*)?$/;

function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 256 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : '';
}

/** Added lines of a unified diff, with their file. */
export function addedLines(diff) {
  const out = [];
  let file = null;
  for (const line of String(diff).split(/\r?\n/)) {
    if (line.startsWith('+++ ')) file = line.slice(4).replace(/^b\//, '');
    else if (line.startsWith('+') && file && file !== '/dev/null') out.push({ file, text: line.slice(1) });
  }
  return out;
}

export function findSecrets(lines) {
  const hits = [];
  for (const { file, text } of lines) {
    for (const [name, re] of SECRET_PATTERNS) {
      if (re.test(text)) {
        hits.push({ file, kind: name });
        break;
      }
    }
  }
  return hits;
}

/**
 * @param {{ root: string, settings: object, mode: 'staged' | 'range', range?: string, full?: boolean, run?: Function }} opts
 * @returns {{ ok: boolean, problems: string[] }}
 */
export function runChecks({ root, settings, mode, range, full = false, run, repo = root }) {
  // The commit may happen in a component repository of a workspace: ask that
  // repo, and turn its paths into project paths (RF-TOP-02).
  const real = (p) => { try { return realpathSync(p); } catch { return path.resolve(p); } };
  const prefix = path.relative(real(root), real(repo)).split(path.sep).join('/');
  const toProject = (f) => (prefix ? `${prefix}/${f}` : f);
  const diffArgs = mode === 'staged' ? ['diff', '--cached'] : ['diff', range];
  const names = (filter) => git(repo, [...diffArgs, '--name-only', `--diff-filter=${filter}`, '-z']).split('\0').filter(Boolean).map(toProject);
  const changed = names('ACMR');
  const added = names('A');
  const problems = [];

  // Documentation whitelist (RF-MD-01) for new documents.
  for (const f of added.filter((x) => /\.(md|mdx)$/i.test(x))) {
    if (!matchesAny(f, settings.docsWhitelist)) problems.push(`docs: ${f} is not in the documentation whitelist`);
  }
  // Secrets (RF-OBS-02 spirit, RNF-11).
  for (const f of changed.filter((x) => ENV_FILE.test(x))) problems.push(`secrets: ${f} must not be committed`);
  for (const hit of findSecrets(addedLines(git(repo, [...diffArgs, '-U0', '--no-color'])))) problems.push(`secrets: possible ${hit.kind} in ${toProject(hit.file)}`);

  // Quick verification of the components with changes (full suite in CI).
  const touched = new Set(changed.map((f) => componentOf(f, settings.components)?.id).filter(Boolean));
  for (const id of touched) {
    const comp = settings.components[id];
    const result = runVerify(root, comp, { quick: !full, run });
    if (result.status === 'fail') problems.push(`verify: ${id} → ${result.failing.command} failed\n${result.results.at(-1).output}`);
  }
  return { ok: problems.length === 0, problems };
}

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2), { string: ['range'], boolean: ['full'] });
  const root = findProjectRoot(process.cwd());
  if (!root) return 0;
  const settings = loadGuardSettings(root);
  const mode = positional[0] === 'ci' ? 'range' : 'staged';
  if (mode === 'range' && !flags.range) {
    process.stderr.write('usage: checks.js ci --range <base>...<head> [--full]\n');
    return 1;
  }
  const repo = git(process.cwd(), ['rev-parse', '--show-toplevel']).trim() || root;
  const { ok, problems } = runChecks({ root, settings, mode, range: flags.range, full: flags.full, repo });
  if (!ok) {
    process.stderr.write(`sdd-harness checks failed:\n${problems.map((p) => `  ✖ ${p}`).join('\n')}\n`);
    return 1;
  }
  process.stdout.write('sdd-harness checks passed.\n');
  return 0;
}

if (isMainModule(import.meta.url)) {
  main().then((code) => { process.exitCode = code; });
}
