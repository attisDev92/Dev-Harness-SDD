// Claude Code adapter (RF-ADP-01/02/05, RF-GEN-06, RF-ORQ-10, RF-DOM-02).
//
// Generates, in Claude Code's native formats:
//   .claude/agents/<role>.md          one subagent per needed role
//   .claude/commands/sdd/<cmd>.md     the /sdd:* flow commands
//   .claude/skills/<name>/SKILL.md    copies of the canonical skills
//   .claude/settings(.local).json     permissions and hooks (merged, never replaced)

import { neededRoles } from '../context.js';
import { withMdHeader, quoteFrontmatter } from '../core.js';

export const id = 'claude-code';
export const RULES = ['commits', 'deps', 'protected', 'docs', 'verify', 'lanes'];

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
    description: 'QA of a spec before it is approved: finds ambiguities, contradictions, missing edge cases and conflicts with the constitution. Never fixes them.',
    body: 'Review the spec you are given. List problems grouped by severity; do not rewrite the spec. Load the spec-generator skill (review mode).',
  },
  architect: {
    description: 'Technical plan, API contracts, ADR drafts and tasks.md for an approved spec, all in one go.',
    body: 'Write plan.md: modules, data model, decisions with the discarded alternative, test strategy (which requirements are proven by AI evaluations instead of normal tests, because they need a real model), and which requirements each part covers. When the spec spans several components, write the contract in contracts/ of the provider spec. Every stack or architecture decision gets an ADR draft (adr skill). The data model lists the tables and columns the spec creates or changes: approving the plan approves those migrations, so they need no ADR; tasks that write migrations include the migration path in their scope. Then tasks.md, in the format of .harness/templates/tasks.md: tasks under 30 minutes, each with its component; requirements, scope and "Done when" whenever you can. Set "Depends on" only for real dependencies (a UI task works against the contract with mocks), so frontend and backend tasks can run in parallel (2 subagents at once at most).',
  },
  'frontend-dev': {
    description: 'Implements frontend tasks: UI, design system, components. Tests first. Use for tasks of frontend components.',
    body: 'Implement the task you are given. Write the tests first, then the code. Reuse the design system and existing components; follow the component AGENTS.md. If you find work the task did not foresee, do it when it is small and needed, and report it so it is added to tasks.md. When done, report the files you changed.',
  },
  'backend-dev': {
    description: 'Implements backend tasks: API, domain, persistence. Tests first. Use for tasks of backend or other non-UI components.',
    body: 'Implement the task you are given. Write the tests first, then the code. Validate input at the edges, keep layers separate, follow the component AGENTS.md. Tests that call a real model (retrieval quality, LLM as judge) are AI evaluations: they cost money and are not deterministic, so they go with the verify.eval command of the component (for example in evals/), never with the normal tests; normal tests mock the model. A migration that is in the data model of the approved plan needs no ADR and no new approval; one that is not goes into the data model of plan.md and your report. An ADR draft only for structural database decisions (db-migrations skill). If you find work the task did not foresee, do it when it is small and needed, and report it so it is added to tasks.md. When done, report the files you changed.',
  },
  'qa-tester': {
    description: 'Unit, integration and end-to-end tests, and reproducible bug reports.',
    body: 'Write or extend tests that prove the requirements (put the requirement ID, e.g. RF-01, in the test name so the validation can find it). Tests that call a real model (retrieval quality, LLM as judge) are AI evaluations: they cost money and are not deterministic, so they go with the verify.eval command of the component (for example in evals/), never with the normal tests; normal tests mock the model. Report bugs with steps, expected and actual result.',
  },
  reviewer: {
    description: 'Reviews finished work: spec compliance first, then quality and security. Read-only. Runs with doc-writer after verification passes, as long as no more than 2 subagents work at once.',
    body: 'First check each requirement of the task against the code and tests. If the changes include migrations or schema files, check that every table and column they create, change or drop is in the data model of plan.md; report any that is not. Report any test outside the evaluations that calls a real model or a paid API. Then quality (clarity, duplication, error handling) and security (input validation, authorization, secrets, injection). Report findings with file and line, most important first; change nothing.',
  },
  debugger: {
    description: 'Root-cause triage when a fix does not work after 2 attempts. Reports options; never fixes.',
    body: 'Follow the triage-report skill exactly. Do not modify any file.',
  },
  'doc-writer': {
    description: 'Keeps the documentation current: spec, plan, tasks.md, README, CHANGELOG, ADRs, architecture docs. Runs with reviewer after each task, as long as no more than 2 subagents work at once.',
    body: 'Read the changes (git diff) and update every document they affect: tick nothing, but keep spec/plan/tasks.md consistent with what was built (add tasks that came up, marked "added during implementation" in the specs language), README and CHANGELOG, ADRs and architecture docs. Keep them short and accurate. Report what you updated.',
  },
};

