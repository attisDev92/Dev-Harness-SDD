// Unified line diff (LCS based) for sync, init, remove and upgrade previews.

import { toLf } from './text.js';

function lines(text) {
  if (text == null || text === '') return [];
  const out = toLf(text).split('\n');
  if (out[out.length - 1] === '') out.pop();
  return out;
}

/** Edit script: array of [' ' | '-' | '+', line]. */
function editScript(a, b) {
  // Trim the common prefix and suffix so the quadratic part stays small.
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre += 1;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf += 1;
  const A = a.slice(pre, a.length - suf);
  const B = b.slice(pre, b.length - suf);
  const n = A.length;
  const m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops = a.slice(0, pre).map((l) => [' ', l]);
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) { ops.push([' ', A[i]]); i += 1; j += 1; }
    else if (i < n && (j === m || dp[i + 1][j] >= dp[i][j + 1])) { ops.push(['-', A[i]]); i += 1; }
    else { ops.push(['+', B[j]]); j += 1; }
  }
  ops.push(...a.slice(a.length - suf).map((l) => [' ', l]));
  return ops;
}

/**
 * Unified diff between two texts (null = file absent). Returns '' when equal.
 */
export function unifiedDiff(before, after, file, context = 3) {
  const a = lines(before);
  const b = lines(after);
  if (toLf(before ?? '') === toLf(after ?? '') && (before == null) === (after == null)) return '';
  const ops = editScript(a, b);
  const header = [`--- ${before == null ? '/dev/null' : `a/${file}`}`, `+++ ${after == null ? '/dev/null' : `b/${file}`}`];
  // Line numbers before each op.
  const pos = [];
  let aLine = 1;
  let bLine = 1;
  for (const [op] of ops) {
    pos.push([aLine, bLine]);
    if (op !== '+') aLine += 1;
    if (op !== '-') bLine += 1;
  }
  // Ranges of ops around each change, merged when they touch.
  const ranges = [];
  ops.forEach(([op], i) => {
    if (op === ' ') return;
    const from = Math.max(0, i - context);
    const to = Math.min(ops.length - 1, i + context);
    const last = ranges[ranges.length - 1];
    if (last && from <= last[1] + 1) last[1] = Math.max(last[1], to);
    else ranges.push([from, to]);
  });
  const body = ranges.flatMap(([from, to]) => {
    const slice = ops.slice(from, to + 1);
    const aLen = slice.filter(([o]) => o !== '+').length;
    const bLen = slice.filter(([o]) => o !== '-').length;
    const [aStart, bStart] = pos[from];
    return [`@@ -${aLen ? aStart : aStart - 1},${aLen} +${bLen ? bStart : bStart - 1},${bLen} @@`, ...slice.map(([o, l]) => `${o}${l}`)];
  });
  return [...header, ...body].join('\n') + '\n';
}
