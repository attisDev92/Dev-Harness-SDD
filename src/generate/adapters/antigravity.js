// Google Antigravity adapter (RF-ADP-01..06, RF-AGH-*, RF-AGN-*).
//
// Generates, in Antigravity's native .agents/ customization layout (App 2.0, CLI `agy`, IDE):
//   .agents/rules/sdd-harness.md        always-on rule (≤ 24 KB) with model tiers & flow guards
//   .agents/rules/component-<id>.md     glob-triggered rules for sub-directory components
//   .agents/agents/sdd-orchestrator.md  selectable primary orchestrator agent (Gemini 4 Neon)
//   .agents/agents/<role>.md            custom subagents with native tools, model tier & skills
//   .agents/skills/<name>/SKILL.md      canonical skills + /sdd-<cmd> slash-command skills
//   .agents/mcp_config.json             design-source MCP server (Figma / Penpot) when enabled
//   .agents/hooks.json                  lifecycle guards (grouped Pre/PostToolUse + flat events)

import { neededRoles, componentContext } from '../context.js';
import { HEADER, withMdHeader, quoteFrontmatter } from '../core.js';
import { DEFAULT_TOOL_MODELS, antigravitySubagentTier, roleTier, resolveRoleModel, resolveTierModels } from '../models.js';
import { OWN_SKILLS, roleText, commands, trackerText } from './claude-code.js';

export const id = 'antigravity';
export const RULES = ['commits', 'deps', 'protected', 'docs', 'verify', 'lanes'];
export const DEFAULT_MODELS = DEFAULT_TOOL_MODELS[id];

const S = 'node .harness/scripts/sdd.js';

/** Exact native Antigravity tool names (unmapped names can stall custom subagents). */
const TOOLS = {
  'spec-reviewer': ['read_file'],
  architect: ['read_file', 'edit_file', 'write_file', 'run_command'],
  'frontend-dev': ['read_file', 'edit_file', 'write_file', 'run_command', 'manage_task'],
  'backend-dev': ['read_file', 'edit_file', 'write_file', 'run_command', 'manage_task'],
  'qa-tester': ['read_file', 'edit_file', 'write_file', 'run_command', 'manage_task'],
  reviewer: ['read_file', 'run_command', 'manage_task'],
  debugger: ['read_file', 'run_command', 'manage_task'],
  'doc-writer': ['read_file', 'edit_file', 'write_file', 'run_command'],
};

const TOOL_MATCHER = 'run_command|write_file|edit_file|write_to_file|replace_file_content|multi_replace_file_content|invoke_subagent|ask_question';

function commandSkillFile(name, description, body) {
  return quoteFrontmatter(`---
name: sdd-${name}
description: ${JSON.stringify(`${description} (/sdd-${name})`)}
---
${HEADER.md}

# /sdd-${name}

${body}
`);
}

function orchestratorAgentFile(config) {
  const targetModel = resolveRoleModel(config, id, 'orchestrator', 'orchestrator');
  return `---
name: sdd-orchestrator
description: "Primary Spec-Driven Development orchestrator: runs interviews, manages the two approval stops, delegates to specialized subagents and verifies every task."
mainAgent: true
subagent: false
skills:
  - skills/sdd
---
${HEADER.md}
<!-- Target model: ${targetModel} (tier: orchestrator · select "${targetModel}" or "Orchestrator (Neon)" in /model or agy --model) -->

# SDD Orchestrator

You are the main Spec-Driven Development orchestrator of this project (recommended model: \`${targetModel}\` or \`Orchestrator (Neon)\`).
Read \`.agents/skills/sdd/SKILL.md\` and \`AGENTS.md\`, check \`${S} status\`, and coordinate the specialized subagents in \`.agents/agents/\` passing each one its assigned \`Model\` tier (\`pro\`, \`flash\`, or \`flash_lite\`) so implementers and doc writers never inherit the orchestrator model unnecessarily.
`;
}

