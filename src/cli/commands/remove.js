// sdd-harness remove (RF-REM-01..08, RNF-06).

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readLock as readSkillsLock, LOCK_FILE as SKILLS_LOCK } from '../../skills/installer.js';
import path from 'node:path';
import { parseArgs } from '../../guards/args.js';
import { CONFIG_FILE, findProjectRoot } from '../../guards/project.js';
import { findBlock } from '../../engine/blocks.js';
import { planChanges } from '../../engine/plan.js';
import { MANIFEST_FILE, readManifest } from '../../engine/manifest.js';
import { applyChanges } from '../../engine/transaction.js';
import { gitPath, gitTopLevel } from '../../engine/git.js';
import { posix } from '../../engine/text.js';
import { CancelledError, createLinePrompter, createScriptedPrompter } from '../prompt.js';
import { gitConfigAccess, makeReader, makeResolver, renderErrors, renderReport } from './common.js';

/** RF-REM-05: artifacts are the developer's; remove never touches them. */
const isArtifact = (p) => /^(specs|docs)(\/|$)/.test(posix(p));

function filesUnder(root, rel) {
  const dir = path.join(root, rel);
  if (!existsSync(dir)) return [];
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else out.push(posix(path.relative(root, full)));
    }
  };
  walk(dir);
  return out;
}

/** RF-REM-08: what looks generated when the manifest cannot be trusted. */
function candidates(root) {
  const read = makeReader(root);
  const found = [];
  if (existsSync(path.join(root, CONFIG_FILE))) found.push(CONFIG_FILE);
  if (existsSync(path.join(root, '.harness'))) found.push('.harness/');
  for (const f of ['AGENTS.md', 'CLAUDE.md', 'CLAUDE.local.md']) {
    const text = read(f);
    if (text && findBlock(text).status !== 'absent') found.push(`${f} (harness block)`);
  }
  if (gitTopLevel(root)) {
    const exclude = gitPath(root, 'info/exclude');
    const text = exclude && read(exclude);
    if (text && findBlock(text, 'hash').status !== 'absent') found.push(`${exclude} (harness block)`);
  }
  return found;
}

export async function removeCommand(argv, { io, t, tc }) {
  const out = (s) => io.stdout.write(s + '\n');
  const err = (s) => io.stderr.write(s + '\n');
  const { flags, unknown } = parseArgs(argv, { boolean: ['yes', 'dry-run'] });
  if (unknown.length) {
    err(t.unknownOption(unknown[0]));
    return 1;
  }
  const root = findProjectRoot(io.cwd) ?? path.resolve(io.cwd);
  const { status, manifest } = readManifest(root);
  if (status !== 'ok') {
    const found = candidates(root);
    if (!found.length) {
      out(tc.remove.nothing);
      return 0;
    }
    err(tc.remove.noManifest(status));
    found.forEach((f) => err(`  ? ${f}`));
    err(tc.remove.noManifestHint);
    return 1;
  }

  const prompter = io.prompter ?? (flags.yes || flags['dry-run'] ? createScriptedPrompter({}, { output: io.stdout }) : createLinePrompter({ input: io.stdin, output: io.stdout, t: tc }));
  try {
    const owned = manifest.entries.filter((e) => !isArtifact(e.path ?? ''));
    const plan = await planChanges({
      desired: [],
      manifest: { ...manifest, entries: owned },
      read: makeReader(root),
      resolve: makeResolver({ prompter, t: tc, yes: flags.yes || flags['dry-run'], out }),
    });
    const changes = plan.changes.filter((c) => !isArtifact(c.path));
    const read = makeReader(root);
    const lines = renderReport(plan.report, tc);

    // The configuration, the manifest and runtime data (state and logs).
    const extraFiles = [
      ...manifest.entries.filter((e) => e.kind === 'config').map((e) => e.path),
      ...filesUnder(root, '.harness/state'),
      ...filesUnder(root, '.harness/logs'),
      MANIFEST_FILE,
    ];
    for (const f of [...new Set(extraFiles)]) {
      if (!existsSync(path.join(root, f)) || !statSync(path.join(root, f)).isFile()) continue;
      changes.push({ path: f, before: read(f), after: null });
      lines.push(`  - ${f}  (${tc.action.delete})`);
    }

    // Third-party skills from skills.lock: removed if intact, kept if edited by hand.
    const skillDirs = new Set();
    for (const s of Object.values(readSkillsLock(root).skills)) {
      for (const [rel, hash] of Object.entries(s.files ?? {})) {
        const file = path.join(root, rel);
        if (!existsSync(file)) continue;
        if (createHash('sha256').update(readFileSync(file)).digest('hex') !== hash) {
          lines.push(`  ! ${tc.remove.kept(rel)}`);
          continue;
        }
        changes.push({ path: rel, before: read(rel), after: null });
        for (let d = path.posix.dirname(rel); d.includes('/skills/'); d = path.posix.dirname(d)) skillDirs.add(d);
      }
    }
    if (existsSync(path.join(root, SKILLS_LOCK))) {
      changes.push({ path: SKILLS_LOCK, before: read(SKILLS_LOCK), after: null });
      lines.push(`  - ${SKILLS_LOCK}  (${tc.action.delete})`);
    }

    // RF-REM-07: core.hooksPath back to what it was.
    const configChanges = manifest.entries
      .filter((e) => e.kind === 'git-config')
      .map((e) => ({ type: 'git-config', repo: e.repo ?? '', key: e.key, after: e.hadPrevious ? e.previous : null }));
    for (const c of configChanges) lines.push(`  ~ ${c.repo ? `${c.repo}: ` : ''}${tc.remove.hooksPath(c.after)}`);

    out(tc.remove.list);
    lines.forEach(out);
    renderErrors(plan.errors, tc).forEach(err);
    if (flags['dry-run']) return 0;
    if (!flags.yes && !(await prompter.confirm('apply', tc.remove.confirm, { default: false }))) {
      out(tc.sync.aborted);
      return 1;
    }
    const pruneDirs = [...(manifest.dirs ?? []), ...skillDirs, '.harness/state', '.harness/logs', '.harness'];
    try {
      applyChanges(root, changes, { fs: io.fs, configChanges, gitConfig: gitConfigAccess(root), pruneDirs });
    } catch (e) {
      err(tc.remove.failed(e.message));
      return 1;
    }
    out(tc.remove.done);
    return plan.errors.length ? 1 : 0;
  } catch (e) {
    if (e instanceof CancelledError) {
      out(tc.sync.aborted);
      return 130;
    }
    throw e;
  } finally {
    prompter.close();
  }
}
