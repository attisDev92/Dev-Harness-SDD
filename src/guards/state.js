// Flow state (RF-SDD-18, RF-ORQ-09). Dependency-free.
//
// What matters is visible in the project: the `status` in the frontmatter of
// each spec.md and the checkboxes of tasks.md. .harness/state/runtime.json only
// keeps ephemeral data that never stops the work: the pending stop, the last
// verification per component, alerts already shown and running subagents.

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { EXTERNAL_DEP_RE, listSpecs, parseTasks, specRoots } from './tasks.js';

export const RUNTIME_FILE = path.join('.harness', 'state', 'runtime.json');
export const EVENTS_FILE = path.join('.harness', 'logs', 'events.jsonl');
export const STATUSES = ['draft', 'spec-approved', 'plan-approved', 'done'];
/** The two stops of the flow and the status each one leads to (RF-SDD-13). */
export const STOPS = { spec: 'spec-approved', plan: 'plan-approved' };

export function emptyRuntime() {
  return { version: 2, pending: null, verify: {}, alerted: [], subagents: {}, focus: null };
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

/**
 * The spec in progress and its tasks, read from the markdown files.
 * `spec` picks one explicitly (--spec); otherwise the focus set with
 * `sdd.js focus` (runtime.json), otherwise activeSpec's preference.
 * Also: every open spec with its status (`specs`), the open tasks of every
 * plan-approved spec (`open`, several specs may be implemented at once) and
 * `externalDone(ref)` for dependencies on tasks of other specs.
 */
export function readFlow(root, settings, { spec: ref, focus } = {}) {
  const all = listSpecs(root, specRoots(settings)).map((s) => ({ ...s, status: specStatus(safeRead(path.join(root, s.dir, 'spec.md'))) }));
  const tasksOf = memo((s) => parseTasks(safeRead(path.join(root, s.dir, 'tasks.md'))));
  const wanted = ref ?? focus ?? loadRuntime(root).focus ?? null;
  const spec = (wanted && findSpec(all, wanted, { includeDone: Boolean(ref) })) || activeSpec(root, all, tasksOf);
  const tasks = spec ? tasksOf(spec) : [];
  const implementing = all.filter((s) => s.status === 'plan-approved');
  const open = implementing.flatMap((s) => tasksOf(s).filter((x) => !x.done).map((x) => ({ ...x, spec: s.id })));
  const externalDone = (dep) => {
    const m = EXTERNAL_DEP_RE.exec(dep);
    const other = m && findSpec(all, m[1], { includeDone: true });
    if (!other) return false;
    if (other.status === 'done') return true;
    return tasksOf(other).some((x) => x.id === m[2] && x.done);
  };
  return { spec, tasks, specs: all.filter((s) => s.status !== 'done'), implementing, open, externalDone };
}

function memo(fn) {
  const cache = new Map();
  return (s) => {
    if (!cache.has(s.id)) cache.set(s.id, fn(s));
    return cache.get(s.id);
  };
}

/** A spec by its full id or its short id ("SPEC-002" → "SPEC-002-name"). */
export function findSpec(specs, ref, { includeDone = false } = {}) {
  const r = String(ref ?? '').trim();
  if (!r) return null;
  const s = specs.find((x) => x.id === r) ?? specs.find((x) => x.id.startsWith(`${r}-`));
  return s && (includeDone || s.status !== 'done') ? s : null;
}

/**
 * The spec in progress when none is chosen: a plan-approved spec with work
 * under way (some tasks done, some open) wins over a newer one that has not
 * started, so creating the next spec does not take the focus away from the
 * one being built. Otherwise, the most recent one that is not done.
 * @param {{ id: string, dir: string, status?: string }[]} specs from listSpecs
 */
export function activeSpec(root, specs, tasksOf = (s) => parseTasks(safeRead(path.join(root, s.dir, 'tasks.md')))) {
  const open = specs
    .map((s) => ({ ...s, status: s.status ?? specStatus(safeRead(path.join(root, s.dir, 'spec.md'))) }))
    .filter((s) => s.status !== 'done')
    .sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }));
  const underWay = open.find((s) => {
    if (s.status !== 'plan-approved') return false;
    const tasks = tasksOf(s);
    return tasks.some((x) => x.done) && tasks.some((x) => !x.done);
  });
  return underWay ?? open[0] ?? null;
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
