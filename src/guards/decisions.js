// Pending decisions that belong to the user, read from the files of the spec
// in progress (never guessed): clarifications left in spec.md, ADR drafts
// still "Proposed", tasks added during implementation and the alerts the
// guards raised for this spec. `gates.decisions` decides what the agent does
// with them: tell them in the summary, or interview the user. Dependency-free.

import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { safeRead } from './state.js';
import { ADDED_RE } from './tasks.js';

const CLARIFY_RE = /\[(?:NEEDS CLARIFICATION|NECESITA ACLARACI[ÓO]N):\s*([^\]]*)\]/gi;
const ADR_STATUS_RE = /\|\s*(?:Status|Estado)\s*\|\s*(?:Proposed|Propuesto)\s*\|/i;
const ADR_TITLE_RE = /^#\s+(.+)$/m;
/** Alert kinds that leave a decision to the user (files-guard verdicts). */
const ALERT_KINDS = {
  protectedZone: (target) => `Zona protegida "${target}" tocada: la decisión debe quedar en un ADR o confirmarla el usuario`,
  depsEdit: (target) => `Dependencias o lockfile cambiados (${target}): el usuario debe confirmarlo`,
  outOfScope: (target) => `Cambios fuera del alcance de ${target}: confirmar o añadir una tarea`,
  noTask: (target) => `Código del componente "${target}" sin tarea: confirmar o añadir una tarea`,
};

/**
 * @param {string} root
 * @param {object} settings loadGuardSettings
 * @param {{ spec: { id: string, dir: string } | null, tasks: object[] }} flow
 * @param {{ alerted?: string[], decided?: string[] }} runtime
 * @returns {{ kind: 'clarification' | 'adr' | 'added' | 'alert', key: string, text: string, file?: string }[]}
 */
export function pendingDecisions(root, settings, flow, runtime = {}) {
  const out = [];
  const spec = flow.spec;
  if (!spec) return out;
  const shortId = spec.id.split('-').slice(0, 2).join('-');

  // 1. Gaps the spec interview left open. Resolved by answering them in spec.md.
  const specFile = `${spec.dir}/spec.md`;
  const specText = safeRead(path.join(root, spec.dir, 'spec.md')) ?? '';
  let n = 0;
  for (const m of specText.matchAll(CLARIFY_RE)) {
    const text = m[1].trim();
    if (/^<[^>]*>$/.test(text)) continue; // untouched template placeholder
    n += 1;
    out.push({ kind: 'clarification', key: `clarification:${n}`, text: text || '(sin pregunta)', file: specFile });
  }

  // 2. ADR drafts of this spec still waiting for a decision. Resolved by setting their status.
  const specRepo = path.posix.dirname(path.posix.dirname(spec.dir));
  const adrDir = specRepo === '.' ? 'docs/decisions' : `${specRepo}/docs/decisions`;
  if (existsSync(path.join(root, adrDir))) {
    for (const name of readdirSync(path.join(root, adrDir)).filter((f) => /^ADR-\d{4}-.*\.md$/.test(f)).sort()) {
      const file = `${adrDir}/${name}`;
      const text = safeRead(path.join(root, file)) ?? '';
      if (!ADR_STATUS_RE.test(text) || !text.includes(shortId)) continue;
      out.push({ kind: 'adr', key: `adr:${name}`, text: ADR_TITLE_RE.exec(text)?.[1]?.trim() ?? name, file });
    }
  }

  // 3. Work the agent added on its own. Resolved when the user confirms it (or it is done).
  for (const task of flow.tasks ?? []) {
    if (task.done || !ADDED_RE.test(task.title)) continue;
    out.push({ kind: 'added', key: `added:${task.id}`, text: `${task.id} ${task.title}`, file: `${spec.dir}/tasks.md` });
  }

  // 4. Alerts the guards raised for this spec. Resolved with `sdd.js decisions --resolve <key>`.
  const decided = new Set(runtime.decided ?? []);
  for (const key of runtime.alerted ?? []) {
    const [kind, target, specId] = key.split(':');
    if (specId !== spec.id || !ALERT_KINDS[kind] || decided.has(key)) continue;
    out.push({ kind: 'alert', key, text: ALERT_KINDS[kind](target) });
  }
  return out;
}
