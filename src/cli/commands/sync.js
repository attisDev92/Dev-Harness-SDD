// sdd-harness sync (RF-GEN-09..13, RF-MOD-06, edge cases 7, 8, 24, 25).

import path from 'node:path';
import { parseArgs } from '../../guards/args.js';
import { CONFIG_FILE, findProjectRoot } from '../../guards/project.js';
import { loadConfigFile } from '../../config/load.js';
import { issueLines } from '../../config/format.js';
import { planChanges } from '../../engine/plan.js';
import { MANIFEST_FILE, readManifest, serializeManifest } from '../../engine/manifest.js';
import { applyChanges } from '../../engine/transaction.js';
import { lockIsFresh, readLock } from '../../guards/state.js';
import { CancelledError, createLinePrompter, createScriptedPrompter } from '../prompt.js';
import { buildDesired, compareVersions, gitConfigAccess, makeReader, makeResolver, missingDirs, planGitConfig, renderDiffs, renderErrors, renderNotices, renderReport } from './common.js';

export async function syncCommand(argv, { io, t, tc, version, override }) {
  const out = (s) => io.stdout.write(s + '\n');
  const err = (s) => io.stderr.write(s + '\n');
  const { flags, unknown } = parseArgs(argv, { boolean: ['yes', 'dry-run'] });
  if (unknown.length) {
    err(t.unknownOption(unknown[0]));
    return 1;
  }
  const root = findProjectRoot(io.cwd);
  if (!root) {
    err(tc.sync.notActivated);
    return 1;
  }
  // RF-GEN-12: an invalid configuration stops everything.
  // `sdd-harness upgrade` passes the migrated configuration, written in the same transaction.
  const loaded = override ?? loadConfigFile(path.join(root, CONFIG_FILE));
  if (!loaded.ok) {
    err(tc.init.badConfig(CONFIG_FILE));
    issueLines(loaded.issues, t, CONFIG_FILE).forEach(err);
    return 1;
  }
  const config = loaded.config;
  const cmp = compareVersions(config.harness_version, version);
  if (override) {
    // The version change is the point of the upgrade.
  } else if (cmp > 0) err(`! ${tc.sync.projectNewer(config.harness_version, version)}`);
  else if (cmp < 0) err(`! ${tc.sync.versionMismatch(config.harness_version, version)}`);

  const { status, manifest } = readManifest(root);
  if (status !== 'ok') out(tc.sync.rebuild(status));

  const dryRun = flags['dry-run'];
  const prompter = io.prompter ?? (flags.yes || dryRun ? createScriptedPrompter({}, { output: io.stdout }) : createLinePrompter({ input: io.stdin, output: io.stdout, t: tc }));
  try {
    // Edge case 26: an agent session is running tasks; wait for it or cancel.
    if (!dryRun && lockIsFresh(readLock(root))) {
      const holder = readLock(root);
      err(tc.sync.locked(holder.session));
      if (flags.yes || !(await prompter.confirm('waitLock', tc.sync.waitLock, { default: true }))) {
        out(tc.sync.aborted);
        return 1;
      }
      const deadline = Date.now() + (io.lockWaitMs ?? 10 * 60 * 1000);
      while (lockIsFresh(readLock(root))) {
        if (Date.now() > deadline) {
          out(tc.sync.aborted);
          return 1;
        }
        await new Promise((r) => setTimeout(r, io.lockPollMs ?? 2000));
      }
    }
    const { entries, notices, gitConfig } = buildDesired(config, root);
    const git = planGitConfig(root, gitConfig, manifest);
    const plan = await planChanges({
      desired: entries,
      manifest,
      read: makeReader(root),
      resolve: makeResolver({ prompter, t: tc, yes: flags.yes || dryRun, out }),
    });
    const owned = plan.entries.filter((e) => e.kind !== 'config' && e.kind !== 'git-config');
    const extra = [{ kind: 'config', path: CONFIG_FILE }, ...git.entries];
    const dirs = [...(manifest?.dirs ?? []), ...missingDirs(root, plan.changes.filter((c) => c.after !== null).map((c) => c.path))];
    const manifestText = serializeManifest({
      harnessVersion: manifest?.harness_version ?? config.harness_version,
      installMode: config.install_mode ?? 'local',
      entries: [...extra, ...owned],
      dirs,
      notices,
    });
    const read = makeReader(root);
    const changes = [...plan.changes];
    if (override) changes.unshift({ path: CONFIG_FILE, before: read(CONFIG_FILE), after: override.text });
    const currentManifest = read(MANIFEST_FILE);
    if (currentManifest !== manifestText) changes.push({ path: MANIFEST_FILE, before: currentManifest, after: manifestText });

    if (notices.length || plan.errors.length) {
      renderNotices(notices, tc).forEach(out);
      renderErrors(plan.errors, tc).forEach(err);
    }
    const visible = changes.filter((c) => c.path !== MANIFEST_FILE);
    const applyAll = (extraOpts = {}) => applyChanges(root, changes, { fs: io.fs, configChanges: git.changes, gitConfig: gitConfigAccess(root), ...extraOpts });
    if (!visible.length && !git.changes.length) {
      // RF-GEN-13: nothing changes; only a rebuilt manifest may be written.
      if (changes.length && !dryRun) applyAll();
      out(tc.sync.nothing);
      return plan.errors.length ? 1 : 0;
    }

    // RF-GEN-09 / RF-GEN-10: the diff always comes first.
    out(tc.sync.changes);
    renderReport(plan.report, tc).forEach(out);
    for (const c of git.changes) out(`  ~ ${c.repo ? `${c.repo}: ` : ""}${tc.gitConfig(c.key, c.after)}`);
    out('');
    out(renderDiffs(visible));
    if (dryRun) {
      out(tc.sync.dryRun);
      return 0;
    }
    if (!flags.yes && !(await prompter.confirm('apply', tc.sync.confirm, { default: true }))) {
      out(tc.sync.aborted);
      return 1;
    }
    try {
      applyAll({ pruneDirs: manifest?.dirs ?? [] });
    } catch (e) {
      err(tc.sync.failed(e.message));
      return 1;
    }
    out(tc.sync.done(visible.length));
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
