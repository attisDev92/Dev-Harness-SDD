// What an agent may write, and when (RF-GAT-06/07/08/09, RF-MD-01,
// RF-SDD-13/16/18, RF-RET-02/05, RF-DOM-01, RF-GAT-11). Dependency-free.
//
// Verdicts: allow, ask (the tool asks the user) or block (with a reason the
// agent reads). The same rules apply to writes made through the shell.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { matchesAny, globToRegExp } from './glob.js';
import { checkDocWrite } from './docs-guard.js';
import { progressBlockOf } from './state.js';

const TEST_FILE = ['**/*.test.*', '**/*.spec.*', '**/tests/**', '**/test/**', '**/__tests__/**', '**/e2e/**'];
const DEP_SECTIONS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies', 'bundledDependencies', 'overrides', 'resolutions'];

const posix = (p) => p.split(path.sep).join('/');
const allow = { decision: 'allow' };
const block = (kind, match, extra = {}) => ({ decision: 'block', kind, match, ...extra });

/** Component that owns `rel`, the most specific path first. */
export function componentOf(rel, components) {
  let best = null;
  for (const [id, c] of Object.entries(components ?? {})) {
    const dir = String(c.path).replace(/\\/g, '/').replace(/^\.\/?/, '').replace(/\/$/, '');
    if (dir === '' || rel === dir || rel.startsWith(`${dir}/`)) {
      if (!best || dir.length > best.dir.length) best = { id, dir, ...c };
    }
  }
  return best;
}

function withinComponent(rel, comp) {
  return comp.dir ? rel.slice(comp.dir.length + 1) : rel;
}

/** New content of the file after a Write, Edit or MultiEdit. */
export function contentAfter(input, current) {
  if (typeof input.content === 'string') return input.content;
  const cur = current ?? '';
  const apply = (text, e) => (e.replace_all ? text.split(e.old_string).join(e.new_string) : text.replace(e.old_string, e.new_string));
  if (Array.isArray(input.edits)) return input.edits.reduce(apply, cur);
  if (typeof input.old_string === 'string') return apply(cur, input);
  return null;
}

function depsChanged(before, after) {
  try {
    const a = JSON.parse(before || '{}');
    const b = JSON.parse(after || '{}');
    return DEP_SECTIONS.some((k) => JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null));
  } catch {
    return true;
  }
}

function zoneHits(rel, zones) {
  const hits = [];
  for (const [zone, globs] of Object.entries(zones ?? {})) {
    for (const glob of globs ?? []) {
      const [file, section] = String(glob).split('#');
      // `rel/` also covers commands that act on a whole directory (rm -rf migrations).
      if (globToRegExp(file).test(rel) || globToRegExp(file).test(`${rel}/`)) hits.push({ zone, section });
    }
  }
  return hits;
}

/**
 * @param {{ root: string, file: string, settings: object, state: object, input?: object, via?: 'tool' | 'shell' }} req
 */
export function checkWrite({ root, file, settings, state, input = {}, via = 'tool' }) {
  const abs = path.resolve(root, file);
  const rel = posix(path.relative(root, abs));
  if (rel.startsWith('..') || path.isAbsolute(rel)) return allow;
  const exists = existsSync(abs);
  const current = exists ? safeRead(abs) : null;
  const after = via === 'tool' ? contentAfter(input, current) : null;
  const zones = settings.protected ?? {};

  // RF-GAT-09 / edge case 12: the harness itself.
  if (matchesAny(rel, (zones.harness ?? []).map((g) => g.split('#')[0]))) return block('harnessFile', rel);

  // RF-MD-01: documentation whitelist.
  const doc = checkDocWrite({ file: abs, root, whitelist: settings.docsWhitelist, exists: () => exists });
  if (doc.decision === 'block') return doc;

  // The status block of progress.md belongs to the scripts.
  if (/(^|\/)specs\/[^/]+\/progress\.md$/.test(rel) && current) {
    const before = progressBlockOf(current);
    if (via === 'shell' || (before && progressBlockOf(after ?? '') !== before)) return block('progressBlock', rel);
  }

  // RF-SDD-13/18: phase order of the spec files.
  const specFile = /(?:^|\/)specs\/([^/]+)\/(spec|plan|tasks)\.md$/.exec(rel);
  if (specFile) {
    const spec = state.specs?.[specFile[1]] ?? { phase: 'spec', approved: [] };
    const approved = spec.approved ?? [];
    if (specFile[2] === 'spec' && approved.includes('spec') && !spec.change) return block('specApproved', rel);
    if (specFile[2] === 'plan' && !approved.includes('spec')) return block('needsApproval', rel, { phase: 'spec' });
    if (specFile[2] === 'tasks' && !approved.includes('plan')) return block('needsApproval', rel, { phase: 'plan' });
    if (specFile[2] === 'tasks' && approved.includes('tasks') && !spec.change) return block('tasksApproved', rel);
  }
  if (rel === 'docs/constitution.md' && state.constitution?.approved) return block('constitutionApproved', rel);

  // RF-GAT-06/07/08: protected zones.
  const granted = new Set(state.granted ?? []);
  for (const hit of zoneHits(rel, zones)) {
    if (hit.zone === 'harness' || granted.has(rel)) continue;
    if (hit.zone === 'deps') {
      if (hit.section && /package\.json$/.test(rel) && after !== null && !depsChanged(current, after)) continue;
      return { decision: 'ask', kind: 'depsEdit', match: rel };
    }
    return block('protectedZone', rel, { zone: hit.zone });
  }

  // Code: one task at a time, inside its scope (RF-ORQ-02, RF-RET-02/05, RF-GAT-11).
  const comp = componentOf(rel, settings.components);
  // Specs and docs are artifacts, not code, in whatever repository they live (RF-TOP-02).
  if (!comp || /(^|\/)(specs|docs)\//.test(rel)) return allow;
  if (state.triage) return block('triageNoCode', rel);
  if (state.gate) return block('gatePending', rel, { gate: state.gate.kind });
  if (state.activeSpec && state.specs?.[state.activeSpec]?.change) return block('changePending', rel);
  if (!state.task) return block('noTask', rel);
  if (state.task.component !== comp.id) return block('otherComponent', rel, { component: comp.id, task: state.task.id });
  if (granted.has(rel)) return allow;
  const inner = withinComponent(rel, comp);
  if (matchesAny(rel, state.task.scope ?? []) || matchesAny(inner, state.task.scope ?? []) || matchesAny(inner, TEST_FILE)) return allow;
  return block('outOfScope', rel, { task: state.task.id, scope: state.task.scope });
}

function safeRead(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}
