// Model tiers and concrete per-tool model equivalence (RF-ORQ-10, RF-ADP-05).
//
// Tiers:
//   orchestrator  main session coordinating the flow, interviews and stops
//   high          spec-reviewer, architect, reviewer, debugger
//   mid           frontend-dev, backend-dev, qa-tester
//   low           doc-writer and tasks tagged [mechanical] / [mecánica]

export const TIER_ORDER = Object.freeze(['orchestrator', 'high', 'mid', 'low']);

export const ROLE_TIERS = Object.freeze({
  orchestrator: 'orchestrator',
  'spec-reviewer': 'high',
  architect: 'high',
  'frontend-dev': 'mid',
  'backend-dev': 'mid',
  'qa-tester': 'mid',
  reviewer: 'high',
  debugger: 'high',
  'doc-writer': 'low',
});

/**
 * Default concrete models per tool, paired by capability equivalence:
 *   - Claude Code: Opus (orchestrator & high) · Sonnet (mid) · Haiku (low)
 *   - Antigravity: Gemini 4 Neon (orchestrator) · Gemini 4 Carbon High (high)
 *                  Gemini 4 Hydrogen Medium (mid) · Gemini 4 Hydrogen Low (low)
 *   - Codex / opencode: reference defaults for display and future adapters.
 */
export const DEFAULT_TOOL_MODELS = Object.freeze({
  'claude-code': Object.freeze({
    orchestrator: 'opus',
    high: 'opus',
    mid: 'sonnet',
    low: 'haiku',
  }),
  antigravity: Object.freeze({
    orchestrator: 'gemini-4-neon-high',
    high: 'gemini-4-carbon-high',
    mid: 'gemini-4-hydrogen-high',
    low: 'gemini-4-hydrogen-low',
  }),
  codex: Object.freeze({
    orchestrator: 'gpt-5-high',
    high: 'gpt-5-high',
    mid: 'gpt-5-codex',
    low: 'gpt-5-mini',
  }),
  opencode: Object.freeze({
    orchestrator: 'anthropic/claude-opus-4-6',
    high: 'anthropic/claude-opus-4-6',
    mid: 'anthropic/claude-sonnet-4-6',
    low: 'anthropic/claude-haiku-4-5',
  }),
});

/**
 * Maps a concrete Antigravity model name (or subagent alias) to:
 *   - agentModel: valid `.agents/agents/<role>.md` frontmatter tier (`pro` | `flash` | `inherit`)
 *   - invokeModel: valid `invoke_subagent` `Model` enum (`pro` | `flash` | `flash_lite` | `inherit`)
 */
export function antigravitySubagentTier(model, tier = 'mid') {
  const m = String(model ?? '').trim().toLowerCase();
  if (m === 'inherit') return { agentModel: 'inherit', invokeModel: 'inherit' };
  if (m === 'pro') return { agentModel: 'pro', invokeModel: 'pro' };
  if (m === 'flash') return { agentModel: 'flash', invokeModel: 'flash' };
  if (m === 'flash_lite' || m === 'flash-lite') return { agentModel: 'flash', invokeModel: 'flash_lite' };
  if (/neon|carbon|argon|opus|3\.1-pro|\bpro\b/.test(m)) return { agentModel: 'pro', invokeModel: 'pro' };
  if (/hydrogen-low|flash-low|\b(?:lite|haiku|mini)\b/.test(m)) return { agentModel: 'flash', invokeModel: 'flash_lite' };
  if (/hydrogen|flash|sonnet/.test(m)) return { agentModel: 'flash', invokeModel: 'flash' };
  if (tier === 'high' || tier === 'orchestrator') return { agentModel: 'pro', invokeModel: 'pro' };
  if (tier === 'low') return { agentModel: 'flash', invokeModel: 'flash_lite' };
  return { agentModel: 'flash', invokeModel: 'flash' };
}

export function roleTier(config, role) {
  return config?.roles?.[role]?.tier ?? ROLE_TIERS[role] ?? 'mid';
}

/** Concrete model for `role` (or `'orchestrator'`) in `tool`. Per-role override beats per-tier override. */
export function resolveRoleModel(config, tool, role, overrideTier) {
  const tier = overrideTier ?? roleTier(config, role);
  return config?.models?.[tool]?.[role]
    ?? config?.models?.[tool]?.[tier]
    ?? DEFAULT_TOOL_MODELS[tool]?.[tier]
    ?? DEFAULT_TOOL_MODELS['claude-code'][tier];
}

/** Resolved tier → concrete model map for `tool`. */
export function resolveTierModels(config, tool) {
  const defaults = DEFAULT_TOOL_MODELS[tool] ?? DEFAULT_TOOL_MODELS['claude-code'];
  const custom = config?.models?.[tool] ?? {};
  return {
    orchestrator: custom.orchestrator ?? defaults.orchestrator,
    high: custom.high ?? defaults.high,
    mid: custom.mid ?? defaults.mid,
    low: custom.low ?? defaults.low,
  };
}
