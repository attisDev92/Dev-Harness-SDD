// Reads harness.config.yaml and reports issues with their source location.

import { readFileSync } from 'node:fs';
import { LineCounter, parseDocument, isMap, isSeq, isScalar } from 'yaml';
import { validateConfig } from './schema.js';

/**
 * @typedef {{ path: (string|number)[], code: string, params?: Record<string, unknown>, line?: number, col?: number }} LocatedIssue
 * @typedef {{ ok: boolean, config?: object, issues: LocatedIssue[] }} LoadResult
 */

/** @returns {LoadResult} */
export function parseConfig(text) {
  const lineCounter = new LineCounter();
  // CRLF is tolerated (RNF-05); duplicate keys are reported as YAML errors.
  const doc = parseDocument(String(text).replace(/^﻿/, ''), { lineCounter, prettyErrors: false, uniqueKeys: true });
  if (doc.errors.length) {
    return {
      ok: false,
      issues: doc.errors.map((e) => {
        const pos = lineCounter.linePos(e.pos?.[0] ?? 0);
        return { path: [], code: 'yaml', params: { message: e.message.split('\n')[0] }, line: pos.line, col: pos.col };
      }),
    };
  }
  const config = doc.toJS() ?? {};
  const issues = validateConfig(config).map((issue) => ({ ...issue, ...locate(doc, lineCounter, issue.path) }));
  return issues.length ? { ok: false, config, issues } : { ok: true, config, issues };
}

/** @returns {LoadResult & { error?: NodeJS.ErrnoException }} */
export function loadConfigFile(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    return { ok: false, issues: [{ path: [], code: 'unreadable', params: { message: error.code ?? error.message } }], error };
  }
  return parseConfig(text);
}

/** Line and column of the deepest existing node on `path`. */
function locate(doc, lineCounter, path) {
  let node = doc.contents;
  let range = node?.range;
  for (const segment of path) {
    if (isMap(node)) {
      const pair = node.items.find((p) => (isScalar(p.key) ? p.key.value : p.key) === segment);
      if (!pair) break;
      range = pair.value?.range ?? pair.key?.range ?? range;
      node = pair.value;
    } else if (isSeq(node) && typeof segment === 'number') {
      node = node.items[segment];
      range = node?.range ?? range;
    } else {
      break;
    }
  }
  if (!range) return {};
  const pos = lineCounter.linePos(range[0]);
  return { line: pos.line, col: pos.col };
}
