// sdd-harness-init (RF-INI-01..18).

import { existsSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from '../../guards/args.js';
import { CONFIG_FILE } from '../../guards/project.js';
import { loadConfigFile } from '../../config/load.js';
import { validateConfig, TOOLS } from '../../config/schema.js';
import { issueLines, serializeConfig } from '../../config/format.js';
import { detectProject } from '../../detect/project.js';
import { planChanges } from '../../engine/plan.js';
import { MANIFEST_FILE, serializeManifest } from '../../engine/manifest.js';
import { applyChanges } from '../../engine/transaction.js';
import { runInterview } from '../interview.js';
import { CancelledError, createLinePrompter, createScriptedPrompter } from '../prompt.js';
import { buildDesired, gitConfigAccess, makeReader, makeResolver, missingDirs, planGitConfig, renderDiffs, renderErrors, renderNotices, renderReport } from './common.js';

/**
 * @param {string[]} argv
 * @param {{ io: object, t: object, tc: object, lang: string, version: string }} ctx
 */
export async function initCommand(argv, { io, t, tc, lang, version, presetTopology }) {
  const out = (s) => io.stdout.write(s + '\n');
  const err = (s) => io.stderr.write(s + '\n');
  const { flags, unknown } = parseArgs(argv, { string: ['config', 'tools', 'mode'], boolean: ['yes', 'dry-run'] });
  if (unknown.length) {
    err(t.unknownOption(unknown[0]));
    return 1;
  }
  const root = path.resolve(io.cwd);

  // RF-INI-16: never reinstall over an activated project.
  if (existsSync(path.join(root, CONFIG_FILE))) {
    err(tc.init.already);
    return 1;
  }
  const detected = detectProject(root);
  // Edge case 1: a folder without git is only accepted as a workspace.
  if (!detected.isRepo && !detected.childRepos.length) {
    err(tc.init.noGit);
    return 1;
  }

  const tools = flags.tools ? flags.tools.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
  const badTool = tools?.find((x) => !TOOLS.includes(x));
  if (badTool) {
    err(`--tools: ${t.issue.enum({ value: badTool, allowed: TOOLS })}`);
    return 1;
  }
  if (flags.mode && !['local', 'team'].includes(flags.mode)) {
    err(`--mode: ${t.issue.enum({ value: flags.mode, allowed: ['local', 'team'] })}`);
    return 1;
  }

  const prompter = io.prompter ?? (flags.yes ? createScriptedPrompter({}, { output: io.stdout }) : createLinePrompter({ input: io.stdin, output: io.stdout, t: tc }));
  try {
    let config;
    if (flags.config) {
      // RF-INI-15: configuration from a file, without interview.
      const file = path.resolve(root, flags.config);
      const loaded = loadConfigFile(file);
      if (!loaded.ok) {
        err(tc.init.badConfig(flags.config));
        issueLines(loaded.issues, t, flags.config).forEach(err);
        return 1;
      }
      config = loaded.config;
    } else {
      config = await runInterview({ detected, prompter, t: tc, lang, version, preset: { tools, mode: flags.mode, topology: presetTopology } });
    }
    const issues = validateConfig(config);
    if (issues.length) {
      err(tc.init.badConfig(CONFIG_FILE));
      issueLines(issues, t, CONFIG_FILE).forEach(err);
      return 1;
    }

    const { entries, notices, gitConfig } = buildDesired(config, root);
    const git = planGitConfig(root, gitConfig, null);
    const plan = await planChanges({
      desired: entries,
      manifest: null,
      read: makeReader(root),
      resolve: makeResolver({ prompter, t: tc, yes: flags.yes, out }),
    });
    const changes = [{ path: CONFIG_FILE, before: null, after: serializeConfig(config) }, ...plan.changes];
    const dirs = missingDirs(root, [...changes.map((c) => c.path), MANIFEST_FILE]);
    changes.push({
      path: MANIFEST_FILE,
      before: null,
      after: serializeManifest({
        harnessVersion: config.harness_version,
        installMode: config.install_mode ?? 'local',
        entries: [{ kind: 'config', path: CONFIG_FILE }, ...plan.entries, ...git.entries],
        dirs,
        notices,
      }),
    });

    // RF-INI-13: everything that will be written, before writing anything.
    out('');
    out(tc.init.summary);
    out(`  + ${CONFIG_FILE}  (${tc.action.create})`);
    renderReport(plan.report, tc).forEach(out);
    out(`  + ${MANIFEST_FILE}  (${tc.action.create})`);
    for (const c of git.changes) out(`  ~ ${c.repo ? `${c.repo}: ` : ""}${tc.gitConfig(c.key, c.after)}`);
    if (notices.length || plan.errors.length) {
      out(tc.init.notices);
      renderNotices(notices, tc).forEach(out);
      renderErrors(plan.errors, tc).forEach(out);
    }
    if (flags['dry-run']) {
      out(renderDiffs(changes));
      out(tc.init.dryRun);
      return 0;
    }
    if (!flags.yes && !(await prompter.confirm('apply', tc.init.confirm, { default: true }))) {
      err(tc.init.cancelled);
      return 1;
    }
    try {
      applyChanges(root, changes, { fs: io.fs, configChanges: git.changes, gitConfig: gitConfigAccess(root) });
    } catch (e) {
      // RF-INI-18: the transaction already restored every file.
      err(tc.init.failed(e.message));
      return 1;
    }
    out(tc.init.done(changes.length));
    out(tc.init.next);
    return 0;
  } catch (e) {
    if (e instanceof CancelledError) {
      err(tc.init.cancelled);
      return 130;
    }
    throw e;
  } finally {
    prompter.close();
  }
}
