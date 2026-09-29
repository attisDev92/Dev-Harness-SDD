// Claude Code adapter (RF-ADP-01/02/05, RF-GEN-06, RF-ORQ-10, RF-DOM-02).
//
// Generates, in Claude Code's native formats:
//   .claude/agents/<role>.md          one subagent per needed role
//   .claude/commands/sdd/<cmd>.md     the /sdd:* flow commands
//   .claude/skills/<name>/SKILL.md    copies of the canonical skills
//   .claude/settings(.local).json     permissions and hooks (merged, never replaced)

import { neededRoles } from '../context.js';
import { withMdHeader } from '../core.js';

export const id = 'claude-code';
export const RULES = ['commits', 'deps', 'protected', 'docs', 'retries', 'verify', 'lanes'];

/** RF-ORQ-10: model tier of each role (README table). */
export const ROLE_TIERS = {
  'spec-reviewer': 'high', architect: 'high', 'frontend-dev': 'mid', 'backend-dev': 'mid',
  'qa-tester': 'mid', reviewer: 'high', debugger: 'high', 'doc-writer': 'low',
};
export const DEFAULT_MODELS = { high: 'opus', mid: 'sonnet', low: 'haiku' };

const TOOLS = {
  'spec-reviewer': 'Read, Grep, Glob',
  architect: 'Read, Grep, Glob, Write, Edit',
  'frontend-dev': 'Read, Grep, Glob, Write, Edit, Bash',
  'backend-dev': 'Read, Grep, Glob, Write, Edit, Bash',
  'qa-tester': 'Read, Grep, Glob, Write, Edit, Bash',
  reviewer: 'Read, Grep, Glob, Bash',
  debugger: 'Read, Grep, Glob, Bash',
  'doc-writer': 'Read, Grep, Glob, Write, Edit',
};

const ROLE_TEXT = {
  'spec-reviewer': {
    description: 'QA of a spec: finds ambiguities, contradictions, missing edge cases and conflicts with the constitution. Never fixes them. Use for /sdd:clarify.',
    body: 'Review the spec you are given. List problems grouped by severity; do not rewrite the spec. Load the spec-generator skill (review mode).',
  },
  architect: {
    description: 'Technical plan, API contracts and ADR proposals for an approved spec. Use for /sdd:plan and /sdd:tasks.',
    body: 'Write plan.md: modules, data model, decisions with the discarded alternative, test strategy, and which requirements each part covers. When the spec spans several components, write the contract in contracts/ of the provider spec. Every stack or architecture decision gets an ADR draft (adr skill). For tasks.md, each task under 30 minutes, ordered by dependency, in the format of .harness/templates/tasks.md.',
  },
  'frontend-dev': {
    description: 'Implements frontend tasks: UI, design system, components. Tests first. Use for tasks of frontend components.',
    body: 'Implement exactly the task you are given, inside its scope. Write the tests first, then the code. Reuse the design system and existing components; follow the component AGENTS.md. Do not add dependencies. When done, report the files you changed.',
  },
  'backend-dev': {
    description: 'Implements backend tasks: API, domain, persistence. Tests first. Use for tasks of backend or other non-UI components.',
    body: 'Implement exactly the task you are given, inside its scope. Write the tests first, then the code. Validate input at the edges, keep layers separate, follow the component AGENTS.md. Do not add dependencies or touch migrations without an approved gate. When done, report the files you changed.',
  },
  'qa-tester': {
    description: 'Unit, integration and end-to-end tests, and reproducible bug reports.',
    body: 'Write or extend tests that prove the requirements (put the requirement ID, e.g. RF-01, in the test name so /sdd:validate can find it). Report bugs with steps, expected and actual result.',
  },
  reviewer: {
    description: 'Reviews a finished task: spec compliance first, then quality and security. Read-only. Use after verification passes.',
    body: 'First check each requirement of the task against the code and tests. Then quality (clarity, duplication, error handling) and security (input validation, authorization, secrets, injection). Report findings with file and line; change nothing.',
  },
  debugger: {
    description: 'Root-cause triage when a fix is not automatic. Reports options; never fixes. Use when sdd.js asks for triage.',
    body: 'Follow the triage-report skill exactly. Do not modify any file.',
  },
  'doc-writer': {
    description: 'Updates the allowed documentation (README, CHANGELOG, architecture docs, lessons).',
    body: 'Update only documents in the whitelist of AGENTS.md. Keep them short and accurate.',
  },
};

