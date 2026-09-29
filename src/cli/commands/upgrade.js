// harness upgrade (RF-UPG-01..04): news between versions, configuration
// migrations, and a sync with the new version, all shown before applying.

import path from 'node:path';
import { readFileSync } from 'node:fs';
import { parseDocument } from 'yaml';
import { parseArgs } from '../../guards/args.js';
import { CONFIG_FILE, findProjectRoot } from '../../guards/project.js';
import { parseConfig } from '../../config/load.js';
import { issueLines } from '../../config/format.js';
import { unifiedDiff } from '../../engine/diff.js';
import { compareVersions } from './common.js';
import { syncCommand } from './sync.js';

/** What changed in each version, shown by `harness upgrade`. */
export const CHANGES = {
  '0.2.0': ['init, sync, doctor y remove', 'Modo local y team, bloques gestionados y fusión JSON'],
  '0.3.0': ['Adaptador de Claude Code: subagentes, comandos /sdd:*, skills, permisos y hooks', 'Flujo SDD determinista con sdd.js, gates humanos y triage', 'Git hook pre-commit y plantilla de CI'],
  '0.4.0': ['MVP: mensajes en español, log de eventos y harness upgrade'],
  '0.5.0': ['Varios repos y workspace, dependencias entre specs y snapshots de contratos', 'Registro curado de skills con instalador verificado', 'Sincronización con GitHub Issues'],
  '0.6.0': ['Cualquier tracker: GitHub desde la CLI y el resto desde el agente con su MCP (/sdd:tracker)'],
};

/**
 * RF-UPG-04: configuration migrations. Each one takes the parsed YAML
 * document (comments are kept) and changes it in place.
 * @type {{ to: string, migrate: (doc: import('yaml').Document) => void }[]}
 */
export const MIGRATIONS = [];

export async function upgradeCommand(argv, ctx) {
  const { io, t, tc, version } = ctx;
  const out = (s) => io.stdout.write(`${s}\n`);
  const err = (s) => io.stderr.write(`${s}\n`);
  const { unknown } = parseArgs(argv, { boolean: ['yes', 'dry-run'] });
  if (unknown.length) {
    err(t.unknownOption(unknown[0]));
    return 1;
  }
  const root = findProjectRoot(io.cwd);
  if (!root) {
    err(tc.upgrade.notActivated);
    return 1;
  }
  const text = readFileSync(path.join(root, CONFIG_FILE), 'utf8');
  const doc = parseDocument(text);
  const from = String(doc.get('harness_version') ?? '0.0.0');
  const cmp = compareVersions(from, version);
  if (cmp === 0) {
    out(tc.upgrade.upToDate(version));
    return 0;
  }
  if (cmp > 0) {
    // Edge case 25: never downgrade the configuration.
    err(tc.upgrade.projectNewer(from, version));
    return 1;
  }

  out(tc.upgrade.title(from, version));
  const news = Object.entries(CHANGES).filter(([v]) => compareVersions(v, from) > 0 && compareVersions(v, version) <= 0);
  if (news.length) {
    out(tc.upgrade.news);
    for (const [v, items] of news) for (const item of items) out(`  ${v}: ${item}`);
  }

  for (const m of MIGRATIONS) if (compareVersions(m.to, from) > 0 && compareVersions(m.to, version) <= 0) m.migrate(doc);
  doc.set('harness_version', version);
  const next = doc.toString();
  out(tc.upgrade.migration);
  out(unifiedDiff(text, next, CONFIG_FILE));

  const parsed = parseConfig(next);
  if (!parsed.ok) {
    err(tc.init.badConfig(CONFIG_FILE));
    issueLines(parsed.issues, t, CONFIG_FILE).forEach(err);
    return 1;
  }
  // RF-UPG-03: the file diff and the confirmation come from sync.
  return syncCommand(argv, { ...ctx, override: { ...parsed, text: next } });
}
