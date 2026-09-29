// Text helpers shared by the generation engine.

import { createHash } from 'node:crypto';

/** Generated files use LF; reading tolerates CRLF (RNF-05). */
export function toLf(text) {
  return String(text).replace(/\r\n?/g, '\n');
}

export function hashText(text) {
  return createHash('sha256').update(toLf(text)).digest('hex');
}

/** Posix-style relative path, the form used in the manifest and in messages. */
export function posix(p) {
  return String(p).replace(/\\/g, '/').replace(/^\.\//, '');
}
