// The harness's own skills (RF-SKL-01): the flow skills here and the practice
// skills in skills-practice.js. Canonical copies go to .agents/skills/
// (RF-GEN-05); tools that need another path get copies.

import { practiceSkills } from './skills-practice.js';

/** Every own skill this project needs (RF-SKL-12: only the relevant ones). */
export function ownSkills(config) {
  return { ...flowSkills(config), ...practiceSkills(config) };
}

const S = (lang) => ({
  talk: lang.cli === 'es' ? 'Spanish' : 'English',
  specs: lang.specs === 'es' ? 'Spanish' : 'English',
  docs: lang.docs === 'es' ? 'Spanish' : 'English',
});

function flowSkills(config) {
  const l = S({ cli: config.cli?.language ?? config.language?.docs, specs: config.language?.specs, docs: config.language?.docs });
  return {
    sdd: `---
name: sdd
description: Runs the Spec-Driven Development flow of this project. Use it whenever the user asks for a new feature, a change to how something works, a bug fix that changes behaviour, or says to continue with the work; and for every /sdd:* command. It reads the state from the spec files and does the next step.
---

# SDD

You are the orchestrator, in the main session: you delegate to the subagents (they cannot start other subagents) and you talk to the user. Keep the flow moving: **the user is asked only at two stops** (the spec, and the plan with its tasks), for the commit when a story closes, and when something is really theirs to decide. Everything else goes on without waiting and is told in your summaries.

## Where are we

\`node .harness/scripts/sdd.js status\`. The state is in the files: \`status\` in the frontmatter of spec.md (\`draft\` → \`spec-approved\` → \`plan-approved\` → \`done\`) and the checkboxes of tasks.md.

## 1. Spec (status: draft)

- First spec of the project and no \`docs/constitution.md\`: propose 6–10 principles from .harness/templates/constitution.md; they are approved at the same stop as the spec.
- Follow the spec-generator skill: \`sdd.js new-spec <name>\`, one question at a time (6 at most), EARS requirements, \`[NEEDS CLARIFICATION]\` for gaps. Then delegate a review to \`spec-reviewer\` and fix what it finds that the user already answered.
- **Stop 1:** \`sdd.js stop spec\`, show a short summary (requirements, open questions, reviewer findings) and ask with AskUserQuestion: "Aprobar" / "Cambiar algo". A yes in plain words ("sí", "continúa", "aprobado", "dale") is recorded by the harness on its own; if they pick "Aprobar" in the question, run \`sdd.js approve\`. Anything else is a change: apply it and ask again.

## 2. Plan and tasks (status: spec-approved)

- Delegate to \`architect\`: plan.md, contracts/ when several components are involved, ADR drafts for stack or architecture decisions, and tasks.md, all at once.
- **Stop 2:** \`sdd.js stop plan\`, summarise the plan and the task list (by component and story) and ask the same way.

## 3. Implement (status: plan-approved)

1. \`sdd.js next\` lists what can start now (2 tasks at most). Delegate the listed tasks **in the same message** so, for example, an API and a screen move at once. **Never more than 2 subagents working at the same time, whatever their role** (backend, frontend, qa, reviewer…): more cannot be followed and burn tokens. A task that depends on a running one waits. Tests first.
2. When a subagent finishes: \`sdd.js verify --component <id>\`. If it fails, fix it (2 attempts at most). If it still fails, delegate to \`debugger\`, show its options and let the user choose.
3. Green: tick the task in tasks.md, then delegate to \`reviewer\` and \`doc-writer\`, in parallel only if no other subagent is working (otherwise one at a time, as slots free up). Fix the clear review findings inside the task; ask only if a finding changes the spec.
4. Call \`next\` again: a free slot or a finished dependency unblocks new tasks.
5. When a story (or the whole spec, per the configuration) is done: ${config.gates?.manual_test === 'none' ? 'no manual test is asked for.' : 'give the manual test (how to start it, URL or command, steps, test data, expected result per requirement) as a normal question. A failure starts the triage of that story; the rest go on.'} Then **propose the commit**: \`sdd.js commit-context\`, one message per repository with changes, following the project convention; if the user says yes, \`git add\` + \`git commit\`. Never push unless they ask.
6. Last story done: \`sdd.js validate\` (requirement → test) and give the verdict; the spec is closed as \`done\`.

## Things that come up

- **New work during implementation:** add it to tasks.md with its component, marked "${config.language?.specs === 'es' ? 'añadida en implementación' : 'added during implementation'}", and carry on. Say so in your summary. No need to ask.
- **The user changes or adds a requirement:** update the spec first (and plan/tasks), show the diff in a few lines and continue. Stop only if it contradicts something already built.
- **Configuration:** \`harness.config.yaml\` can change at any moment; the tool asks the user to confirm the edit and the harness regenerates the configuration on its own.
- **Alerts** (protected zone, code without a task, out of scope): they never stop you. Keep the documents in line (ADR draft, tasks.md) and mention it in your summary.
- **Dependencies:** installing one makes the tool ask the user; say why you need it.

## Shortcuts the user may type

\`/sdd:status\` (what happened), \`/sdd:spec\`, \`/sdd:next\`, \`/sdd:docs\`, \`/sdd:review\`, \`/sdd:validate\`, \`/sdd:commit\`. None of them is needed to approve or move on.

## Never

- Edit \`.harness/\` or generated files, or the generated block of AGENTS.md/CLAUDE.md.
- Push, rebase, reset or delete branches without the user asking.
- Finish with verification failing without telling the user.
- Leave a document out of date: every \`.md\` a change affects is updated with it.

## Languages

Talk to the user in ${l.talk}. Specs in ${l.specs}; docs and ADRs in ${l.docs}.
`,
    'spec-generator': `---
name: spec-generator
description: Interviews the user and writes a spec with numbered EARS requirements, or reviews one. Used by the sdd skill and the spec-reviewer subagent.
---

# Spec generator

## Writing a spec

1. \`node .harness/scripts/sdd.js new-spec <short name> [--component <id>] [--id <NNN>]\` creates the folder and the template (status: draft). Pass \`--id\` only when the user gives the number: in a team, specs created at the same time on other branches would take the same next number, so the number is agreed beforehand.
2. Ask one question at a time, six at most: goal, actors, main flows, rules and limits, errors, what is out of scope. Skip what the user already said.
3. Fill in the template:
   - Requirements in EARS, numbered \`RF-01\`, \`RF-02\`… and verifiable:
     - WHEN <event>, THE SYSTEM SHALL <response>.
     - IF <unwanted condition>, THEN THE SYSTEM SHALL <response>.
     - WHILE <state>, THE SYSTEM SHALL <response>.
     - WHERE <feature is included>, THE SYSTEM SHALL <response>.
     - THE SYSTEM SHALL <response> (always).
   - Every gap is written as \`[NEEDS CLARIFICATION: <question>]\`. Never invent the answer.
   - No stack, files, schemas or algorithms: that is the plan.
4. Back to the sdd skill for the review and the stop.

## Reviewing a spec

List, without fixing anything: ambiguities, contradictions, missing edge cases, untestable requirements, and conflicts with \`docs/constitution.md\`. Group them by severity.

Write specs in ${l.specs}.
`,
    'triage-report': `---
name: triage-report
description: Root-cause triage when a task cannot be fixed automatically. Produces a fixed report with options and stops. Use it in the debugger role and whenever sdd.js asks for triage.
---

# Triage report

Never change code during triage. Reproduce, read, reason, report.

Report, always in this order:

1. **Error**: the exact message and where it happens.
2. **Reproduction**: steps or command, and whether it always fails (a test that fails only sometimes is a possible flaky test: say so).
3. **Hypotheses**, most likely first, each with the evidence for and against.
4. **Options** (2 or 3): what to change, which files, which are outside the task scope or in protected zones, pros and cons, risk.
5. **Recommendation**: one option and why.

Then stop. The orchestrator shows the report and the user chooses.
`,
    adr: `---
name: adr
description: Writes Architecture Decision Records with the discarded alternatives. Use it for stack, architecture, database or security decisions, and for any change in a protected zone.
---

# ADR

1. \`node .harness/scripts/sdd.js new-adr <short name>\` creates \`docs/decisions/ADR-<NNNN>-<name>.md\`.
2. Fill in: context (the forces and constraints), decision, discarded alternatives with the reason for each, consequences (good and bad).
3. Status stays "Proposed" until the user approves the plan (or the change) it belongs to.

Write ADRs in ${l.docs}.
`,
  };
}
