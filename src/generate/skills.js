// The harness's own skills needed by the SDD flow (RF-SKL-01, partial: the
// rest of the list arrives with the registry in v0.7). Canonical copies go to
// .agents/skills/ (RF-GEN-05); tools that need another path get copies.

const S = (lang) => ({
  talk: lang.cli === 'es' ? 'Spanish' : 'English',
  specs: lang.specs === 'es' ? 'Spanish' : 'English',
  docs: lang.docs === 'es' ? 'Spanish' : 'English',
});

export function ownSkills(config) {
  const l = S({ cli: config.cli?.language ?? config.language?.docs, specs: config.language?.specs, docs: config.language?.docs });
  return {
    'sdd-orchestrator': `---
name: sdd-orchestrator
description: Runs the Spec-Driven Development flow of this project with sdd-harness. Use it for every /sdd:* command, and whenever you are about to change code, start or finish a task, or need the user's approval.
---

# SDD orchestrator

You are the orchestrator. You run in the main session; subagents cannot start other subagents, so you delegate each step to the right role and you own the gates.

## State lives in scripts, not in your memory

\`node .harness/scripts/sdd.js <command>\` is the source of truth. Run it; never simulate it.

| Need | Command |
|---|---|
| Where are we? | \`sdd.js status\` |
| New spec | \`sdd.js new-spec <name> [--component <id>]\` |
| New ADR draft | \`sdd.js new-adr <name>\` |
| Ask the user to decide | \`sdd.js gate request <constitution\\|spec\\|clarify\\|plan\\|tasks\\|review\\|manual-test\\|protected\\|change\\|triage\\|lanes\\|validate>\` |
| Next task | \`sdd.js next\` |
| Verify the current task | \`sdd.js verify\` |
| Close the task | \`sdd.js task done <T#>\` |
| Start triage | \`sdd.js triage start\` |
| Change an approved spec | \`sdd.js change start\` |
| Requirement coverage | \`sdd.js validate\` |
| Commit proposal input | \`sdd.js commit-context\` |
| Structural checks | \`sdd.js lint <spec\\|tasks\\|constitution>\` |

If a script refuses (exit code 2), read its reason and follow it. Hooks enforce the same rules: a blocked tool call is a signal to stop, not an obstacle to work around.

## Phases

constitution → spec → clarify → plan → tasks → implement (one task at a time) → validate → change.

- Never move to the next phase without the user's approval: request the gate and stop.
- The user answers with \`/sdd:approve\`, \`/sdd:reject <reason>\`, or OK / KO for manual tests. Only their message counts; you cannot approve for them.

## One task (/sdd:next)

1. \`sdd.js next\` gives the task, its scope, requirements and role.
2. Delegate to that role (\`frontend-dev\` or \`backend-dev\`). Tests first, then code, only inside the scope.
3. \`sdd.js verify\`. If it fails, fix only inside the scope; the script counts the attempts (2 at most) and switches to triage when needed.
4. Delegate to \`reviewer\`: spec compliance first, then quality and security. If there are findings, show them and request the \`review\` gate; wait.
5. Request \`manual-test\` and give the user: how to start the app, URL or command, steps, test data and the expected result per requirement.
6. On OK: \`sdd.js task done <T#>\`. On KO: triage.

## Triage

\`sdd.js triage start\`, delegate to \`debugger\` (read-only), present its report, request the \`triage\` gate. Apply only the option the user chose. No code changes during triage.

## Never

- Commit, push, merge, rebase, tag, or reset. Use /sdd:commit to propose messages.
- Install or remove dependencies without the user's approval.
- Edit protected zones without an approved ADR: propose what, why, alternatives and an ADR draft, then request the \`protected\` gate.
- Create documentation outside the whitelist.
- Edit \`harness.config.yaml\`, \`.harness/\` or generated files.

## Languages

Talk to the user in ${l.talk}. Specs in ${l.specs}; docs and ADRs in ${l.docs}.
`,
    'spec-generator': `---
name: spec-generator
description: Interviews the user and writes or reviews a spec with numbered EARS requirements. Use it for /sdd:spec and, in review mode, for /sdd:clarify.
---

# Spec generator

## Writing a spec (/sdd:spec)

1. \`node .harness/scripts/sdd.js new-spec <short name> [--component <id>]\` creates the folder and the template.
2. Ask one question at a time, six at most: goal, actors, main flows, rules and limits, errors, what is out of scope.
3. Fill in the template:
   - Requirements in EARS, numbered \`RF-01\`, \`RF-02\`… and verifiable:
     - WHEN <event>, THE SYSTEM SHALL <response>.
     - IF <unwanted condition>, THEN THE SYSTEM SHALL <response>.
     - WHILE <state>, THE SYSTEM SHALL <response>.
     - WHERE <feature is included>, THE SYSTEM SHALL <response>.
     - THE SYSTEM SHALL <response> (always).
   - Every gap is written as \`[NEEDS CLARIFICATION: <question>]\`. Never invent the answer.
   - No stack, files, schemas or algorithms: that is the plan.
4. \`sdd.js lint spec\` must pass, then \`sdd.js gate request spec\` and stop.

## Reviewing a spec (/sdd:clarify)

List, without fixing anything: ambiguities, contradictions, missing edge cases, untestable requirements, and conflicts with \`docs/constitution.md\`. Group them by severity. Then request the \`clarify\` gate.

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

Then stop. The orchestrator requests the \`triage\` gate and the user chooses.
`,
    adr: `---
name: adr
description: Writes Architecture Decision Records with the discarded alternatives. Use it for stack, architecture, database or security decisions, and for any change in a protected zone.
---

# ADR

1. \`node .harness/scripts/sdd.js new-adr <short name>\` creates \`docs/decisions/ADR-<NNNN>-<name>.md\`.
2. Fill in: context (the forces and constraints), decision, discarded alternatives with the reason for each, consequences (good and bad).
3. Status stays "Proposed" until the user approves the related gate.

Write ADRs in ${l.docs}.
`,
  };
}
