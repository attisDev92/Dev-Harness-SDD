// Specs and tasks as plain markdown (RF-SDD-04/05/06/12/14/15, RF-ORQ-01,
// RF-GAT-12, edge case 14). Dependency-free.

import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

export const SPEC_DIR_RE = /^([A-Z][A-Z0-9]{1,9})-(\d{3})-([a-z0-9][a-z0-9-]*)$/;

const cleanPath = (p) => String(p ?? '.').replace(/\\/g, '/').replace(/^\.\/?/, '').replace(/\/$/, '');

/**
 * RF-TOP-01/02: where new specs are created. By default specs/ at the root;
 * with `specs.location: per-repo` (multi-repo, workspace) each repo owns its specs/.
 */
export function specsDirFor(settings, componentId) {
  if (settings?.specs?.location !== 'per-repo' || !['multi-repo', 'workspace'].includes(settings?.topology)) return 'specs';
  const dir = cleanPath(settings.components?.[componentId]?.path);
  return dir ? `${dir}/specs` : 'specs';
}

/** Every folder that may hold specs, relative to the project root. */
export function specRoots(settings) {
  if (!['multi-repo', 'workspace'].includes(settings?.topology)) return ['specs'];
  // Also the folders of each repo, so specs created before `specs.location` existed keep being found.
  const perRepo = Object.values(settings.components ?? {}).map((c) => (cleanPath(c.path) ? `${cleanPath(c.path)}/specs` : 'specs'));
  return [...new Set(['specs', ...perRepo])];
}

