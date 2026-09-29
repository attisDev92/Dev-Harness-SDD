// Tiny argv parser shared by the CLI and the standalone guard runner.

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * True when the module at `metaUrl` is the script Node was started with.
 * Compares real paths: temp folders are aliased on macOS (/var → /private/var)
 * and Windows (8.3 short names).
 */
export function isMainModule(metaUrl) {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(metaUrl));
  } catch {
    return false;
  }
}

/**
 * @param {string[]} argv
 * @param {{ boolean?: string[], string?: string[], alias?: Record<string,string> }} spec
 * @returns {{ flags: Record<string, string | boolean>, positional: string[], unknown: string[] }}
 */
export function parseArgs(argv, spec = {}) {
  const booleans = new Set(spec.boolean ?? []);
  const strings = new Set(spec.string ?? []);
  const alias = spec.alias ?? {};
  const flags = {};
  const positional = [];
  const unknown = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') { positional.push(...argv.slice(i + 1)); break; }
    if (!arg.startsWith('-') || arg === '-') { positional.push(arg); continue; }
    const eq = arg.indexOf('=');
    let name = arg.replace(/^--?/, '');
    let value;
    if (eq !== -1) { name = arg.slice(0, eq).replace(/^--?/, ''); value = arg.slice(eq + 1); }
    name = alias[name] ?? name;
    if (booleans.has(name)) { flags[name] = value === undefined ? true : value !== 'false'; continue; }
    if (strings.has(name)) {
      if (value === undefined) {
        value = argv[i + 1];
        i += 1;
      }
      flags[name] = value ?? '';
      continue;
    }
    unknown.push(arg);
  }
  return { flags, positional, unknown };
}
