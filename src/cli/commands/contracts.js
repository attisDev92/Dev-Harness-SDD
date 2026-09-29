// sdd-harness contracts sync (RF-TOP-07/09/10): refreshes the snapshots of the
// provider contracts, showing the diff and asking first.

import { parseArgs } from '../../guards/args.js';
import { findProjectRoot, loadGuardSettings } from '../../guards/project.js';
import { listSnapshots, checkSnapshot, refreshSnapshot } from '../../guards/contracts.js';
import { unifiedDiff } from '../../engine/diff.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CancelledError, createLinePrompter, createScriptedPrompter } from '../prompt.js';

export async function contractsCommand(argv, { io, tc }) {
  const out = (s) => io.stdout.write(`${s}\n`);
  const err = (s) => io.stderr.write(`${s}\n`);
  const { flags, positional } = parseArgs(argv, { boolean: ['yes', 'dry-run'] });
  if (positional[0] !== 'sync') {
    err(tc.contracts.usage);
    return 1;
  }
  const root = findProjectRoot(io.cwd);
  if (!root) {
    err(tc.contracts.notActivated);
    return 1;
  }
  const settings = loadGuardSettings(root);
  const snaps = listSnapshots(root, settings);
  if (!snaps.length) {
    out(tc.contracts.none);
    return 0;
  }
  const prompter = io.prompter ?? (flags.yes || flags['dry-run'] ? createScriptedPrompter({}) : createLinePrompter({ input: io.stdin, output: io.stdout, t: tc }));
  let ok = 0;
  try {
    for (const snap of snaps) {
      const check = checkSnapshot(root, snap);
      if (check.status === 'ok') { ok += 1; continue; }
      if (check.status === 'unavailable') { out(tc.contracts.unavailable(snap)); continue; }
      out(tc.contracts.stale(snap));
      out(unifiedDiff(readFileSync(path.join(root, snap.snapshot), 'utf8'), check.current, snap.snapshot));
      if (flags['dry-run']) continue;
      const accept = flags.yes || (await prompter.confirm(`contract:${snap.snapshot}`, tc.contracts.confirm(snap), { default: true }));
      if (!accept) { out(tc.contracts.kept(snap)); continue; }
      refreshSnapshot(root, snap, check.current, check.commit);
      out(tc.contracts.updated(snap));
    }
  } catch (e) {
    if (e instanceof CancelledError) return 130;
    throw e;
  } finally {
    prompter.close();
  }
  if (ok) out(tc.contracts.upToDate(ok));
  return 0;
}