/** Spec folders under the given roots, sorted, as { id, dir }. */
export function listSpecs(root, roots = ['specs']) {
  const out = [];
  for (const rel of roots) {
    const dir = path.join(root, rel);
    if (!existsSync(dir)) continue;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory() && SPEC_DIR_RE.test(e.name)) out.push({ id: e.name, dir: `${rel}/${e.name}` });
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * RF-TOP-04: finds the spec a reference points to: "API-004", "API-004-auth"
 * or "api#API-004" (component id or repo folder before the #).
 */
export function resolveSpecRef(root, settings, ref) {
  const [repo, idPart] = String(ref).includes('#') ? String(ref).split('#') : [null, String(ref)];
  let roots = specRoots(settings);
  if (repo) {
    const comp = settings.components?.[repo] ? repo : Object.keys(settings.components ?? {}).find((id) => cleanPath(settings.components[id].path) === cleanPath(repo));
    roots = comp ? [specsDirFor(settings, comp)] : [];
  }
  return listSpecs(root, roots).find((s) => s.id === idPart || s.id.startsWith(`${idPart}-`)) ?? null;
}

/** RF-TOP-04: `depends_on` references declared in a spec. */
export function specDependencies(text) {
  const out = new Set();
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const m = /^\|\s*(Depends on|Depende de)\s*\|\s*([^|]*)\|/i.exec(line) ?? /^\s*depends_on\s*:\s*(.*)$/i.exec(line);
    const value = m ? m[m.length - 1] : '';
    for (const ref of value.replace(/[`[\]]/g, '').split(/[,\s]+/)) {
      if (/^([\w./-]+#)?[A-Z][A-Z0-9]{1,9}-\d{3}\b/.test(ref)) out.add(ref);
    }
  }
  return [...out];
}

/** RF-SDD-04: next free three-digit number within `prefix`. */
export function nextSpecId(root, prefix, slug, roots = ['specs']) {
  const used = listSpecs(root, roots)
    .map((s) => SPEC_DIR_RE.exec(s.id))
    .filter((m) => m[1] === prefix)
    .map((m) => Number(m[2]));
  const n = (used.length ? Math.max(...used) : 0) + 1;
  return `${prefix}-${String(n).padStart(3, '0')}-${slug}`;
}

export function slugify(text) {
  return String(text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'feature';
}

/** Next ADR number in docs/decisions (ADR-NNNN-name.md). */
export function nextAdrFile(root, slug, base = 'docs/decisions') {
  const dir = path.join(root, base);
  const used = existsSync(dir)
    ? readdirSync(dir).map((f) => /^ADR-(\d{4})-/.exec(f)).filter(Boolean).map((m) => Number(m[1]))
    : [];
  const n = (used.length ? Math.max(...used) : 0) + 1;
  return `${base}/ADR-${String(n).padStart(4, '0')}-${slug}.md`;
}

// Tasks ----------------------------------------------------------------------

const FIELD_KEYS = {
  requirements: 'requirements', requisitos: 'requirements',
  component: 'component', componente: 'component',
  scope: 'scope', alcance: 'scope',
  'depends on': 'depends', 'depende de': 'depends',
  'done when': 'done', 'hecho cuando': 'done',
  story: 'story', historia: 'story',
};
const TASK_RE = /^(\s*)- \[( |x|X)\] (T\d+)\b\s*(.*)$/;

const list = (value) =>
  String(value ?? '')
    .replace(/`/g, '')
    .split(/[,;]\s*/)
    .map((s) => s.trim())
    .filter((s) => s && !/^(—|-|none|ninguna|ninguno|n\/a)$/i.test(s));

/**
 * Parses "- [ ] T3 Title · Requirements: RF-01 · Component: api · Scope: `src/**` · Depends on: T1 · Done when: …".
 * @returns {{ id: string, done: boolean, title: string, requirements: string[], component?: string, scope: string[], depends: string[], doneWhen?: string, story?: string, line: number }[]}
 */
export function parseTasks(text) {
  const tasks = [];
  String(text ?? '').replace(/\r\n?/g, '\n').split('\n').forEach((line, index) => {
    const m = TASK_RE.exec(line);
    if (!m) return;
    const [title, ...fields] = m[4].split(/\s+·\s+/);
    const task = { id: m[3], done: m[2] !== ' ', title: title.trim(), requirements: [], scope: [], depends: [], line: index };
    for (const field of fields) {
      const f = /^([^:]+):\s*(.*)$/.exec(field.trim());
      if (!f) continue;
      const key = FIELD_KEYS[f[1].trim().toLowerCase()];
      if (key === 'requirements') task.requirements = list(f[2]);
      else if (key === 'scope') task.scope = list(f[2]);
      else if (key === 'depends') task.depends = list(f[2]);
      else if (key === 'component') task.component = f[2].replace(/`/g, '').trim();
      else if (key === 'done') task.doneWhen = f[2].trim();
      else if (key === 'story') task.story = f[2].trim();
    }
    tasks.push(task);
  });
  return tasks;
}

/** Most subagents working at once, whatever their role: more cannot be followed and burn tokens. */
export const MAX_PARALLEL = 2;

/**
 * Tasks of different components run in parallel, at most MAX_PARALLEL at once;
 * a task waits only for its own dependencies (and for the task already running
 * in its component). Free tasks that do not fit go to `queued`.
 * @returns {{ ready: object[], queued: object[], waiting: { task: object, on: string[] }[] }}
 */
export function taskQueue(tasks, active = {}) {
  const done = new Set(tasks.filter((t) => t.done).map((t) => t.id));
  const busy = new Map(Object.values(active).map((t) => [t.component, t.id]));
  const free = Math.max(0, MAX_PARALLEL - Object.keys(active).length);
  const ready = [];
  const queued = [];
  const waiting = [];
  for (const task of tasks.filter((t) => !t.done && !active[t.id])) {
    const on = task.depends.filter((d) => !done.has(d));
    if (!on.length && busy.has(task.component)) on.push(busy.get(task.component));
    if (on.length) waiting.push({ task, on });
    else {
      (ready.length < free ? ready : queued).push(task);
      busy.set(task.component, task.id);
    }
  }
  return { ready, queued, waiting };
}

/** RF-ORQ-01: first pending task whose dependencies are all done. */
export function selectNextTask(tasks) {
  const done = new Set(tasks.filter((t) => t.done).map((t) => t.id));
  return tasks.find((t) => !t.done && t.depends.every((d) => done.has(d))) ?? null;
}

/** RF-GAT-12: ticks the checkbox of one task, leaving the rest untouched. */
export function markTaskDone(text, id) {
  const eol = String(text).includes('\r\n') ? '\r\n' : '\n';
  return String(text)
    .split(/\r?\n/)
    .map((line) => {
      const m = TASK_RE.exec(line);
      return m && m[3] === id ? line.replace('- [ ]', '- [x]') : line;
    })
    .join(eol);
}

/**
 * RF-SDD-12: only the component is required (it picks the role). Scope,
 * requirements and "Done when" are recommended: tasks that come up during the
 * work are added quickly and completed later.
 */
export function taskProblems(task, components) {
  const problems = [];
  if (!task.component) problems.push('noComponent');
  else if (!components[task.component]) problems.push('unknownComponent');
  return problems;
}

/** RF-SDD-19: tasks added while implementing. */
export const ADDED_RE = /añadida en implementación|anadida en implementacion|added during implementation/i;

// Specs ----------------------------------------------------------------------

const EARS = /\b(WHEN|IF|WHILE|WHERE|THE SYSTEM|CUANDO|SI|MIENTRAS|DONDE|EL SISTEMA)\b/;
const REQ_RE = /^\s*[-*]\s+\*\*((?:RF|RNF)-[A-Z0-9-]*\d+):?\*\*:?\s*(.*)$/;
const CLARIFY_RE = /\[(NEEDS CLARIFICATION|NECESITA ACLARACIÓN|NECESITA ACLARACION):/g;

/** Requirement IDs and texts of a spec (RF-SDD-05). */
export function parseRequirements(text) {
  const out = [];
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const m = REQ_RE.exec(line);
    if (m) out.push({ id: m[1], text: m[2], ears: EARS.test(m[2]) });
  }
  return out;
}

/** Checks of RF-SDD-05/06 a script can make. */
export function lintSpec(text) {
  const reqs = parseRequirements(text).filter((r) => r.id.startsWith('RF'));
  const seen = new Set();
  const problems = [];
  if (!reqs.length) problems.push({ code: 'noRequirements' });
  for (const r of reqs) {
    if (seen.has(r.id)) problems.push({ code: 'duplicateId', id: r.id });
    seen.add(r.id);
    if (!r.ears) problems.push({ code: 'notEars', id: r.id });
  }
  const clarifications = (String(text).match(CLARIFY_RE) ?? []).length;
  return { requirements: reqs.length, clarifications, problems };
}

const MANDATORY_PRINCIPLES = [
  /commit.*(OK|approv|aprob)|(OK|approv|aprob).*commit/i,
  /ADR/,
  /verification (failing|red)|verificación en rojo|with verification failing/i,
];

/** RF-SDD-01/02: 6–10 principles including the three mandatory ones. */
export function lintConstitution(text) {
  const principles = String(text ?? '').split(/\r?\n/).filter((l) => /^\s*\d+\.\s+\S/.test(l) && !/<(principle|principio)>/.test(l));
  const problems = [];
  if (principles.length < 6 || principles.length > 10) problems.push({ code: 'principleCount', count: principles.length });
  MANDATORY_PRINCIPLES.forEach((re, i) => {
    if (!principles.some((p) => re.test(p))) problems.push({ code: 'missingPrinciple', index: i + 1 });
  });
  return { principles: principles.length, problems };
}

/** RF-SDD-12: every task complete and ordered by existing dependencies. */
export function lintTasks(text, components) {
  const tasks = parseTasks(text);
  const ids = new Set(tasks.map((x) => x.id));
  const problems = [];
  if (!tasks.length) problems.push({ code: 'noTasks' });
  for (const task of tasks) {
    for (const code of taskProblems(task, components)) problems.push({ code, task: task.id });
    for (const dep of task.depends) if (!ids.has(dep)) problems.push({ code: 'unknownDependency', task: task.id, dep });
  }
  return { tasks: tasks.length, problems };
}
