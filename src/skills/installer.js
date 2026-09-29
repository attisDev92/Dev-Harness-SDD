// Curated third-party skills (RF-SKL-02..15).
//
// Only skills listed in registry.json are installed. Each one is downloaded
// from its pinned commit, its content hash is checked, its license must be in
// the allowed list, and nothing it contains is ever executed.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync, rmdirSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

export const LOCK_FILE = '.harness/skills.lock';
export const SKILL_DIRS = ['.agents/skills', '.claude/skills'];
/** RF-SKL-15 (proposal of the spec's open questions). */
export const ALLOWED_LICENSES = ['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC'];

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

export function loadRegistry() {
  return JSON.parse(readFileSync(fileURLToPath(new URL('./registry.json', import.meta.url)), 'utf8'));
}

/** Content hash of a skill: every file path and its hash, in order. */
export function treeHash(files) {
  const h = createHash('sha256');
  for (const rel of Object.keys(files).sort()) h.update(`${rel}\0${sha256(files[rel])}\n`);
  return h.digest('hex');
}

/** RF-SKL-08: executable content (scripts or hooks) inside a skill. */
export function scriptsIn(files) {
  return Object.keys(files).filter((rel) => /\.(sh|bash|ps1|bat|cmd|js|mjs|cjs|ts|py|rb|pl)$/i.test(rel) || /(^|\/)(scripts|hooks)\//.test(rel));
}

/** RF-SKL-03: the curated skills this project needs, from its components and stack. */
export function requiredSkills(config, registry = loadRegistry()) {
  const comps = Object.values(config.components ?? {});
  const stack = comps.map((c) => String(c.stack ?? '').toLowerCase()).join('+');
  const has = (word) => stack.split(/[+\s,]+/).includes(word);
  const matches = (when = {}) => {
    if (when.always) return true;
    if (when.kind && comps.some((c) => c.kind === when.kind)) return true;
    if (when.stack && when.stack.some(has)) return true;
    if (when.design && config.design?.source === when.design) return true;
    return false;
  };
  return registry.skills.filter((s) => matches(s.when));
}

// Download --------------------------------------------------------------------

/** Minimal ustar/pax reader: returns { path: Buffer } of regular files. */
export function readTar(buf) {
  const files = {};
  let offset = 0;
  let paxPath = null;
  const str = (b) => b.toString('utf8').replace(/\0.*$/s, '');
  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const name = str(header.subarray(0, 100));
    const prefix = str(header.subarray(345, 500));
    const size = parseInt(str(header.subarray(124, 136)).trim() || '0', 8);
    const type = String.fromCharCode(header[156] || 48);
    const body = buf.subarray(offset + 512, offset + 512 + size);
    if (type === 'x') {
      const m = /\d+ path=([^\n]*)\n/.exec(body.toString('utf8'));
      paxPath = m ? m[1] : null;
    } else if (type === '0' || type === '\0') {
      files[paxPath ?? (prefix ? `${prefix}/${name}` : name)] = Buffer.from(body);
      paxPath = null;
    } else {
      paxPath = null;
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

/**
 * Downloads the pinned commit and returns the skill's files (relative to its
 * folder) and the repository's license files (RF-SKL-05, RF-SKL-14).
 */
export async function fetchSkill(entry, { fetch = globalThis.fetch } = {}) {
  const url = `https://codeload.github.com/${entry.repo}/tar.gz/${entry.sha}`;
  const res = await fetch(url);
  if (res.status === 404) throw Object.assign(new Error(`${entry.repo}@${entry.sha} no existe`), { code: 'ENOTFOUND_SHA' });
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status} al descargar ${url}`), { code: 'EDOWNLOAD' });
  const all = readTar(gunzipSync(Buffer.from(await res.arrayBuffer())));
  const top = Object.keys(all)[0]?.split('/')[0] ?? '';
  const base = `${top}/${entry.path.replace(/\/$/, '')}/`;
  const files = {};
  const licenses = {};
  for (const [p, content] of Object.entries(all)) {
    if (p.startsWith(base)) files[p.slice(base.length)] = content;
    else if (/^[^/]+\/(LICENSE|LICENCE|COPYING)(\.(md|txt))?$/i.test(p)) licenses[p.split('/').pop()] = content;
  }
  return { files, licenses };
}

// Lock file ---------------------------------------------------------------------

export function readLock(root) {
  try {
    return JSON.parse(readFileSync(path.join(root, LOCK_FILE), 'utf8'));
  } catch {
    return { version: 1, skills: {} };
  }
}

function writeLock(root, lock) {
  mkdirSync(path.dirname(path.join(root, LOCK_FILE)), { recursive: true });
  writeFileSync(path.join(root, LOCK_FILE), JSON.stringify(lock, null, 2) + '\n');
}

/**
 * Installs verified skills. `decide(entry, info)` confirms each one after
 * showing its origin, license and scripts (RF-SKL-04/08).
 * @returns {Promise<{ installed: string[], skipped: { name: string, reason: string, detail?: string }[] }>}
 */
export async function installSkills(root, entries, { fetchSkill: fetcher = fetchSkill, decide = async () => true } = {}) {
  const lock = readLock(root);
  const result = { installed: [], skipped: [] };
  for (const entry of entries) {
    if (!ALLOWED_LICENSES.includes(entry.license)) {
      result.skipped.push({ name: entry.name, reason: 'license', detail: entry.license });
      continue;
    }
    let got;
    try {
      got = await fetcher(entry);
    } catch (err) {
      // Edge cases 16 and 17: no network or unknown commit. The rest continues.
      result.skipped.push({ name: entry.name, reason: err.code === 'ENOTFOUND_SHA' ? 'missing' : 'network', detail: err.message });
      continue;
    }
    const actual = treeHash(got.files);
    if (actual !== entry.hash) {
      result.skipped.push({ name: entry.name, reason: 'hash', detail: actual });
      continue;
    }
    if (!(await decide(entry, { scripts: scriptsIn(got.files), files: Object.keys(got.files).length }))) {
      result.skipped.push({ name: entry.name, reason: 'declined' });
      continue;
    }
    const files = { ...got.files };
    // RF-SKL-14: keep the license and attribution next to the skill.
    if (!Object.keys(files).some((f) => /^(LICENSE|LICENCE|COPYING)/i.test(f))) {
      for (const [name, content] of Object.entries(got.licenses)) files[name] = content;
    }
    files['NOTICE.harness.md'] = Buffer.from(`Skill "${entry.name}" de https://github.com/${entry.repo}/tree/${entry.sha}/${entry.path}\nLicencia: ${entry.license}. Instalada por sdd-harness sin modificaciones.\n`);
    const written = {};
    for (const dir of SKILL_DIRS) {
      for (const [rel, content] of Object.entries(files)) {
        const target = path.join(root, dir, entry.name, rel);
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, content);
        written[`${dir}/${entry.name}/${rel}`] = sha256(content);
      }
    }
    lock.skills[entry.name] = { repo: entry.repo, path: entry.path, sha: entry.sha, hash: entry.hash, license: entry.license, files: written };
    result.installed.push(entry.name);
  }
  writeLock(root, lock);
  return result;
}