/** Own skills each role loads; third-party ones come from the registry (RF-SKL-12). */
const OWN_SKILLS = {
  'spec-reviewer': ['spec-generator'],
  architect: ['adr', 'backend-architecture', 'api-design'],
  'frontend-dev': ['clean-code', 'design-system'],
  'backend-dev': ['clean-code', 'backend-architecture', 'api-design', 'secure-coding', 'db-migrations'],
  'qa-tester': ['testing-strategy'],
  reviewer: ['secure-coding'],
  debugger: ['triage-report'],
  'doc-writer': ['docs-writer'],
};

function agentFile(config, role, writes, installed = [], available = {}) {
  const tier = config.roles?.[role]?.tier ?? ROLE_TIERS[role];
  const model = config.models?.['claude-code']?.[tier] ?? DEFAULT_MODELS[tier];
  const r = ROLE_TEXT[role];
  const own = (OWN_SKILLS[role] ?? []).filter((s) => available[s]);
  const skills = [...own, ...installed.filter((s) => (s.roles ?? []).includes(role)).map((s) => s.name)];
  const skillLine = skills.length ? `\nBefore starting, load these skills: ${skills.map((s) => `\`${s}\``).join(', ')}.\n` : '';
  return quoteFrontmatter(`---
name: ${role}
description: ${r.description}
tools: ${TOOLS[role]}
model: ${model}
---
<!-- Generated by sdd-harness. Do not edit by hand: run "sdd-harness sync". -->

You are the \`${role}\` role of this project's Spec-Driven Development flow.

${r.body}
${skillLine}
You may write only in: ${writes.length ? writes.map((w) => `\`${w}\``).join(', ') : 'nothing (read-only role)'}. The harness checks it when you finish.

Read AGENTS.md first. Do not commit or push (the orchestrator proposes the commit to the user when a story closes), and do not edit \`.harness/\`.
`);
}

const S = 'node .harness/scripts/sdd.js';

// RF-ORQ-14: shortcuts that inform or launch work. None of them is needed to approve or to move on.
const COMMANDS = {
  status: ['What happened and what comes next', '', `Run \`${S} status\` and summarise it for the user: the spec in progress and its state, the last tasks closed, what is pending and what can start now, tasks added during implementation, the last verification and the last commits. Suggest the next step in one line.`],
  spec: ['Start a new spec', '<short description>', `Load the sdd skill and start a new spec for: $ARGUMENTS`],
  next: ['Launch the tasks that can start now (2 at once at most)', '', `Load the sdd skill and follow "Implement": \`${S} next\` lists the tasks that can start now (one per component, 2 at most); delegate them at the same time. Never more than 2 subagents working at once.`],
  docs: ['Bring the documentation up to date, in the background', '[what changed]', `Delegate to the doc-writer subagent: update every document affected by the recent changes (git diff) $ARGUMENTS. Keep working on anything else meanwhile, and summarise what it updated.`],
  review: ['Review the recent changes', '[scope]', `Delegate at the same time to the reviewer subagent (spec compliance, quality, security) and, when there are tests to add, to qa-tester (never more than 2 subagents working at once), over the recent changes (git diff) $ARGUMENTS. Summarise the findings, most important first, and fix the clear ones inside the task.`],
  validate: ['Validate the spec requirement by requirement', '', `Run \`${S} verify\` and \`${S} validate\`. Give, for each requirement: the test that covers it and its result; requirements without a test are "not covered". End with a verdict.`],
  commit: ['Propose the commit now', '', `Run \`${S} commit-context\`. Propose one commit message per repository with changes, following its convention and language, referencing specs and tasks, and ask the user. If they say yes, run git add and git commit. Never push unless they ask.`],
};

function commandFile(name) {
  const [description, hint, body] = COMMANDS[name];
  return quoteFrontmatter(`---
description: ${description}
${hint ? `argument-hint: ${hint}\n` : ''}---
<!-- Generated by sdd-harness. Do not edit by hand: run "sdd-harness sync". -->

${body}
`);
}

/**
 * RF-TRK-*: sync with whatever tracker the user has. The agent talks to the
 * tracker through its MCP; sdd.js decides what changes, the user okays the writes.
 */
