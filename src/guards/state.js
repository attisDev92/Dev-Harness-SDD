// Flow state kept by the scripts, never by the model (RF-ORQ-08/09/12,
// RF-SDD-13, RF-GAT-10..14, RF-RET-04..06). Dependency-free.
//
// .harness/state/flow.json is the working copy. A summary with the same data
// is mirrored into a managed block of the active spec's progress.md, so the
// state can be rebuilt if .harness/state/ is deleted (edge case 13).

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';

export const FLOW_FILE = path.join('.harness', 'state', 'flow.json');
export const LOCK_FILE = path.join('.harness', 'state', 'session.lock');
export const EVENTS_FILE = path.join('.harness', 'logs', 'events.jsonl');
export const PHASES = ['spec', 'plan', 'tasks', 'implement', 'validate', 'done'];
const STATE_MARK = /<!-- harness-state: (\{.*?\}) -->/s;
const LOCK_TTL_MS = 30 * 60 * 1000;

export function emptyState() {
  return {
    version: 1,
    activeSpec: null,
    constitution: { approved: false },
    specs: {},
    task: null,
    gate: null,
    triage: null,
    granted: [],
    subagent: null,
    history: [],
  };
}

function writeAtomic(file, text) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

function safeRead(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/**
 * @returns {{ state: object, rebuilt: boolean }} `rebuilt` is true when the
 *   state came from progress.md because flow.json was missing or damaged.
 */
export function loadFlow(root, roots = ['specs']) {
  try {
    const data = JSON.parse(readFileSync(path.join(root, FLOW_FILE), 'utf8'));
    if (data?.version === 1) return { state: { ...emptyState(), ...data }, rebuilt: false };
  } catch {
    // Fall through to the rebuild.
  }
  const state = rebuildFromProgress(root, roots);
  return { state, rebuilt: Boolean(state.activeSpec) };
}

export function saveFlow(root, state, lang = 'es') {
  appendEvents(root, state);
  state.history = (state.history ?? []).slice(-200);
  writeAtomic(path.join(root, FLOW_FILE), JSON.stringify(state, null, 2) + '\n');
  if (state.activeSpec) mirrorToProgress(root, state, lang);
}

export function logEvent(state, event, data = {}) {
  state.seq = (state.seq ?? 0) + 1;
  const spec = state.specs?.[state.activeSpec];
  state.history = [...(state.history ?? []), {
    seq: state.seq,
    at: new Date().toISOString(),
    event,
    spec: state.activeSpec ?? null,
    phase: spec?.phase ?? null,
    task: state.task?.id ?? null,
    role: state.task?.role ?? null,
    ...data,
  }];
}

/**
 * RF-OBS-01: every flow event also goes to .harness/logs/events.jsonl.
 * RF-OBS-02: only flow metadata is logged, never file contents or secrets.
 */
function appendEvents(root, state) {
  const fresh = (state.history ?? []).filter((e) => (e.seq ?? 0) > (state.loggedSeq ?? 0));
  if (!fresh.length) return;
  const file = path.join(root, EVENTS_FILE);
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, fresh.map((e) => JSON.stringify(e)).join('\n') + '\n');
  state.loggedSeq = fresh[fresh.length - 1].seq;
}

/** Edge case 13: pick up the mirrored state of the most recently updated spec. */
export function rebuildFromProgress(root, roots = ['specs']) {
  const state = emptyState();
  const dirs = roots.flatMap((rel) => {
    const abs = path.join(root, rel);
    return existsSync(abs) ? readdirSync(abs, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => ({ id: d.name, rel: `${rel}/${d.name}` })) : [];
  });
  let latest = null;
  for (const dir of dirs) {
    const text = safeRead(path.join(root, dir.rel, 'progress.md'));
    const m = text && STATE_MARK.exec(text);
    if (!m) continue;
    try {
      const saved = JSON.parse(m[1]);
      if (!latest || String(saved.updated ?? '') > String(latest.updated ?? '')) latest = { ...saved, dir };
    } catch {
      // A damaged mirror is ignored.
    }
  }
  if (!latest) return state;
  state.activeSpec = latest.dir.id;
  state.constitution.approved = Boolean(latest.constitution);
  Object.assign(state.specs, latest.specs ?? {});
  state.specs[latest.dir.id] = { ...state.specs[latest.dir.id], dir: latest.dir.rel };
  state.task = latest.task ?? null;
  state.gate = latest.gate ?? null;
  state.triage = latest.triage ?? null;
  state.granted = latest.granted ?? [];
  return state;
}

