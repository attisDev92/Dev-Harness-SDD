// Schema of harness.config.yaml (RF-GEN-12). Validation returns every issue,
// each with the dotted path of the offending field, a code and parameters so
// the CLI can render it in the configured language.

export const TOOLS = ['claude-code', 'opencode', 'codex', 'antigravity'];
export const TOPOLOGIES = ['single', 'monorepo', 'multi-repo', 'workspace'];
export const DESIGN_SOURCES = ['none', 'tokens-in-code', 'penpot', 'figma'];
export const TRACKERS = ['linear', 'notion', 'github', 'jira'];
export const ROLES = ['spec-reviewer', 'architect', 'frontend-dev', 'backend-dev', 'qa-tester', 'reviewer', 'debugger', 'doc-writer'];
export const TIERS = ['high', 'mid', 'low'];
export const COMPONENT_KINDS = ['frontend', 'backend', 'db', 'other'];

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const LANG_CODE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/;
const ID_PREFIX = /^[A-Z][A-Z0-9]{1,9}$/;
const COMPONENT_ID = /^[a-z][a-z0-9-]*$/;

// Schema nodes -------------------------------------------------------------

const str = (opts = {}) => ({ type: 'string', ...opts });
const bool = () => ({ type: 'boolean' });
const int = (opts = {}) => ({ type: 'integer', ...opts });
const oneOf = (values) => ({ type: 'enum', values });
const arr = (items, opts = {}) => ({ type: 'array', items, ...opts });
const obj = (fields, required = []) => ({ type: 'object', fields, required });
const map = (values, opts = {}) => ({ type: 'map', values, ...opts });

export const schema = obj(
  {
    harness_version: str({ pattern: SEMVER, hint: 'x.y.z' }),
    install_mode: oneOf(['local', 'team']),
    cli: obj({ language: oneOf(['es', 'en']) }),
    tools: arr(oneOf(TOOLS), { minItems: 1, unique: true }),
    language: obj({
      code: str({ pattern: LANG_CODE, hint: 'en, es, pt-BR…' }),
      specs: oneOf(['es', 'en']),
      docs: oneOf(['es', 'en']),
      commits: str({ pattern: LANG_CODE, hint: 'en, es, pt-BR…' }),
      ui: str({ pattern: LANG_CODE, hint: 'en, es, pt-BR…' }),
    }),
    conventions: obj({
      commits: oneOf(['conventional', 'gitmoji', 'custom']),
      commits_note: str(),
      style: arr(str()),
      sources: arr(str()),
    }),
    topology: oneOf(TOPOLOGIES),
    specs: obj({ location: oneOf(['root', 'per-repo']), id_prefix: str({ pattern: ID_PREFIX, hint: 'SPEC, APP…' }) }),
    components: map(
      obj(
        {
          path: str({ minLength: 1 }),
          id_prefix: str({ pattern: ID_PREFIX, hint: 'API, WEB…' }),
          stack: str(),
          kind: oneOf(COMPONENT_KINDS),
          verify: obj({ lint: str(), typecheck: str(), test: str(), e2e: str() }),
        },
        ['path'],
      ),
      { minEntries: 1, keyPattern: COMPONENT_ID },
    ),
    design: obj({ source: oneOf(DESIGN_SOURCES), mcp_url: str({ pattern: /^https?:\/\/\S+$/, hint: 'https://…' }) }),
    // Any tracker: GitHub syncs from the CLI; the rest through the agent and
    // the tracker's MCP. `project` identifies the board, team or project there.
    tracker: obj({
      enabled: bool(),
      provider: str({ pattern: /^[a-z0-9][a-z0-9-]*$/, hint: 'github, linear, jira, asana, clickup…' }),
      repo: str({ pattern: /^[\w.-]+\/[\w.-]+$/, hint: 'owner/repo' }),
      project: str(),
    }),
    gates: obj({
      manual_test: oneOf(['task', 'story', 'spec', 'none']),
      docs: oneOf(['free', 'whitelist']),
      // per-story: the agent proposes the commit when a story closes (human-only is the pre-0.8 value, same behaviour).
      commits: oneOf(['per-story', 'human-only']),
      deps: oneOf(['ask']),
    }),
    retries: obj({ in_scope: int({ min: 0, max: 2 }), protected: int({ min: 0, max: 0 }) }),
    protected: map(arr(str({ minLength: 1 }))),
    docs_whitelist: arr(str({ minLength: 1 }), { unique: true }),
    artifacts: obj({ versioned: bool() }),
    git_hooks: obj({ enabled: bool() }),
    ci: obj({ provider: oneOf(['none', 'github']) }),
    roles: map(obj({ tier: oneOf(TIERS) }), { keys: ROLES }),
    models: map(obj({ high: str(), mid: str(), low: str() }), { keys: TOOLS }),
  },
  ['harness_version', 'tools', 'topology', 'components'],
);

// Validation ---------------------------------------------------------------

/**
 * @typedef {{ path: (string|number)[], code: string, params?: Record<string, unknown> }} Issue
 */

/** @returns {Issue[]} */
export function validateConfig(config) {
  const issues = [];
  check(schema, config, [], issues);
  if (issues.length === 0) crossChecks(config, issues);
  return issues;
}

