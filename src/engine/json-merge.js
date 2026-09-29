// Key-level merge into JSON configuration files (RF-MRG-02..05). Only the
// harness's own keys are touched; every other key keeps its value and order.

export const MISSING = Symbol('missing');

function split(key) {
  return Array.isArray(key) ? key : String(key).split('.');
}

export function getKey(obj, key) {
  let node = obj;
  for (const part of split(key)) {
    if (node === null || typeof node !== 'object' || !Object.hasOwn(node, part)) return MISSING;
    node = node[part];
  }
  return node;
}

export function setKey(obj, key, value) {
  const parts = split(key);
  let node = obj;
  for (const part of parts.slice(0, -1)) {
    if (node[part] === null || typeof node[part] !== 'object' || Array.isArray(node[part])) node[part] = {};
    node = node[part];
  }
  node[parts[parts.length - 1]] = value;
}

/** Deletes the key and any parent objects left empty by the deletion. */
export function deleteKey(obj, key) {
  const parts = split(key);
  const trail = [obj];
  for (const part of parts.slice(0, -1)) {
    const next = trail[trail.length - 1]?.[part];
    if (next === null || typeof next !== 'object') return;
    trail.push(next);
  }
  delete trail[trail.length - 1][parts[parts.length - 1]];
  for (let i = trail.length - 1; i > 0; i -= 1) {
    if (Object.keys(trail[i]).length) break;
    delete trail[i - 1][parts[i - 1]];
  }
}

export function sameValue(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Parses JSON (allowing a BOM). Returns { ok, value } or { ok: false, error }. */
export function parseJson(text) {
  try {
    return { ok: true, value: JSON.parse(String(text).replace(/^﻿/, '')) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

export function formatJson(value) {
  return JSON.stringify(value, null, 2) + '\n';
}