const L = {
  en: { title: 'Harness status (generated; do not edit this block)', phase: 'Phase', approved: 'Approved', task: 'Current task', state: 'State', gate: 'Pending decision', none: '—', triage: 'triage', failing: 'verification failing', progress: 'in progress' },
  es: { title: 'Estado del harness (generado; no edites este bloque)', phase: 'Fase', approved: 'Aprobado', task: 'Tarea actual', state: 'Estado', gate: 'Decisión pendiente', none: '—', triage: 'triage', failing: 'verificación fallando', progress: 'en curso' },
};

/** Summary block of progress.md (RF-ORQ-08) with the machine-readable state. */
export function progressBlock(state, lang = 'en') {
  const t = L[lang] ?? L.en;
  const spec = state.specs[state.activeSpec] ?? {};
  const taskState = state.triage ? t.triage : state.task ? (state.task.verify?.status === 'fail' ? t.failing : t.progress) : t.none;
  const saved = {
    updated: new Date().toISOString(),
    constitution: state.constitution.approved,
    specs: { [state.activeSpec]: spec },
    task: state.task,
    gate: state.gate,
    triage: state.triage,
    granted: state.granted,
  };
  return [
    `<!-- harness-state: ${JSON.stringify(saved)} -->`,
    `**${t.title}**`,
    '',
    '| | |',
    '|---|---|',
    `| ${t.phase} | ${spec.phase ?? t.none} |`,
    `| ${t.approved} | ${(spec.approved ?? []).join(', ') || t.none} |`,
    `| ${t.task} | ${state.task ? `${state.task.id} (${state.task.component})` : t.none} |`,
    `| ${t.state} | ${taskState} |`,
    `| ${t.gate} | ${state.gate ? state.gate.kind : t.none} |`,
  ].join('\n');
}

/** Folder of a spec relative to the project root (RF-TOP-02). */
export function specDirOf(state, id) {
  return state.specs?.[id]?.dir ?? `specs/${id}`;
}

const BEGIN = '<!-- harness:begin -->';
const END = '<!-- harness:end -->';

function mirrorToProgress(root, state, lang) {
  const file = path.join(root, specDirOf(state, state.activeSpec), 'progress.md');
  if (!existsSync(path.dirname(file))) return;
  const text = safeRead(file) ?? '';
  const wrapped = `${BEGIN}\n${progressBlock(state, lang)}\n${END}`;
  const b = text.indexOf(BEGIN);
  const e = text.indexOf(END);
  const next = b !== -1 && e > b ? `${text.slice(0, b)}${wrapped}${text.slice(e + END.length)}` : `${wrapped}\n\n${text}`;
  writeAtomic(file, next.endsWith('\n') ? next : `${next}\n`);
}

/** The managed block of a progress.md, or null. */
export function progressBlockOf(text) {
  const b = text.indexOf(BEGIN);
  const e = text.indexOf(END);
  return b !== -1 && e > b ? text.slice(b, e + END.length) : null;
}

// Session lock (RF-ORQ-12, edge case 26) ------------------------------------

export function readLock(root) {
  try {
    return JSON.parse(readFileSync(path.join(root, LOCK_FILE), 'utf8'));
  } catch {
    return null;
  }
}

export function lockIsFresh(lock, now = Date.now()) {
  return Boolean(lock && now - Date.parse(lock.heartbeat ?? lock.started) < LOCK_TTL_MS);
}

/** Takes or refreshes the lock for `session`. Returns the holder if another live session has it. */
export function touchLock(root, session, now = new Date()) {
  const lock = readLock(root);
  if (lock && lock.session !== session && lockIsFresh(lock, now.getTime())) return { ok: false, holder: lock };
  const started = lock?.session === session ? lock.started : now.toISOString();
  writeAtomic(path.join(root, LOCK_FILE), JSON.stringify({ session, started, heartbeat: now.toISOString() }) + '\n');
  return { ok: true };
}

export function releaseLock(root, session) {
  const lock = readLock(root);
  if (lock && lock.session === session) {
    try {
      unlinkSync(path.join(root, LOCK_FILE));
    } catch {
      // Already gone.
    }
  }
}