/** RF-SKL-10: installed files against skills.lock. */
export function verifySkills(root) {
  const lock = readLock(root);
  const problems = [];
  for (const [name, s] of Object.entries(lock.skills)) {
    for (const [rel, hash] of Object.entries(s.files ?? {})) {
      const file = path.join(root, rel);
      if (!existsSync(file)) problems.push({ name, file: rel, problem: 'missing' });
      else if (sha256(readFileSync(file)) !== hash) problems.push({ name, file: rel, problem: 'modified' });
    }
  }
  return { skills: Object.keys(lock.skills), problems };
}

/** Removes installed skills (harness remove). Modified files are kept. */
export function uninstallSkills(root) {
  const lock = readLock(root);
  const kept = [];
  for (const s of Object.values(lock.skills)) {
    for (const [rel, hash] of Object.entries(s.files ?? {})) {
      const file = path.join(root, rel);
      if (!existsSync(file)) continue;
      if (sha256(readFileSync(file)) !== hash) { kept.push(rel); continue; }
      unlinkSync(file);
      // Drop the folders left empty, up to the skills folder.
      let dir = path.dirname(file);
      while (dir.startsWith(path.join(root, '.')) && existsSync(dir) && readdirSync(dir).length === 0 && !SKILL_DIRS.some((d) => path.join(root, d) === dir)) {
        rmdirSync(dir);
        dir = path.dirname(dir);
      }
    }
  }
  if (existsSync(path.join(root, LOCK_FILE))) unlinkSync(path.join(root, LOCK_FILE));
  return { kept };
}