function agentFile(config, role, writes = [], installed = [], available = {}) {
  const tier = roleTier(config, role);
  const concreteModel = resolveRoleModel(config, id, role, tier);
  const { agentModel, invokeModel } = antigravitySubagentTier(concreteModel, tier);
  const r = roleText()[role];
  const own = (OWN_SKILLS[role] ?? []).filter((s) => available[s]);
  const skills = [...own, ...(installed ?? []).filter((s) => (s.roles ?? []).includes(role)).map((s) => s.name)];
  const toolsYaml = (TOOLS[role] ?? ['read_file']).map((t) => `  - ${t}`).join('\n');
  const skillsYaml = skills.length ? `\nskills:\n${skills.map((s) => `  - skills/${s}`).join('\n')}` : '';
  const skillLine = skills.length ? `\nBefore starting, read these skills from \`.agents/skills/\` when needed: ${skills.map((s) => `\`${s}\``).join(', ')}.\n` : '';
  return `---
name: ${role}
description: ${JSON.stringify(r.description)}
tools:
${toolsYaml}
subagent: true
mainAgent: false
model: ${JSON.stringify(agentModel)}${skillsYaml}
---
${HEADER.md}
<!-- Target model: ${concreteModel} (tier: ${tier} · invoke_subagent Model: "${invokeModel}") -->

# Role: ${role}

You are the \`${role}\` subagent of this project's Spec-Driven Development flow (tier \`${tier}\` · target model \`${concreteModel}\`).

${r.body}
${skillLine}
You may write only in: ${writes.length ? writes.map((w) => `\`${w}\``).join(', ') : 'nothing (read-only role)'}. The harness checks it when you finish.

Follow \`AGENTS.md\` (and the component \`AGENTS.md\` when working in a sub-package). Do not commit or push, do not edit \`.harness/\`, and do not tick \`tasks.md\` or change \`status\` in \`spec.md\` by hand. Keep your final report concise: files changed, real verification output, and any new tasks.
`;
}