function typeOf(value) {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function check(node, value, path, issues) {
  const actual = typeOf(value);
  const expect = (type) => {
    if (actual === type || (type === 'object' && actual === 'object')) return true;
    issues.push({ path, code: 'type', params: { expected: type, actual } });
    return false;
  };

  switch (node.type) {
    case 'string':
      if (!expect('string')) return;
      if (node.minLength && value.length < node.minLength) issues.push({ path, code: 'empty' });
      else if (node.pattern && !node.pattern.test(value)) issues.push({ path, code: 'pattern', params: { value, hint: node.hint ?? String(node.pattern) } });
      return;
    case 'boolean':
      expect('boolean');
      return;
    case 'integer':
      if (!expect('integer')) return;
      if (node.min !== undefined && value < node.min) issues.push({ path, code: 'min', params: { min: node.min, value } });
      if (node.max !== undefined && value > node.max) issues.push({ path, code: 'max', params: { max: node.max, value } });
      return;
    case 'enum':
      if (!node.values.includes(value)) issues.push({ path, code: 'enum', params: { value, allowed: node.values } });
      return;
    case 'array': {
      if (!expect('array')) return;
      if (node.minItems && value.length < node.minItems) issues.push({ path, code: 'minItems', params: { min: node.minItems } });
      value.forEach((item, i) => check(node.items, item, [...path, i], issues));
      if (node.unique) {
        const seen = new Set();
        value.forEach((item, i) => {
          const key = JSON.stringify(item);
          if (seen.has(key)) issues.push({ path: [...path, i], code: 'duplicate', params: { value: item } });
          seen.add(key);
        });
      }
      return;
    }
    case 'object': {
      if (!expect('object')) return;
      for (const key of node.required) {
        if (value[key] === undefined || value[key] === null) issues.push({ path: [...path, key], code: 'required' });
      }
      for (const [key, item] of Object.entries(value)) {
        if (!Object.hasOwn(node.fields, key)) {
          issues.push({ path: [...path, key], code: 'unknownKey', params: { allowed: Object.keys(node.fields) } });
          continue;
        }
        if (item === undefined || (item === null && !node.required.includes(key))) continue;
        check(node.fields[key], item, [...path, key], issues);
      }
      return;
    }
    case 'map': {
      if (!expect('object')) return;
      const entries = Object.entries(value);
      if (node.minEntries && entries.length < node.minEntries) issues.push({ path, code: 'minItems', params: { min: node.minEntries } });
      for (const [key, item] of entries) {
        if (node.keys && !node.keys.includes(key)) {
          issues.push({ path: [...path, key], code: 'unknownKey', params: { allowed: node.keys } });
          continue;
        }
        if (node.keyPattern && !node.keyPattern.test(key)) {
          issues.push({ path: [...path, key], code: 'keyPattern', params: { value: key, hint: 'web, api, db…' } });
          continue;
        }
        check(node.values, item, [...path, key], issues);
      }
      return;
    }
    default:
      throw new Error(`unknown schema node ${node.type}`);
  }
}

function normalizeComponentPath(p) {
  const parts = [];
  for (const seg of p.replace(/\\/g, '/').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

function crossChecks(config, issues) {
  if (config.tracker?.enabled === true && !config.tracker.provider) {
    issues.push({ path: ['tracker', 'provider'], code: 'requiredIf', params: { field: 'tracker.enabled', value: true } });
  }

  // Edge case 5: two components with the same or overlapping paths. Nesting is
  // only allowed across repositories (multi-repo, workspace).
  const separateRepos = config.topology === 'multi-repo' || config.topology === 'workspace';
  const comps = Object.entries(config.components ?? {}).map(([id, c]) => ({ id, path: normalizeComponentPath(c.path) }));
  for (let i = 0; i < comps.length; i += 1) {
    for (let j = i + 1; j < comps.length; j += 1) {
      const a = comps[i].path;
      const b = comps[j].path;
      const nested = a === '' || b === '' || b.startsWith(a + '/') || a.startsWith(b + '/');
      const overlap = a === b || (nested && !separateRepos);
      if (overlap) {
        issues.push({ path: ['components', comps[j].id, 'path'], code: 'overlap', params: { other: comps[i].id } });
      }
    }
  }

  if (config.specs?.location === 'per-repo' && !separateRepos) {
    issues.push({ path: ['specs', 'location'], code: 'requiredIf', params: { field: 'topology', value: 'multi-repo | workspace' } });
  }

  const prefixes = new Map();
  for (const [id, c] of Object.entries(config.components ?? {})) {
    if (!c.id_prefix) continue;
    if (prefixes.has(c.id_prefix)) {
      issues.push({ path: ['components', id, 'id_prefix'], code: 'duplicate', params: { value: c.id_prefix, other: prefixes.get(c.id_prefix) } });
    }
    prefixes.set(c.id_prefix, id);
  }

  for (const tool of Object.keys(config.models ?? {})) {
    if (!config.tools.includes(tool)) issues.push({ path: ['models', tool], code: 'toolNotEnabled', params: { value: tool } });
  }
}
