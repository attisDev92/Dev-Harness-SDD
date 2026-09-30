// Project discovery and guard settings (dependency-free).
//
// The guards never parse YAML: `sdd-harness sync` writes the subset they need to
// .harness/guards.json. Without that file the defaults below apply.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const CONFIG_FILE = 'harness.config.yaml';
export const GUARDS_FILE = path.join('.harness', 'guards.json');

/** RF-MD-02 default documentation whitelist. */
export const DEFAULT_DOCS_WHITELIST = Object.freeze([
  'README.md',
  'CHANGELOG.md',
  'AGENTS.md',
  'specs/*/{spec,plan,tasks,progress}.md',
  'docs/constitution.md',
  'docs/decisions/ADR-*.md',
  'docs/architecture/*.md',
  'docs/lessons.md',
]);

export const DEFAULT_SPEC_PREFIX = 'SPEC';

export const DEFAULT_RETRIES = Object.freeze({ in_scope: 2, protected: 0 });

/** Nearest ancestor of `start` that holds harness.config.yaml, or null. */
export function findProjectRoot(start = process.cwd()) {
  let dir = path.resolve(start);
  for (;;) {
    if (existsSync(path.join(dir, CONFIG_FILE))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Guard settings for `root`, falling back to defaults field by field. */
export function loadGuardSettings(root) {
  let data = {};
  if (root) {
    try {
      data = JSON.parse(readFileSync(path.join(root, GUARDS_FILE), 'utf8'));
    } catch {
      data = {};
    }
  }
  return {
    language: data.language === 'es' ? 'es' : data.language === 'en' ? 'en' : undefined,
    docsWhitelist: Array.isArray(data.docs_whitelist) ? data.docs_whitelist : [...DEFAULT_DOCS_WHITELIST],
    protected: data.protected && typeof data.protected === 'object' ? data.protected : {},
    specs: {
      location: data.specs?.location === 'per-repo' ? 'per-repo' : 'root',
      idPrefix: typeof data.specs?.id_prefix === 'string' ? data.specs.id_prefix : DEFAULT_SPEC_PREFIX,
    },
    managedBlocks: Array.isArray(data.managed_blocks) ? data.managed_blocks : [],
    retries: { ...DEFAULT_RETRIES, ...(data.retries ?? {}) },
    components: data.components && typeof data.components === 'object' ? data.components : {},
    roles: data.roles && typeof data.roles === 'object' ? data.roles : {},
    manualTest: ['task', 'story', 'spec'].includes(data.manual_test) ? data.manual_test : 'task',
    specsLanguage: data.specs_language === 'es' ? 'es' : 'en',
    docsLanguage: data.docs_language === 'es' ? 'es' : 'en',
    commits: data.commits ?? { convention: 'conventional' },
    topology: data.topology ?? 'single',
    tracker: data.tracker ?? null,
  };
}
