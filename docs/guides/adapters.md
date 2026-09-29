# Adapters

An adapter translates the neutral harness into one agent tool's native files (RF-ADP-01…06). The core never changes when a tool is added.

## Pipeline

```
harness.config.yaml
  → generateCore     AGENTS.md, templates, .harness/scripts, canonical skills
  → adapters         one per tool in `tools`
  → git hooks, CI    universal safety net
  → finalize         .harness/guards.json, .git/info/exclude, size checks
  → planChanges      diff against disk and manifest, conflicts, transaction
```

Entry point: `src/generate/index.js`.

## Interface

```js
export const id = 'my-tool';                 // value used in harness.config.yaml → tools
export const RULES = ['commits', 'deps', 'protected', 'docs', 'retries', 'verify', 'lanes'];

export function generate(config, { tracked, skills }) {
  return { entries, notices };
}
```

Register it in `ADAPTERS` in `src/generate/index.js`.

### Entries

| Kind | Fields | Use |
|---|---|---|
| `file` | `path`, `content`, `executable?` | A file the harness owns (agents, commands, skill copies) |
| `block` | `path`, `content`, `style?` (`html` or `hash`) | A managed block inside a file the user owns |
| `json` | `path`, `values` (dotted keys), `appends` (dotted key → items) | Settings merged key by key; `appends` adds items to arrays without touching the user's items |

Every entry carries `tool: id`. The entry that wires the guards into the tool also carries `enforces: RULES`: `sdd-harness doctor` counts a rule as deterministic only while that entry is intact on disk.

### Rules

| Rule | Guard |
|---|---|
| `commits` | `.harness/scripts/hook.js` → `bash-guard.js` → `git-guard.js` |
| `deps` | `bash-guard.js` (installs) and `files-guard.js` (manifests, lockfiles) → *ask* |
| `protected` | `files-guard.js` and shell write targets |
| `docs` | `files-guard.js` → `docs-guard.js` |
| `retries` | `sdd.js verify` → `retry.js` |
| `verify` | Stop hook and `sdd.js task done` |
| `lanes` | before/after snapshot around each subagent |

### Local and team mode

In local mode an adapter must not write to committed files (RF-MOD-02). Check `tracked` and, when the only way to configure the tool is a committed file, return a `toolNeedsTeam` notice instead of the entry (RF-MOD-04).

### Hook payloads

`src/guards/hook.js` reads Claude Code's payload. A tool with another payload format needs its own thin entry script that normalises the payload and calls the same guards (`checkShell`, `checkWrite`, `decide`…). The guards themselves are tool-neutral.

## Tools without subagents or blocking hooks

Degraded mode (RF-ORQ-11, v0.6) runs the roles one after another in the same agent. Rules that the tool cannot block are listed in `RULES` only for what is really wired; everything else is reported by `doctor` as instruction-only (RF-ADP-03).
