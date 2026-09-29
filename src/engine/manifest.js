// .harness/manifest.lock (RF-GEN-08, RF-MRG-05): what the harness generated,
// with hashes, so sync can detect hand edits and remove can revert exactly.

import { readFileSync } from 'node:fs';
import path from 'node:path';

export const MANIFEST_FILE = '.harness/manifest.lock';

/**
 * @typedef {{ kind: 'file', path: string, hash: string, generator: string }
 *   | { kind: 'block', path: string, hash: string, generator: string, style?: string, createdFile: boolean }
 *   | { kind: 'json', path: string, generator: string, createdFile: boolean, keys: Record<string, { hash: string, hadPrevious: boolean, previous?: unknown }> }
 *   | { kind: 'config', path: string }
 *   | { kind: 'git-config', key: string, hadPrevious: boolean, previous?: string }} ManifestEntry
 */

/** @returns {{ status: 'ok' | 'missing' | 'corrupt', manifest: object | null }} */
export function readManifest(root) {
  let text;
  try {
    text = readFileSync(path.join(root, MANIFEST_FILE), 'utf8');
  } catch {
    return { status: 'missing', manifest: null };
  }
  try {
    const data = JSON.parse(text);
    if (!data || data.version !== 1 || !Array.isArray(data.entries)) return { status: 'corrupt', manifest: null };
    return { status: 'ok', manifest: data };
  } catch {
    return { status: 'corrupt', manifest: null };
  }
}

export function entryKey(e) {
  return e.kind === 'git-config' ? `git-config:${e.key}` : `${e.kind}:${e.path}`;
}

/** Stable serialisation: sync without changes rewrites identical bytes (RF-GEN-13). */
export function serializeManifest({ harnessVersion, installMode, entries, dirs = [], notices = [] }) {
  const sorted = [...entries].sort((a, b) => entryKey(a).localeCompare(entryKey(b)));
  return JSON.stringify(
    {
      version: 1,
      harness_version: harnessVersion,
      install_mode: installMode,
      entries: sorted,
      dirs: [...new Set(dirs)].sort(),
      notices,
    },
    null,
    2,
  ) + '\n';
}
