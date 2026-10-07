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
| Git hooks, CI | Pre-commit that only refuses secrets · GitHub Actions template with docs and verification |
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

Tell the agent what you want to build ("I want an email login") and the `sdd` skill does the rest:

1. **Spec**: an interview (max. 6 questions), EARS requirements and a review. 🛑 **Stop 1**: you approve the spec.
2. **Plan and tasks**: the architect writes the plan, contracts, ADRs and `tasks.md` in one go. 🛑 **Stop 2**: you approve the plan with its tasks.
3. **Implementation**: frontend and backend in parallel, tests first. After each task, verification and, in parallel, review and documentation.
4. **When a story closes**: a manual test (a normal question) and the agent **proposes the commit**; if you say yes, it commits.
5. **At the end**: requirement-by-requirement validation; the spec is marked `done`.

**To approve, just talk**: "yes", "continue", "approved", "go ahead" or the "Approve" button. Anything else counts as changes.

Without stopping the flow:

- **Tasks that come up**: the agent adds them to `tasks.md` ("added during implementation") and tells you.
- **Requirement changes**: the spec is updated first (with a diff) and work goes on.
- **`harness.config.yaml`**: change it whenever you want; Claude Code asks you to confirm the edit and the configuration is regenerated on its own.

Optional shortcuts (none is needed to move on):

| Command | What for |
|---|---|
| `/sdd:status` | What happened: spec and status, last tasks closed, pending ones, last verification and last commits |
| `/sdd:spec <idea>` | Start a spec |
| `/sdd:next` | Launch the ready tasks in parallel |
| `/sdd:docs` | Bring the documentation up to date in the background |
| `/sdd:review` | Review (and QA) of the changes, in parallel |
| `/sdd:validate` | Requirement → test report |
| `/sdd:commit` | Propose the commit now |
| `/sdd:tracker` | Sync `tasks.md` with your tracker |

The state is visible: `status` in the frontmatter of `spec.md` (`draft` → `spec-approved` → `plan-approved` → `done`) and the checkboxes of `tasks.md`.

## 4. What the harness asks and what it blocks

- **Asks (Claude Code's native confirmation)**: `git push`, `rebase`, `merge`, `reset --hard`, deleting branches, tags, installing dependencies and editing `harness.config.yaml`.
- **Alerts, without stopping**: protected zones (with an ADR draft, except migrations already in the data model of the approved plan), code without a task or out of its scope, dependency or lockfile changes, a subagent writing outside its paths.
- **Reminds once**: finishing with verification failing.
- **Blocks**: only `.harness/`, generated files and the generated block of `AGENTS.md`/`CLAUDE.md`. The pre-commit only refuses secrets and `.env`.

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
