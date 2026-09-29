// Contract snapshots between repositories (RF-TOP-06..10). Dependency-free.
//
// The provider owns the contract (specs/<ID>/contracts/<file>). A consumer
// keeps a copy in specs/<ID>/contracts/external/<repo>-<file> plus a
// <copy>.source.json with the origin: repo, spec, path, commit and hash.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolveSpecRef, specRoots } from './tasks.js';

const posix = (p) => p.split(path.sep).join('/');
const hash = (text) => createHash('sha256').update(String(text).replace(/\r\n?/g, '\n')).digest('hex');

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  return r.status === 0 ? r.stdout.trim() : null;
}

/** Repository that contains `dir`: its top-level folder and HEAD commit. */
function repoOf(dir) {
  const top = git(dir, ['rev-parse', '--show-toplevel']);
  return { top: top ? path.resolve(top) : null, commit: top ? git(dir, ['rev-parse', 'HEAD']) : null };
}

/**
 * RF-TOP-06: copies the provider's contract into the consumer spec.
 * @returns {{ ok: true, snapshot: string, source: object } | { ok: false, code: string, params?: object }}
 */
export function importContract(root, settings, { ref, file, targetDir }) {
  const provider = resolveSpecRef(root, settings, ref);
  if (!provider) return { ok: false, code: 'noProvider', params: { ref } };
  const dir = path.join(root, provider.dir, 'contracts');
  const files = existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name).sort() : [];
  const name = file ?? files[0];
  if (!name || !files.includes(name)) return { ok: false, code: 'noContract', params: { spec: provider.id, files } };
  const from = path.join(dir, name);
  const content = readFileSync(from, 'utf8');
  const repo = repoOf(dir);
  const repoName = repo.top ? path.basename(repo.top) : path.basename(root);
  const dest = path.join(targetDir, 'contracts', 'external', `${repoName}-${name}`);
  const source = {
    repo: repoName,
    repo_path: repo.top ? posix(path.relative(root, repo.top)) || '.' : '.',
    spec: provider.id,
    path: posix(path.relative(root, from)),
    commit: repo.commit,
    hash: hash(content),
  };
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(dest, content);
  writeFileSync(`${dest}.source.json`, JSON.stringify(source, null, 2) + '\n');
  return { ok: true, snapshot: posix(path.relative(root, dest)), source };
}

/** Every snapshot of the project with its origin. */
export function listSnapshots(root, settings) {
  const out = [];
  for (const rel of specRoots(settings)) {
    const specsDir = path.join(root, rel);
    if (!existsSync(specsDir)) continue;
    for (const spec of readdirSync(specsDir, { withFileTypes: true }).filter((e) => e.isDirectory())) {
      const ext = path.join(specsDir, spec.name, 'contracts', 'external');
      if (!existsSync(ext)) continue;
      for (const f of readdirSync(ext).filter((n) => n.endsWith('.source.json'))) {
        const sidecar = path.join(ext, f);
        try {
          out.push({ snapshot: posix(path.relative(root, sidecar.slice(0, -'.source.json'.length))), sidecar: posix(path.relative(root, sidecar)), source: JSON.parse(readFileSync(sidecar, 'utf8')) });
        } catch {
          out.push({ snapshot: posix(path.relative(root, sidecar)), sidecar: posix(path.relative(root, sidecar)), source: null });
        }
      }
    }
  }
  return out;
}

/**
 * RF-TOP-08/09: compares a snapshot with its provider.
 * @returns {{ status: 'ok' | 'stale' | 'unavailable', current?: string, commit?: string | null }}
 */
export function checkSnapshot(root, snap) {
  const providerFile = snap.source ? path.join(root, snap.source.path) : null;
  if (!providerFile || !existsSync(providerFile)) return { status: 'unavailable' };
  const current = readFileSync(providerFile, 'utf8');
  if (hash(current) === snap.source.hash) return { status: 'ok' };
  return { status: 'stale', current, commit: repoOf(path.dirname(providerFile)).commit };
}

/** RF-TOP-07: brings a snapshot up to date with its provider. */
export function refreshSnapshot(root, snap, current, commit) {
  writeFileSync(path.join(root, snap.snapshot), current);
  const source = { ...snap.source, commit, hash: hash(current) };
  writeFileSync(path.join(root, snap.sidecar), JSON.stringify(source, null, 2) + '\n');
  return source;
}
