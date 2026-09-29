// Computes the file changes that take the project from its current state to
// the desired one (RF-GEN-09..13, RF-MRG-01..05, RF-REM-02..04).
//
// Inputs: the desired entries, the previous manifest and a reader. Hand edits
// are detected by comparing the disk with the hashes in the manifest; every
// conflict is handed to `resolve`, which asks the user (or keeps the user's
// version in non-interactive runs). Nothing is written here.

import { findBlock, upsertBlock, removeBlock } from './blocks.js';
import { entryKey } from './manifest.js';
import { hashText, toLf } from './text.js';
import { MISSING, getKey, setKey, deleteKey, sameValue, parseJson, formatJson } from './json-merge.js';

const hashValue = (v) => hashText(JSON.stringify(v));
const blockHash = (content) => hashText(toLf(content).replace(/\n+$/, ''));
const OWNED_KINDS = new Set(['file', 'block', 'json']);

/** Keeps CRLF in files the user wrote with CRLF; generated files use LF. */
function keepEol(original, text) {
  if (text == null || original == null || !original.includes('\r\n')) return text;
  return toLf(text).replace(/\n/g, '\r\n');
}

/**
 * @typedef {{ type: 'modifiedFile' | 'unmanagedFile' | 'modifiedBlock' | 'jsonKey' | 'staleModified', path: string, key?: string, current: unknown, desired: unknown, choices: string[] }} Conflict
 * @param {{ desired: object[], manifest: object | null, read: (p: string) => string | null, resolve: (c: Conflict) => Promise<string> }} input
 */