/** Own skills each role loads; third-party ones come from the registry (RF-SKL-12). */
const OWN_SKILLS = {
  'spec-reviewer': ['spec-generator'], architect: ['adr'], debugger: ['triage-report'],
};

function agentFile(config, role, writes, installed = []) {
  const tier = config.roles?.[role]?.tier ?? ROLE_TIERS[role];
  const model = config.models?.['claude-code']?.[tier] ?? DEFAULT_MODELS[tier];
  const r = ROLE_TEXT[role];
  const skills = [...(OWN_SKILLS[role] ?? []), ...installed.filter((s) => (s.roles ?? []).includes(role)).map((s) => s.name)];
  const skillLine = skills.length ? `\nBefore starting, load these skills: ${skills.map((s) => `\`${s}\``).join(', ')}.\n` : '';
  return `---
name: ${role}
description: ${r.description}
tools: ${TOOLS[role]}
model: ${model}
---
<!-- Generated by sdd-harness. Do not edit by hand: run "harness sync". -->

You are the \`${role}\` role of this project's Spec-Driven Development flow.

${r.body}
${skillLine}
You may write only in: ${writes.length ? writes.map((w) => `\`${w}\``).join(', ') : 'nothing (read-only role)'}. The harness checks it when you finish.

Read AGENTS.md first. Never commit, push, install dependencies or edit \`.harness/\` or \`harness.config.yaml\`.
`;
}

const S = 'node .harness/scripts/sdd.js';

const COMMANDS = {
  constitution: ['Propose the project principles (constitution)', '', `Load the sdd-orchestrator skill. Propose 6–10 short, verifiable principles in docs/constitution.md starting from .harness/templates/constitution.md. Always keep: the agent never commits; every stack or architecture decision needs an approved ADR; no task is finished with verification failing. Run \`${S} lint constitution\`, then \`${S} gate request constitution\` and stop.`],
  spec: ['Interview and write a spec (EARS)', '<short description>', `Load the spec-generator skill and follow it for: $ARGUMENTS`],
  clarify: ['QA review of the active spec', '', `Delegate to the spec-reviewer subagent with the active spec (\`${S} status\`). Present its findings without resolving them, then \`${S} gate request clarify\` and stop.`],
  plan: ['Technical plan, contracts and ADR proposals', '', `Check \`${S} status\`: the spec must be approved. Delegate to the architect subagent to write plan.md (and contracts/, ADR drafts). Show the plan, then \`${S} gate request plan\` and stop. Every ADR stays "Proposed" until approved.`],
  tasks: ['Break the plan into tasks', '', `Delegate to the architect subagent to write tasks.md from .harness/templates/tasks.md: tasks under 30 minutes, ordered by dependency, each with requirements, component, scope (globs) and "Done when". Run \`${S} lint tasks\`, then \`${S} gate request tasks\` and stop.`],
  next: ['Run exactly one task, then stop for the manual test', '', `Load the sdd-orchestrator skill and follow "One task": \`${S} next\`, delegate, \`${S} verify\`, review, \`${S} gate request manual-test\` with the manual test instructions. Stop and wait for OK or KO.`],
  validate: ['Validate the spec requirement by requirement', '', `Run \`${S} validate\` and the verification of every component. Give, for each requirement: the test that covers it and its result. Requirements without a test are "not covered". End with a verdict, then \`${S} gate request validate\`.`],
  change: ['New requirement: update the spec first', '<the change>', `Run \`${S} change start\`. Update the spec for: $ARGUMENTS (and plan/tasks if needed). Show the diff, then \`${S} gate request change\` and stop. No code until it is approved.`],
  status: ['Show the state of the flow', '', `Run \`${S} status\` and summarise it: active spec, current task, blockers, pending decisions, cost.`],
  commit: ['Propose commit messages (you never commit)', '', `Run \`${S} commit-context\`. Propose one commit message per repository with changes, following its convention and language, referencing specs and tasks. Never run git commit: the user commits.`],
  approve: ['Approve the pending decision', '[comment or chosen option]', 'The user approved the pending decision (the harness already recorded it). Continue with the next step of the flow.'],
  reject: ['Reject the pending decision', '<reason>', 'The user rejected the pending decision (the harness already recorded it): $ARGUMENTS. Do not continue with that step; address the reason first.'],
};