function componentRuleFile(config, compId, dir) {
  const body = componentContext(config, compId);
  return `---
trigger: glob
globs: ${JSON.stringify(`**/${dir}/**`)}
description: ${JSON.stringify(`Reglas de stack, propiedad y verificación del componente ${compId} (${dir}).`)}
---
${body}
`;
}

/**
 * The always-on rule: short, under Antigravity's 24 KB limit, with only what
 * Gemini / non-Claude models must never improvise or skip, including per-role model tiers.
 */
export function rulesFile(config = {}) {
  const interview = (config.gates?.decisions ?? 'summary') === 'interview';
  const unplannedBlock = (config.gates?.unplanned ?? 'block') !== 'warn';
  const m = resolveTierModels(config, id);
  const highTier = antigravitySubagentTier(m.high, 'high').invokeModel;
  const midTier = antigravitySubagentTier(m.mid, 'mid').invokeModel;
  const lowTier = antigravitySubagentTier(m.low, 'low').invokeModel;
  return `---
trigger: always_on
description: "Flujo obligatorio Spec-Driven Development (sdd-harness): lectura de la skill sdd, modelos por rol, dos paradas reales, subagentes asíncronos con brief y verificación verde."
---
${HEADER.md}

# sdd-harness: flujo obligatorio

Este proyecto sigue Spec-Driven Development con sdd-harness. \`AGENTS.md\` tiene las reglas completas y la skill \`.agents/skills/sdd/SKILL.md\` dirige el flujo. **Léela con \`read_file\` antes de cualquier trabajo de código** y cada vez que el usuario pida una funcionalidad, un cambio o seguir con el trabajo.

- **Estado y artefactos en el repo**: ejecuta \`${S} status\` para saber dónde estamos. El estado vive en \`specs/*/spec.md\` (\`status\`) y en \`specs/*/tasks.md\`; no lo deduzcas de memoria. Crea siempre las specs, planes, tareas y ADRs en \`specs/\` y \`docs/decisions/\` del proyecto (**nunca** los sustituyas por artefactos internos en \`brain/\`, ni inicies \`swarm\` salvo que el usuario lo pida explícitamente).
- **Dos paradas reales (spec y plan)**: registra la parada con \`${S} stop <spec|plan>\`, pregunta al usuario (\`ask_question\` o en el chat) y **espera su respuesta**. Cuando responda afirmativamente en el chat, el hook lo registra solo; si eligió "Aprobar" en \`ask_question\`, ejecuta \`${S} approve\`. ${unplannedBlock ? 'Sin el plan aprobado (\`status: plan-approved\`), el guardián bloquea cualquier escritura de código de componentes.' : 'No implementes código antes de aprobar el plan.'} Nunca edites \`status:\` en \`spec.md\` a mano ni encadenes \`stop\` y \`approve\` en el mismo turno.
- **Modelos por rol (equivalencia con Claude Opus / Sonnet / Haiku)**:
  - **Orquestador** (sesión principal): \`${m.orchestrator}\` (o \`Orchestrator (Neon)\`).
  - **Alto** (\`architect\`, \`spec-reviewer\`, \`reviewer\`, \`debugger\`): \`${m.high}\` → en \`invoke_subagent\` pasa \`Model: "${highTier}"\`.
  - **Medio** (\`frontend-dev\`, \`backend-dev\`, \`qa-tester\`): \`${m.mid}\` → en \`invoke_subagent\` pasa \`Model: "${midTier}"\`.
  - **Bajo** (\`doc-writer\` y tareas \`[mecánica]\`): \`${m.low}\` → en \`invoke_subagent\` pasa \`Model: "${lowTier}"\`.
  Pasa **siempre** el parámetro \`Model\` explícito al llamar a \`invoke_subagent\` (no dejes \`inherit\` por omisión cuando el orquestador sea \`Neon\`, para que devs y docs usen su modelo asignado).
- **Delegar en subagentes asíncronos**: \`${S} next\` lista las tareas listas. Para cada una ejecuta \`${S} brief <TID>\` y lánzala con \`invoke_subagent\` (\`TypeName\` = el rol que indica el brief, p. ej. \`backend-dev\`; \`Model\` = el nivel indicado en el brief; \`Role\` = título breve; \`Prompt\` = **ese brief tal cual**). Nunca más subagentes a la vez de los que indica \`next\` (cada desarrollador fija el suyo con \`${S} agents <1-4>\`). **Importante**: \`invoke_subagent\` se ejecuta en segundo plano y retorna al instante; tras lanzar los subagentes listos, **termina tu turno sin llamar más herramientas** y espera la notificación de que terminaron antes de verificar.
- **Verificación real**: cuando un subagente termine, ejecuta \`${S} verify --component <id> --tests\` y, solo en verde, cierra con \`${S} done <TID>\`. El guardián bloquea marcar \`[x]\` a mano en \`tasks.md\`; no des por ejecutados tests que no corriste.
- **Solo el alcance de la tarea**: nada de refactors, limpieza, cambios de estilo ni de UI fuera de ella. Si surgen tareas nuevas, añádelas como \`- [ ]\` en \`tasks.md\` marcadas "añadida en implementación" y sigue.
- **Decisiones pendientes** (aclaraciones, ADRs en borrador, tareas añadidas, avisos): \`${S} decisions\` las lista. ${interview ? 'En este proyecto se entrevista al usuario sobre ellas, una pregunta cada vez, antes de seguir.' : 'En este proyecto se registran y se cuentan en el resumen; el usuario pide la entrevista con /sdd-decisions.'}
- **Pausa**: si el usuario quiere parar o retomar luego, ejecuta \`${S} pause\`; deja terminar lo activo, no lances nada nuevo y resume cómo retomar (\`${S} resume\` o \`/sdd-resume\`).
- **Nunca**: editar \`.harness/\` ni archivos generados; hacer \`git push\`, \`rebase\`, \`merge\` o \`reset\` sin que el usuario lo pida; terminar con la verificación en rojo sin informarlo.
`;
}

// Antigravity runs hook commands with cwd = directory containing hooks.json (.agents/).
const hook = (event) => ({ type: 'command', command: `node ../.harness/scripts/hook.js ${event}` });

export function generate(config = {}, ctx = {}) {
  const local = (config.install_mode ?? 'local') === 'local';
  const entries = [];
  const notices = [];
  const add = (e) => entries.push({ generator: id, tool: id, ...e });

  add({ kind: 'file', path: '.agents/rules/sdd-harness.md', content: rulesFile(config) });

  // Sub-directory components are not auto-discovered by Antigravity when opening the workspace root:
  // glob rules load each component's stack and verification commands automatically.
  for (const [compId, c] of Object.entries(config.components ?? {})) {
    const dir = String(c.path ?? '').replace(/\\/g, '/').replace(/^\.\/?/, '').replace(/\/$/, '');
    if (dir) {
      add({ kind: 'file', path: `.agents/rules/component-${compId}.md`, content: componentRuleFile(config, compId, dir) });
    }
  }

  for (const [name, content] of Object.entries(ctx.skills ?? {})) {
    add({ kind: 'file', path: `.agents/skills/${name}/SKILL.md`, content: withMdHeader(content) });
  }

  // Primary orchestrator custom agent + specialized subagents (.agents/agents/<role>.md).
  add({ kind: 'file', path: '.agents/agents/sdd-orchestrator.md', content: orchestratorAgentFile(config) });
  for (const { role, writes } of neededRoles(config)) {
    if (roleText()[role]) {
      add({ kind: 'file', path: `.agents/agents/${role}.md`, content: agentFile(config, role, writes, ctx.installedSkills, ctx.skills ?? {}) });
    }
  }

  // Slash-command skills (/sdd-<cmd>), replacing deprecated .agents/workflows/*.md.
  const subagentNote = ' using invoke_subagent (TypeName = the role name, e.g. "backend-dev", Model = the role\'s tier from the brief: "pro" for high, "flash" for mid, "flash_lite" for low, Role = short title, Prompt = the brief verbatim; since invoke_subagent runs in the background, end your turn after launching ready subagents and wait for their completion notification before running verify and done)';
  const flowCommands = commands(config, { delegate: 'delegate', subagentNote });
  for (const [name, [description, , body]] of Object.entries(flowCommands)) {
    const cleanBody = body
      .replace(/\s*\$ARGUMENTS/g, name === 'spec' ? ' what the user describes (ask for a short description if they gave none)' : '')
      .replace(/\/sdd:([a-z-]+)/g, '/sdd-$1');
    add({ kind: 'file', path: `.agents/skills/sdd-${name}/SKILL.md`, content: commandSkillFile(name, description, cleanBody) });
  }
  if (config.tracker?.enabled && config.tracker.provider) {
    const tr = trackerText(config.tracker);
    add({ kind: 'file', path: '.agents/skills/sdd-tracker/SKILL.md', content: commandSkillFile('tracker', tr.description, tr.body) });
  }

  // RF-SKL-13 / RF-AGN-04: Streamable HTTP MCP server for Figma / Penpot (Antigravity schema uses `url` without `type`).
  const design = config.design?.source;
  const mcpPath = '.agents/mcp_config.json';
  if (design === 'figma' || (design === 'penpot' && config.design?.mcp_url)) {
    if (local && ctx.tracked?.has(mcpPath)) {
      notices.push({ code: 'toolNeedsTeam', params: { tool: id, file: mcpPath } });
    } else {
      const server = design === 'figma'
        ? { 'mcpServers.figma': { url: 'https://mcp.figma.com/mcp' } }
        : { 'mcpServers.penpot': { url: config.design.mcp_url } };
      add({ kind: 'json', path: mcpPath, values: server });
    }
  } else if (design === 'penpot' && !(config.tools ?? []).includes('claude-code')) {
    notices.push({ code: 'penpotUrl', params: {} });
  }

  const hooksPath = '.agents/hooks.json';
  if (local && ctx.tracked?.has(hooksPath)) {
    notices.push({ code: 'toolNeedsTeam', params: { tool: id, file: hooksPath } });
  } else {
    add({
      kind: 'json',
      path: hooksPath,
      values: {},
      appends: {
        'sdd-guards.PreToolUse': [{ matcher: TOOL_MATCHER, hooks: [hook('PreToolUse')] }],
        'sdd-guards.PostToolUse': [{ matcher: TOOL_MATCHER, hooks: [hook('PostToolUse')] }],
        'sdd-guards.SessionStart': [hook('SessionStart')],
        'sdd-guards.PreInvocation': [hook('PreInvocation')],
        'sdd-guards.PostInvocation': [hook('PostInvocation')],
        'sdd-guards.Stop': [hook('Stop')],
      },
      enforces: RULES,
    });
  }

  return { entries, notices };
}
