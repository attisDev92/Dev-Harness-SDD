// Generation pipeline: core → tool adapters → git hooks and CI → finalize.

import { generateCore, finalize } from './core.js';
import { generateGitHooks, generateCi } from './githooks.js';
import { ownSkills } from './skills.js';
import * as claudeCode from './adapters/claude-code.js';
import * as antigravity from './adapters/antigravity.js';

/**
 * Tool adapter interface (RF-ADP-06). A new tool only needs a module with:
 *
 *   export const id = '<tool id in harness.config.yaml>';
 *   export const RULES = [...];   // rules its hooks enforce deterministically
 *   export function generate(config, { tracked, skills }) {
 *     return { entries, notices };
 *   }
 *
 * Entries use the engine kinds (file, block, json) and carry `tool: id`;
 * the entry that wires the guards carries `enforces: RULES`, which is what
 * `sdd-harness doctor` reports as the real enforcement level. Register the module
 * below; the core does not change.
 * @typedef {{ id: string, RULES: string[], generate: (config: object, ctx: { tracked: Set<string>, skills: Record<string, string> }) => { entries: object[], notices: object[] } }} Adapter
 */
/** @type {Record<string, Adapter>} */
export const ADAPTERS = { [claudeCode.id]: claudeCode, [antigravity.id]: antigravity };

/**
 * @param {object} config
 * @param {{ tracked: Set<string>, excludePath: string | null, read: (p: string) => string | null, hooksManager?: object | null }} env
 * @returns {{ entries: object[], notices: object[], gitConfig: Record<string, string> }}
 */
export function generateProject(config, env) {
  const skills = ownSkills(config);
  const core = generateCore(config, { ...env, skills });
  const acc = { entries: [...core.entries], notices: [...core.notices], agentsPath: core.agentsPath };
  for (const tool of config.tools ?? []) {
    const adapter = ADAPTERS[tool];
    if (!adapter) continue;
    const r = adapter.generate(config, { tracked: env.tracked, skills, installedSkills: env.installedSkills ?? [] });
    acc.entries.push(...r.entries);
    acc.notices.push(...r.notices);
  }
  const repos = env.repos ?? (env.excludePath ? [{ dir: '', hooksManager: env.hooksManager ?? null }] : []);
  const hooks = generateGitHooks(config, { repos, tracked: env.tracked });
  const ci = generateCi(config);
  acc.entries.push(...hooks.entries, ...ci.entries);
  acc.notices.push(...hooks.notices, ...ci.notices);
  const done = finalize(config, env, acc);
  return { entries: done.entries, notices: done.notices, gitConfig: hooks.gitConfig };
}