function trackerCommand(tracker) {
  const where = tracker.project ? ` (proyecto/tablero: ${tracker.project})` : tracker.repo ? ` (repo: ${tracker.repo})` : '';
  return quoteFrontmatter(`---
description: Sincroniza tasks.md con ${tracker.provider}${where}
---
<!-- Generated by sdd-harness. Do not edit by hand: run "sdd-harness sync". -->

Sync the tasks of every spec with **${tracker.provider}**${where}, using the ${tracker.provider} tools from your MCP servers. If no ${tracker.provider} MCP tools are available, stop and tell the user to connect that MCP server.

1. For each spec with a tasks.md, list its items in ${tracker.provider}: the ones labelled or tagged \`sdd:<SPEC-ID>\` (for example \`sdd:API-001-auth\`), or whose title starts with a task id of that spec. For each item keep: key (its id in the tracker), title and whether it is done/closed.
2. Pass them as JSON on stdin: \`node .harness/scripts/sdd.js tracker plan\` with \`{"<SPEC-ID>": [{"key": "…", "title": "T1 …", "done": false}]}\`. It prints what goes in each direction.
3. Conflicts, items missing in the tracker and new items there: ask the user, one by one. Never pick a side yourself and never delete anything.
4. If the plan creates or updates items in the tracker, show it to the user and ask; continue when they say yes.
5. Then create the missing items (title "T<n> <title>", label/tag \`sdd:<SPEC-ID>\`, a short description) and update the ones the plan says, through the MCP. Keep the key of every item you create.
6. \`node .harness/scripts/sdd.js tracker apply\` with \`{"<SPEC-ID>": {"links": {"T1": "<new key>"}, "conflicts": {"T3": "local" | "remote"}, "proposals": ["<accepted key>"]}}\` on stdin. It updates tasks.md; the spec is never touched.

Only status, title and new tasks are synced. Never put tokens or secrets in any file.
`);
}

const hook = (event) => ({ type: 'command', command: `node "$CLAUDE_PROJECT_DIR/.harness/scripts/hook.js" ${event}` });

/** Settings keys the harness adds (appended, so existing rules and hooks stay). */
export function settingsAppends(config = {}) {
  // The harness's own scripts and the project's verification commands run without a prompt each time.
  const verify = Object.values(config.components ?? {}).flatMap((c) => Object.values(c.verify ?? {})).filter((c) => typeof c === 'string' && c.trim());
  return {
    // RF-GAT-03: the commit is agreed with the user in the conversation when a story closes, so it is not asked twice.
    'permissions.allow': [
      'Bash(node .harness/scripts/sdd.js:*)', 'Bash(npx sdd-harness sync:*)', 'Bash(sdd-harness sync:*)',
      'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git add:*)', 'Bash(git commit:*)',
      ...verify.map((c) => `Bash(${c}:*)`),
    ],
    'permissions.deny': [
      'Edit(/.harness/**)', 'Write(/.harness/**)',
    ],
    // RF-GAT-01/05/09: native confirmation, showing the command. No shell analysis of our own.
    'permissions.ask': [
      'Bash(git push:*)', 'Bash(git rebase:*)', 'Bash(git merge:*)', 'Bash(git reset --hard:*)', 'Bash(git cherry-pick:*)',
      'Bash(git stash drop:*)', 'Bash(git branch -D:*)', 'Bash(git tag:*)',
      'Bash(npm install:*)', 'Bash(npm i:*)', 'Bash(pnpm add:*)', 'Bash(yarn add:*)', 'Bash(bun add:*)', 'Bash(pip install:*)',
      'Bash(uv add:*)', 'Bash(poetry add:*)', 'Bash(cargo add:*)', 'Bash(go get:*)', 'Bash(composer require:*)',
      'Bash(dotnet add package:*)', 'Bash(gem install:*)',
      'Edit(/harness.config.yaml)', 'Write(/harness.config.yaml)',
    ],
    'hooks.PreToolUse': [{ matcher: 'Write|Edit|MultiEdit|NotebookEdit|Task|Agent', hooks: [hook('PreToolUse')] }],
    'hooks.PostToolUse': [{ matcher: 'Write|Edit|MultiEdit|NotebookEdit|Task|Agent', hooks: [hook('PostToolUse')] }],
    'hooks.UserPromptSubmit': [{ hooks: [hook('UserPromptSubmit')] }],
    'hooks.SessionStart': [{ hooks: [hook('SessionStart')] }],
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
    add({ kind: 'file', path: `.claude/agents/${role}.md`, content: agentFile(config, role, writes, ctx.installedSkills, ctx.skills ?? {}) });
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
  if (config.tracker?.enabled && config.tracker.provider) {
    add({ kind: 'file', path: '.claude/commands/sdd/tracker.md', content: trackerCommand(config.tracker) });
  }
  for (const [name, content] of Object.entries(ctx.skills ?? {})) add({ kind: 'file', path: `.claude/skills/${name}/SKILL.md`, content: withMdHeader(content) });

  const settings = local ? '.claude/settings.local.json' : '.claude/settings.json';
  if (local && ctx.tracked?.has(settings)) {
    notices.push({ code: 'toolNeedsTeam', params: { tool: id, file: settings } });
  } else {
    add({ kind: 'json', path: settings, values: {}, appends: settingsAppends(config), enforces: RULES });
  }
  return { entries, notices };
}