function commandFile(name) {
  const [description, hint, body] = COMMANDS[name];
  return `---
description: ${description}
${hint ? `argument-hint: ${hint}\n` : ''}---
<!-- Generated by sdd-harness. Do not edit by hand: run "harness sync". -->

${body}
`;
}

const hook = (event) => ({ type: 'command', command: `node "$CLAUDE_PROJECT_DIR/.harness/scripts/hook.js" ${event}` });

/** Settings keys the harness adds (appended, so existing rules and hooks stay). */
export function settingsAppends() {
  return {
    'permissions.deny': [
      'Bash(git commit:*)', 'Bash(git push:*)', 'Bash(git rebase:*)', 'Bash(git merge:*)', 'Bash(git reset --hard:*)',
      'Bash(git cherry-pick:*)', 'Bash(git revert:*)', 'Bash(git stash drop:*)', 'Bash(git branch -D:*)',
      'Edit(/.harness/**)', 'Write(/.harness/**)', 'Edit(/harness.config.yaml)', 'Write(/harness.config.yaml)',
    ],
    'permissions.ask': [
      'Bash(npm install:*)', 'Bash(npm i:*)', 'Bash(pnpm add:*)', 'Bash(yarn add:*)', 'Bash(bun add:*)', 'Bash(pip install:*)',
      'Bash(uv add:*)', 'Bash(poetry add:*)', 'Bash(cargo add:*)', 'Bash(go get:*)', 'Bash(composer require:*)',
      'Bash(dotnet add package:*)', 'Bash(gem install:*)',
    ],
    'hooks.PreToolUse': [{ matcher: 'Bash|Write|Edit|MultiEdit|NotebookEdit|Task|Agent', hooks: [hook('PreToolUse')] }],
    'hooks.PostToolUse': [{ matcher: 'Write|Edit|MultiEdit|NotebookEdit|Task|Agent', hooks: [hook('PostToolUse')] }],
    'hooks.UserPromptSubmit': [{ hooks: [hook('UserPromptSubmit')] }],
    'hooks.SessionStart': [{ hooks: [hook('SessionStart')] }],
    'hooks.SessionEnd': [{ hooks: [hook('SessionEnd')] }],
    'hooks.Stop': [{ hooks: [hook('Stop')] }],
  };
}

/**
 * @param {object} config
 * @param {{ tracked: Set<string>, skills: Record<string, string> }} ctx
 */
export function generate(config, ctx) {
  const local = (config.install_mode ?? 'local') === 'local';
  const entries = [];
  const notices = [];
  const add = (e) => entries.push({ generator: id, tool: id, ...e });

  for (const { role, writes } of neededRoles(config)) {
    add({ kind: 'file', path: `.claude/agents/${role}.md`, content: agentFile(config, role, writes, ctx.installedSkills) });
  }

  // RF-SKL-13: MCP server of the design source. Adding it goes through the
  // sync diff and its confirmation, which is the user's approval.
  const design = config.design?.source;
  if (design === 'figma') {
    add({ kind: 'json', path: '.mcp.json', values: { 'mcpServers.figma': { type: 'http', url: 'https://mcp.figma.com/mcp' } } });
  } else if (design === 'penpot') {
    if (config.design?.mcp_url) add({ kind: 'json', path: '.mcp.json', values: { 'mcpServers.penpot': { type: 'http', url: config.design.mcp_url } } });
    else notices.push({ code: 'penpotUrl', params: {} });
  }
  for (const name of Object.keys(COMMANDS)) add({ kind: 'file', path: `.claude/commands/sdd/${name}.md`, content: commandFile(name) });
  for (const [name, content] of Object.entries(ctx.skills ?? {})) add({ kind: 'file', path: `.claude/skills/${name}/SKILL.md`, content: withMdHeader(content) });

  const settings = local ? '.claude/settings.local.json' : '.claude/settings.json';
  if (local && ctx.tracked?.has(settings)) {
    notices.push({ code: 'toolNeedsTeam', params: { tool: id, file: settings } });
  } else {
    add({ kind: 'json', path: settings, values: {}, appends: settingsAppends(), enforces: RULES });
  }
  return { entries, notices };
}
