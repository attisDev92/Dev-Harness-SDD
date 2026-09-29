// Deterministic retry counter (RF-RET-01..03, RF-RET-06, RF-RET-07).
// Dependency-free: it runs from .harness/scripts/ and keeps its state in
// .harness/state/attempts.json, independent of what the model decides.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { matchesAny } from './glob.js';

export const STATE_FILE = path.join('.harness', 'state', 'attempts.json');

/**
 * Stable fingerprint of a verification failure. Volatile details (colours,
 * timings, dates, memory addresses, temp paths) are removed so that the same
 * error produces the same signature across runs.
 */
export function errorSignature(output) {
  const normalized = String(output ?? '')
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g, '<date>')
    .replace(/\b\d+(?:\.\d+)?\s?(?:ms|s|sec|seconds|m)\b/g, '<time>')
    .replace(/0x[0-9a-f]+/gi, '<addr>')
    .replace(/(?:[A-Za-z]:)?[\\/][^\s'"]*?[\\/](?:tmp|temp)[\\/][^\s'"]*/gi, '<tmp>')
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

/**
 * Where a fix would land: 'protected' if any file is in a protected zone,
 * 'out' if any file is outside the task scope, otherwise 'in'.
 * @param {string[]} files posix paths relative to the project root
 * @param {string[]} scope globs of the task scope
 * @param {Record<string,string[]>} protectedZones
 */
export function classifyFix(files, scope, protectedZones) {
  // `package.json#dependencies` protects a section; at file level it counts as the file.
  const zones = Object.values(protectedZones ?? {}).flat().filter((p) => typeof p === 'string').map((p) => p.replace(/#.*$/, ''));
  const inProtected = files.filter((f) => matchesAny(f, zones));
  if (inProtected.length) return { scope: 'protected', files: inProtected };
  const outside = files.filter((f) => !scope.length || !matchesAny(f, scope));
  if (outside.length) return { scope: 'out', files: outside };
  return { scope: 'in', files: [] };
}

function emptyState() {
  return { version: 1, tasks: {} };
}

/**
 * Pure transition for a verification failure of `task`.
 * @returns {{ state: object, verdict: { decision: 'retry' | 'triage', kind: string, attempt: number, max: number, files: string[] } }}
 */
export function recordFailure(state, { task, signature, fix = { scope: 'in', files: [] }, max = 2 }) {
  const next = structuredClone(state ?? emptyState());
  const entry = next.tasks[task] ?? { attempts: 0, lastSignature: null, status: 'active' };
  const previous = entry.lastSignature;
  entry.lastSignature = signature;
  next.tasks[task] = entry;

  const triage = (kind, files = []) => {
    entry.status = 'triage';
    entry.triageReason = kind;
    return { state: next, verdict: { decision: 'triage', kind, attempt: entry.attempts, max, files } };
  };

  if (entry.status === 'triage') return triage(entry.triageReason ?? 'retryExhausted');
  if (fix.scope === 'protected') return triage('retryProtected', fix.files);
  if (fix.scope === 'out') return triage('retryOutOfScope', fix.files);
  if (previous !== null && previous === signature) return triage('retryRepeated');
  if (entry.attempts >= max) return triage('retryExhausted');
  entry.attempts += 1;
  return { state: next, verdict: { decision: 'retry', kind: 'retryAllowed', attempt: entry.attempts, max, files: [] } };
}

/** RF-RET-06: the user chose a triage option, so the task starts over. */
export function resetTask(state, task) {
  const next = structuredClone(state ?? emptyState());
  delete next.tasks[task];
  return next;
}

export function loadState(root) {
  try {
    const data = JSON.parse(readFileSync(path.join(root, STATE_FILE), 'utf8'));
    return data && typeof data.tasks === 'object' ? data : emptyState();
  } catch {
    return emptyState();
  }
}

/** Atomic write: a crash never leaves a half-written state file. */
export function saveState(root, state) {
  const file = path.join(root, STATE_FILE);
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
  renameSync(tmp, file);
}
