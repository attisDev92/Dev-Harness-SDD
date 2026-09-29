// Documentation whitelist guard (RF-MD-01, RF-MD-02). Dependency-free.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { matchesAny } from './glob.js';

const DOC_EXT = /\.(md|mdx)$/i;

/**
 * Decides whether an agent may write `file`. Only the creation of new
 * documentation files outside the whitelist is blocked; code files, existing
 * documents and paths outside the project are left to other rules.
 * @param {{ file: string, root: string, whitelist: string[], exists?: (p: string) => boolean }} input
 */
export function checkDocWrite({ file, root, whitelist, exists = existsSync }) {
  const abs = path.resolve(root, file);
  if (!DOC_EXT.test(abs)) return { decision: 'allow' };
  const rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return { decision: 'allow' };
  const posix = rel.split(path.sep).join('/');
  if (matchesAny(posix, whitelist)) return { decision: 'allow' };
  if (exists(abs)) return { decision: 'allow' };
  return { decision: 'block', kind: 'docBlocked', match: posix };
}
