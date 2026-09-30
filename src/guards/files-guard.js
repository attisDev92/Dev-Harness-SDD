// What an agent writes, and what the harness says about it (RF-GAT-06/07/09,
// RF-MD-01, RF-ORQ-13). Dependency-free.
//
// Verdicts: allow, warn (an alert, once per spec; the work goes on) or block
// (only the harness itself and the generated block of AGENTS.md/CLAUDE.md).

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { matchesAny, globToRegExp } from './glob.js';
import { checkDocWrite } from './docs-guard.js';

const TEST_FILE = ['**/*.test.*', '**/*.spec.*', '**/tests/**', '**/test/**', '**/__tests__/**', '**/e2e/**'];
const DEP_SECTIONS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies', 'bundledDependencies', 'overrides', 'resolutions'];
const BEGIN = '<!-- harness:begin -->';
const END = '<!-- harness:end -->';

const posix = (p) => p.split(path.sep).join('/');
const allow = { decision: 'allow' };
const block = (kind, match, extra = {}) => ({ decision: 'block', kind, match, ...extra });
const warn = (kind, match, extra = {}) => ({ decision: 'warn', kind, match, ...extra });

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

/** New content of the file after a Write, Edit or MultiEdit. */
export function contentAfter(input, current) {
  if (typeof input.content === 'string') return input.content;
  const cur = current ?? '';
  const apply = (text, e) => (e.replace_all ? text.split(e.old_string).join(e.new_string) : text.replace(e.old_string, e.new_string));
  if (Array.isArray(input.edits)) return input.edits.reduce(apply, cur);
  if (typeof input.old_string === 'string') return apply(cur, input);
  return null;
}

/** The managed block of a file, or null. */
export function managedBlockOf(text) {
  const t = String(text ?? '');
  const b = t.indexOf(BEGIN);
  const e = t.indexOf(END);
  return b !== -1 && e > b ? t.slice(b, e + END.length) : null;
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
      if (globToRegExp(file).test(rel) || globToRegExp(file).test(`${rel}/`)) hits.push({ zone, section });
    }
  }
  return hits;
}

/**
 * @param {{ root: string, file: string, settings: object, flow?: { spec: { id: string, status: string } | null, tasks: object[] }, input?: object }} req
 *   `flow` is read from the markdown files by the caller (state.js, tasks.js).
 */
export function checkWrite({ root, file, settings, flow = { spec: null, tasks: [] }, input = {} }) {
  const abs = path.resolve(root, file);
  const rel = posix(path.relative(root, abs));
  if (rel.startsWith('..') || path.isAbsolute(rel)) return allow;
  const exists = existsSync(abs);
  const current = exists ? safeRead(abs) : null;
  const after = contentAfter(input, current);
  const zones = settings.protected ?? {};

  // RF-GAT-09: .harness/ and generated files are the harness's own. Its config
  // is the user's: the tool asks natively and the hook syncs after the edit.
  if (rel === 'harness.config.yaml') return allow;
  if (matchesAny(rel, (zones.harness ?? []).map((g) => g.split('#')[0]))) return block('harnessFile', rel);

  // AGENTS.md and CLAUDE.md: the agent may write outside the harness block, never inside it.
  if (current && (settings.managedBlocks ?? []).includes(rel)) {
    const before = managedBlockOf(current);
    if (before && managedBlockOf(after ?? '') !== before) return block('contextBlock', rel);
  }

  // RF-MD-01: documentation whitelist, only when the user chose it.
  const doc = checkDocWrite({ file: abs, root, whitelist: settings.docsMode === 'whitelist' ? settings.docsWhitelist : null, exists: () => exists });
  if (doc.decision === 'block') return { ...doc, allowed: settings.docsWhitelist };

  // A plan or a task list written before its stop was answered.
  const specFile = /(?:^|\/)specs\/([^/]+)\/(plan|tasks)\.md$/.exec(rel);
  if (specFile && !exists && flow.spec?.id === specFile[1] && flow.spec.status === 'draft') {
    return warn('needsApproval', rel, { phase: 'spec' });
  }

  // RF-GAT-06/07: protected zones raise an alert; they never stop the work.
  for (const hit of zoneHits(rel, zones)) {
    if (hit.zone === 'tooling') return allow;
    if (hit.zone === 'harness') continue;
    if (hit.zone === 'deps') {
      if (hit.section && /package\.json$/.test(rel) && after !== null && !depsChanged(current, after)) continue;
      return warn('depsEdit', rel);
    }
    return warn('protectedZone', rel, { zone: hit.zone });
  }

  // RF-ORQ-13: code without a pending task, or outside its scope, is an alert.
  const comp = componentOf(rel, settings.components);
  if (!comp || /(^|\/)(specs|docs)\//.test(rel) || /\.(md|mdx)$/i.test(rel)) return allow;
  const open = (flow.tasks ?? []).filter((x) => !x.done && x.component === comp.id);
  if (flow.spec?.status !== 'plan-approved' || !open.length) return warn('noTask', rel, { component: comp.id });
  const inner = comp.dir ? rel.slice(comp.dir.length + 1) : rel;
  const scope = open.flatMap((x) => x.scope ?? []);
  // Tasks without a scope cover their whole component.
  if (open.some((x) => !(x.scope ?? []).length) || matchesAny(rel, scope) || matchesAny(inner, scope) || matchesAny(inner, TEST_FILE)) return allow;
  return warn('outOfScope', rel, { task: open.map((x) => x.id).join(', '), scope });
}

function safeRead(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}
