# Proposing a skill for the registry

The curated registry (`src/skills/registry.json`) is the only source the harness installs third-party skills from (RF-SKL-05). Adding or changing an entry always goes through code review.

## Requirements for a skill

- Public GitHub repository with the skill in a folder that has a `SKILL.md`.
- Allowed license: MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause or ISC, declared in the repo or in the skill itself. No clear license, no entry.
- No self-running scripts. Examples or helper scripts are fine: the harness warns at install time and never runs them, but the review must check they are harmless.
- Useful for a specific role and stack.

## Registry entry

```json
{
  "name": "name-in-the-front-matter",
  "repo": "owner/repo",
  "path": "skills/name",
  "sha": "<40-character commit>",
  "hash": "<sha256 of the folder content>",
  "license": "MIT",
  "when": { "stack": ["react", "next"] },
  "roles": ["frontend-dev", "reviewer"]
}
```

| Field | Meaning |
|---|---|
| `sha` | Pinned commit. Never a branch. |
| `hash` | Content hash: recomputed at install time; a mismatch aborts (RF-SKL-06). |
| `when` | When a project needs it: `{ "always": true }`, `{ "kind": "frontend" }`, `{ "stack": [...] }` or `{ "design": "figma" }`. |
| `roles` | Which subagents load it (RF-SKL-12). |

## Computing the hash

```bash
node -e "
import('./src/skills/installer.js').then(async (m) => {
  const entry = { repo: 'owner/repo', path: 'skills/name', sha: '<sha>' };
  const { files } = await m.fetchSkill(entry);
  console.log(m.treeHash(files));
});"
```

## Pull request

1. Add the entry to `src/skills/registry.json`.
2. If the license or origin changes, update `NOTICE`.
3. Explain in the PR which role and stack it serves, and confirm you reviewed the content of the pinned commit.
4. Updating a skill = changing `sha` and `hash`. Projects see it with `sdd-harness skills update`, which shows the diff before applying.
