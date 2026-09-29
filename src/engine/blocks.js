// Managed blocks inside files the harness does not own (RF-MRG-01).
//
//   <!-- harness:begin -->        (markdown)
//   # harness:begin               (.git/info/exclude and other hash-comment files)
//   …generated content…
//   <!-- harness:end -->

import { toLf } from './text.js';

const MARKERS = {
  html: { begin: '<!-- harness:begin -->', end: '<!-- harness:end -->' },
  hash: { begin: '# harness:begin', end: '# harness:end' },
};

export function markers(style = 'html') {
  return MARKERS[style];
}

/**
 * Locates the managed block. `status` is 'absent', 'ok' or 'broken' (a
 * marker without its pair, or more than one block: edge case 7).
 */
export function findBlock(text, style = 'html') {
  const { begin, end } = MARKERS[style];
  const lines = toLf(text ?? '').split('\n');
  const begins = lines.flatMap((l, i) => (l.trim() === begin ? [i] : []));
  const ends = lines.flatMap((l, i) => (l.trim() === end ? [i] : []));
  if (!begins.length && !ends.length) return { status: 'absent' };
  if (begins.length !== 1 || ends.length !== 1 || ends[0] < begins[0]) return { status: 'broken' };
  return {
    status: 'ok',
    start: begins[0],
    end: ends[0],
    content: lines.slice(begins[0] + 1, ends[0]).join('\n'),
  };
}

/** Inserts or replaces the block. Throws on a broken block. */
export function upsertBlock(text, content, style = 'html') {
  const { begin, end } = MARKERS[style];
  const body = toLf(content).replace(/\n+$/, '');
  const block = [begin, body, end];
  if (text == null || text === '') return block.join('\n') + '\n';
  const lines = toLf(text).split('\n');
  const found = findBlock(text, style);
  if (found.status === 'broken') throw Object.assign(new Error('broken managed block'), { code: 'EBLOCK' });
  if (found.status === 'ok') {
    lines.splice(found.start, found.end - found.start + 1, ...block);
    return lines.join('\n');
  }
  const trimmed = toLf(text).replace(/\n*$/, '');
  return `${trimmed}\n\n${block.join('\n')}\n`;
}

/** Removes the block and the blank line the harness added before it. */
export function removeBlock(text, style = 'html') {
  const found = findBlock(text, style);
  if (found.status === 'absent') return toLf(text);
  if (found.status === 'broken') throw Object.assign(new Error('broken managed block'), { code: 'EBLOCK' });
  const lines = toLf(text).split('\n');
  let start = found.start;
  let count = found.end - found.start + 1;
  if (start > 0 && lines[start - 1] === '') { start -= 1; count += 1; }
  lines.splice(start, count);
  const out = lines.join('\n');
  return out.trim() === '' ? '' : out;
}