export async function planChanges({ desired, manifest, read, resolve }) {
  const oldEntries = manifest?.entries ?? [];
  const oldByKey = new Map(oldEntries.map((e) => [entryKey(e), e]));
  const desiredKeys = new Set(desired.map(entryKey));
  const texts = new Map();
  const originals = new Map();
  const entries = [];
  const report = [];
  const errors = [];

  const get = (p) => {
    if (!texts.has(p)) {
      const v = read(p);
      texts.set(p, v);
      originals.set(p, v);
    }
    return texts.get(p);
  };
  const set = (p, v) => {
    get(p);
    texts.set(p, v);
  };
  const note = (path, action, extra = {}) => report.push({ path, action, ...extra });

  for (const d of desired) {
    const old = oldByKey.get(entryKey(d));
    const cur = get(d.path);

    if (d.kind === 'file') {
      const entry = { kind: 'file', path: d.path, hash: hashText(d.content), generator: d.generator };
      if (cur === null) {
        set(d.path, d.content);
        entries.push(entry);
        note(d.path, 'create');
      } else if (toLf(cur) === toLf(d.content)) {
        entries.push(entry);
        note(d.path, 'unchanged');
      } else if (old && hashText(cur) === old.hash) {
        set(d.path, d.content);
        entries.push(entry);
        note(d.path, 'update');
      } else {
        const choice = await resolve({ type: old ? 'modifiedFile' : 'unmanagedFile', path: d.path, current: cur, desired: d.content, choices: ['keep', 'overwrite'] });
        if (choice === 'overwrite') {
          set(d.path, d.content);
          entries.push(entry);
          note(d.path, 'update');
        } else {
          if (old) entries.push(old);
          note(d.path, 'kept');
        }
      }
      continue;
    }

    if (d.kind === 'block') {
      const style = d.style ?? 'html';
      const entry = { kind: 'block', path: d.path, hash: blockHash(d.content), generator: d.generator, createdFile: old?.createdFile ?? cur === null };
      if (style !== 'html') entry.style = style;
      if (cur === null) {
        set(d.path, upsertBlock(null, d.content, style));
        entry.createdFile = true;
        entries.push(entry);
        note(d.path, 'create');
        continue;
      }
      const found = findBlock(cur, style);
      if (found.status === 'broken') {
        errors.push({ path: d.path, code: 'brokenBlock' });
        if (old) entries.push(old);
        note(d.path, 'error');
        continue;
      }
      if (found.status === 'absent') {
        set(d.path, keepEol(cur, upsertBlock(cur, d.content, style)));
        entries.push(entry);
        note(d.path, 'insert');
        continue;
      }
      if (toLf(found.content) === toLf(d.content).replace(/\n+$/, '')) {
        entries.push(entry);
        note(d.path, 'unchanged');
      } else if (old && blockHash(found.content) === old.hash) {
        set(d.path, keepEol(cur, upsertBlock(cur, d.content, style)));
        entries.push(entry);
        note(d.path, 'update');
      } else {
        const choice = await resolve({ type: 'modifiedBlock', path: d.path, current: found.content, desired: d.content, choices: ['keep', 'overwrite'] });
        if (choice === 'overwrite') {
          set(d.path, keepEol(cur, upsertBlock(cur, d.content, style)));
          entries.push(entry);
          note(d.path, 'update');
        } else {
          if (old) entries.push(old);
          note(d.path, 'kept');
        }
      }
      continue;
    }

    if (d.kind === 'json') {
      let obj = {};
      if (cur !== null) {
        const parsed = parseJson(cur);
        if (!parsed.ok || parsed.value === null || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
          errors.push({ path: d.path, code: 'invalidJson', message: parsed.error ?? 'not an object' });
          if (old) entries.push(old);
          note(d.path, 'error');
          continue;
        }
        obj = parsed.value;
      }
      const entry = { kind: 'json', path: d.path, generator: d.generator, createdFile: old?.createdFile ?? cur === null, keys: {} };
      let changed = false;
      const values = d.values ?? {};
      for (const [key, value] of Object.entries(values)) {
        const curVal = getKey(obj, key);
        const oldKey = old?.keys?.[key];
        const record = (extra) => { entry.keys[key] = { hash: hashValue(value), ...extra }; };
        const origin = oldKey ? { hadPrevious: oldKey.hadPrevious, ...(oldKey.hadPrevious ? { previous: oldKey.previous } : {}) } : null;
        if (curVal === MISSING) {
          setKey(obj, key, value);
          changed = true;
          record(origin ?? { hadPrevious: false });
        } else if (sameValue(curVal, value)) {
          record(origin ?? { hadPrevious: true, previous: curVal });
        } else if (oldKey && hashValue(curVal) === oldKey.hash) {
          setKey(obj, key, value);
          changed = true;
          record(origin);
        } else {
          const choice = await resolve({ type: 'jsonKey', path: d.path, key, current: curVal, desired: value, choices: ['keep', 'harness'] });
          if (choice === 'harness') {
            setKey(obj, key, value);
            changed = true;
            record(origin ?? { hadPrevious: true, previous: curVal });
          } else if (oldKey) {
            entry.keys[key] = oldKey;
          }
        }
      }
      // Keys the harness no longer needs go back to their previous value.
      for (const [key, oldKey] of Object.entries(old?.keys ?? {})) {
        if (key in values) continue;
        if (revertKey(obj, key, oldKey)) changed = true;
      }
      // Arrays the harness adds items to (hooks, permission rules) without
      // touching the items that were already there.
      const appends = d.appends ?? {};
      for (const [key, items] of Object.entries(appends)) {
        const oldAppend = old?.appends?.[key];
        let arr = getKey(obj, key);
        let created = oldAppend?.created ?? false;
        if (arr === MISSING) {
          arr = [];
          setKey(obj, key, arr);
          created = true;
          changed = true;
        } else if (!Array.isArray(arr)) {
          errors.push({ path: d.path, code: 'invalidJson', message: `${key} is not a list` });
          continue;
        }
        const wanted = new Set(items.map(hashValue));
        // Items added by an earlier version and no longer wanted.
        for (const h of oldAppend?.items ?? []) {
          if (wanted.has(h)) continue;
          const i = arr.findIndex((x) => hashValue(x) === h);
          if (i !== -1) { arr.splice(i, 1); changed = true; }
        }
        for (const item of items) {
          if (!arr.some((x) => sameValue(x, item))) { arr.push(item); changed = true; }
        }
        entry.appends ??= {};
        entry.appends[key] = { items: [...wanted], created };
      }
      for (const [key, oldAppend] of Object.entries(old?.appends ?? {})) {
        if (key in appends) continue;
        if (removeAppended(obj, key, oldAppend)) changed = true;
      }
      if (changed) set(d.path, keepEol(cur, formatJson(obj)));
      entries.push(entry);
      note(d.path, cur === null ? 'create' : changed ? 'merge' : 'unchanged');
    }
  }

  // Entries generated before but not wanted any more (sync) or everything (remove).
  for (const old of oldEntries) {
    if (desiredKeys.has(entryKey(old))) continue;
    if (!OWNED_KINDS.has(old.kind)) {
      entries.push(old);
      continue;
    }
    const cur = get(old.path);
    if (cur === null) {
      note(old.path, 'gone');
      continue;
    }
    if (old.kind === 'file') {
      if (hashText(cur) === old.hash) {
        set(old.path, null);
        note(old.path, 'delete');
      } else {
        const choice = await resolve({ type: 'staleModified', path: old.path, current: cur, desired: null, choices: ['keep', 'delete'] });
        if (choice === 'delete') {
          set(old.path, null);
          note(old.path, 'delete');
        } else {
          note(old.path, 'kept');
        }
      }
    } else if (old.kind === 'block') {
      const style = old.style ?? 'html';
      const found = findBlock(cur, style);
      if (found.status === 'broken') {
        errors.push({ path: old.path, code: 'brokenBlock' });
        entries.push(old);
        note(old.path, 'error');
        continue;
      }
      if (found.status === 'absent') {
        note(old.path, 'gone');
        continue;
      }
      let remove = blockHash(found.content) === old.hash;
      if (!remove) {
        remove = (await resolve({ type: 'staleModified', path: old.path, current: found.content, desired: null, choices: ['keep', 'delete'] })) === 'delete';
      }
      if (!remove) {
        entries.push(old);
        note(old.path, 'kept');
        continue;
      }
      const after = removeBlock(cur, style);
      set(old.path, after.trim() === '' && old.createdFile ? null : keepEol(cur, after));
      note(old.path, after.trim() === '' && old.createdFile ? 'delete' : 'strip');
    } else if (old.kind === 'json') {
      const parsed = parseJson(cur);
      if (!parsed.ok || typeof parsed.value !== 'object' || parsed.value === null) {
        errors.push({ path: old.path, code: 'invalidJson', message: parsed.error });
        entries.push(old);
        note(old.path, 'error');
        continue;
      }
      const obj = parsed.value;
      let changed = false;
      for (const [key, oldKey] of Object.entries(old.keys ?? {})) if (revertKey(obj, key, oldKey)) changed = true;
      for (const [key, oldAppend] of Object.entries(old.appends ?? {})) if (removeAppended(obj, key, oldAppend)) changed = true;
      if (old.createdFile && Object.keys(obj).length === 0) {
        set(old.path, null);
        note(old.path, 'delete');
      } else if (changed) {
        set(old.path, keepEol(cur, formatJson(obj)));
        note(old.path, 'revert');
      }
    }
  }

  // Tool metadata travels to the manifest (doctor reads it); executables keep their bit.
  const meta = new Map(desired.map((d) => [entryKey(d), d]));
  const withMeta = entries.map((e) => {
    const d = meta.get(entryKey(e));
    if (!d) return e;
    return { ...e, ...(d.tool ? { tool: d.tool } : {}), ...(d.enforces ? { enforces: d.enforces } : {}), ...(d.executable ? { executable: true } : {}) };
  });
  const executable = new Set(desired.filter((d) => d.executable).map((d) => d.path));
  const changes = [...texts.keys()]
    .filter((p) => (texts.get(p) ?? null) !== (originals.get(p) ?? null))
    .map((p) => ({ path: p, before: originals.get(p) ?? null, after: texts.get(p) ?? null, ...(executable.has(p) ? { executable: true } : {}) }));
  return { changes, entries: withMeta, report, errors };
}

/** Takes out the items the harness appended; drops the list if the harness created it and it is now empty. */
function removeAppended(obj, key, oldAppend) {
  const arr = getKey(obj, key);
  if (!Array.isArray(arr)) return false;
  let changed = false;
  for (const h of oldAppend.items ?? []) {
    const i = arr.findIndex((x) => hashValue(x) === h);
    if (i !== -1) { arr.splice(i, 1); changed = true; }
  }
  if (oldAppend.created && arr.length === 0) { deleteKey(obj, key); changed = true; }
  return changed;
}

/** Puts a merged key back as it was; leaves it alone if the user changed it since. */
function revertKey(obj, key, oldKey) {
  const cur = getKey(obj, key);
  if (cur === MISSING || hashValue(cur) !== oldKey.hash) return false;
  if (oldKey.hadPrevious) setKey(obj, key, oldKey.previous);
  else deleteKey(obj, key);
  return true;
}
