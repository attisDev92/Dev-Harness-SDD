// Flow state (RF-SDD-18, RF-ORQ-09). Dependency-free.
//
// What matters is visible in the project: the `status` in the frontmatter of
// each spec.md and the checkboxes of tasks.md. .harness/state/runtime.json only
// keeps ephemeral data that never stops the work: the pending stop, the last
// verification per component, alerts already shown and running subagents.

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { listSpecs, parseTasks, specRoots } from './tasks.js';

export const RUNTIME_FILE = path.join('.harness', 'state', 'runtime.json');
export const EVENTS_FILE = path.join('.harness', 'logs', 'events.jsonl');
export const STATUSES = ['draft', 'spec-approved', 'plan-approved', 'done'];
/** The two stops of the flow and the status each one leads to (RF-SDD-13). */
export const STOPS = { spec: 'spec-approved', plan: 'plan-approved' };

export function emptyRuntime() {
  return { version: 2, pending: null, verify: {}, alerted: [], subagents: {} };
}

function writeAtomic(file, text) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

export function safeRead(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

export function loadRuntime(root) {
  try {
    const data = JSON.parse(readFileSync(path.join(root, RUNTIME_FILE), 'utf8'));
    if (data?.version === 2) return { ...emptyRuntime(), ...data };
  } catch {
    // A missing or damaged file starts empty: nothing in it is essential.
  }
  return emptyRuntime();
}

export function saveRuntime(root, runtime) {
  runtime.alerted = (runtime.alerted ?? []).slice(-50);
  writeAtomic(path.join(root, RUNTIME_FILE), JSON.stringify(runtime, null, 2) + '\n');
}

/** RF-OBS-01/02: flow metadata only, never file contents or secrets. */
export function logEvent(root, event, data = {}) {
  try {
    const file = path.join(root, EVENTS_FILE);
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), event, ...data }) + '\n');
  } catch {
    // Logging never breaks the flow.
  }
}

// Spec frontmatter --------------------------------------------------------------

const FRONT = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** `status` of a spec.md; a spec without frontmatter is a draft. */
export function specStatus(text) {
  const m = FRONT.exec(String(text ?? ''));
  const s = m && /^status:\s*([\w-]+)\s*$/m.exec(m[1]);
  return s && STATUSES.includes(s[1]) ? s[1] : 'draft';
}

/** The same text with `status` set, adding the frontmatter when missing. */
export function withStatus(text, status) {
  const src = String(text ?? '');
  const m = FRONT.exec(src);
  if (!m) return `---\nstatus: ${status}\n---\n\n${src}`;
  const body = /^status:.*$/m.test(m[1]) ? m[1].replace(/^status:.*$/m, `status: ${status}`) : `${m[1]}\nstatus: ${status}`;
  return `---\n${body}\n---\n${src.slice(m[0].length)}`;
}

/** The active spec and its tasks, read from the markdown files. */
export function readFlow(root, settings) {
  const spec = activeSpec(root, listSpecs(root, specRoots(settings)));
  const tasks = spec ? parseTasks(safeRead(path.join(root, spec.dir, 'tasks.md'))) : [];
  return { spec, tasks };
}

/**
 * The spec in progress: the most recent one that is not done.
 * @param {{ id: string, dir: string }[]} specs from listSpecs
 */
export function activeSpec(root, specs) {
  const open = specs
    .map((s) => ({ ...s, status: specStatus(safeRead(path.join(root, s.dir, 'spec.md'))) }))
    .filter((s) => s.status !== 'done');
  return open.sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }))[0] ?? null;
}

/** Records a stop in the spec (RF-GAT-08). */
export function approveStop(root, spec, stop) {
  const file = path.join(root, spec.dir, 'spec.md');
  const text = safeRead(file);
  if (text === null || !STOPS[stop]) return false;
  const order = STATUSES.indexOf(STOPS[stop]);
  if (STATUSES.indexOf(specStatus(text)) >= order) return true;
  writeFileSync(file, withStatus(text, STOPS[stop]));
  return true;
}

export function specExists(root, spec) {
  return Boolean(spec && existsSync(path.join(root, spec.dir, 'spec.md')));
}
