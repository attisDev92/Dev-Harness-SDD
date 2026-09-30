# Usage guide

This guide walks through sdd-harness end to end with Claude Code. For the reasons behind the design, see the [README](../../README.md).

## 1. Install

```bash
npm install -g github:attisDev92/Dev-Harness-SDD
sdd-harness --version
```

Requirements: Node.js 24 (LTS) or newer and Git. Nothing else is installed globally and `~/.claude` is never touched.

## 2. Activate a project

```bash
cd my-project
sdd-harness-init          # shortcut for: sdd-harness init
```

The interview detects and asks you to confirm:

| Question | What it decides |
|---|---|
| Topology | Single repo, monorepo, several repos or workspace (a folder with several repos) |
| Components | Paths, kind (frontend, backend, database, other) and verification commands. Specs are configured apart (`specs.id_prefix`, and `specs.location` in multi-repo/workspace) |
| Tools | Claude Code today |
| Conventions and languages | What the project already declares (AGENTS.md, CONTRIBUTING.md, linters, commit history) |
| Design, tracker, manual test | Design source, tracker (any), when you test |
| Mode | `local`: the team sees nothing · `team`: the configuration is committed |
| Git hooks, CI | Pre-commit with the same checks as CI · GitHub Actions template |
| Protected zones | Which changes need your approval and an ADR |

Before writing, it lists every file it will create or modify. Ctrl+C cancels without writing anything.

Without the interview: `sdd-harness-init --config preset.yaml --yes`.

Then:

```bash
sdd-harness doctor          # health and the real protection level
sdd-harness skills install  # verified third-party skills your stack needs
```

CLI messages are in Spanish; `--lang en` switches the ones that exist in English.

## 3. The flow in Claude Code

| Command | What happens | You |
|---|---|---|
| `/sdd:constitution` | Proposes 6–10 principles | Approve |
| `/sdd:spec <idea>` | Interview (max. 6 questions) and an EARS spec | Approve |
| `/sdd:clarify` | Spec review: gaps and contradictions | Approve |
| `/sdd:plan` | Technical plan, contracts and ADRs | Approve |
| `/sdd:tasks` | Tasks under 30 min with scope and "Done when" | Approve |
| `/sdd:next` | One task: tests first, verification, review | Test by hand: `OK` or `KO <what failed>` |
| `/sdd:validate` | Requirement by requirement: which test covers it | Approve |
| `/sdd:change <change>` | Spec first, with a diff | Approve |
| `/sdd:status` | Where we are and what blocks | — |
| `/sdd:commit` | Proposes the message per repo | **You commit** |
| `/sdd:tracker` | Syncs tasks.md with your tracker | Approve before it writes there |

You answer each decision with `/sdd:approve` or `/sdd:reject <reason>`. Only what you type counts: the agent cannot approve itself.

## 4. What the harness blocks

- Commits, push, merge, rebase, tags and remote changes, even chained, inside another shell, through aliases or in scripts.
- Installing or removing dependencies without your permission.
- Protected zones without an approved ADR.
- Documents outside the whitelist.
- Code outside the current task or its scope, or during triage.
- Finishing with red verification.
- Editing `harness.config.yaml`, `.harness/` or generated files.

`sdd-harness doctor` tells you what is really enforced and what only by instruction.

## 5. Maintenance

| Command | Purpose |
|---|---|
| `sdd-harness sync` | Regenerate after changing `harness.config.yaml` (shows the diff first) |
| `sdd-harness upgrade` | Move the project to a new harness version |
| `sdd-harness skills list \| install \| update \| verify` | Third-party skills |
| `sdd-harness contracts sync` | Refresh contract snapshots between repos |
| `sdd-harness tracker connect \| sync \| status` | GitHub Issues from the CLI; any other tracker with `/sdd:tracker` |
| `sdd-harness remove` | Remove the harness; `specs/` and `docs/` are never touched |

## 6. Several repositories

`sdd-harness workspace init` in a folder with several repos. Each repo keeps its specs; dependencies are written as `api#API-004` in the spec, and `sdd.js contract import api#API-004` copies the provider's contract with its origin.
