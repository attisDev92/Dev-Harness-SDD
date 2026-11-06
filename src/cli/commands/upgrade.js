// sdd-harness upgrade (RF-UPG-01..04): news between versions, configuration
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

/** What changed in each version, shown by `sdd-harness upgrade`. */
export const CHANGES = {
  '0.2.0': ['init, sync, doctor y remove', 'Modo local y team, bloques gestionados y fusión JSON'],
  '0.3.0': ['Adaptador de Claude Code: subagentes, comandos /sdd:*, skills, permisos y hooks', 'Flujo SDD determinista con sdd.js, gates humanos y triage', 'Git hook pre-commit y plantilla de CI'],
  '0.4.0': ['MVP: mensajes en español, log de eventos y sdd-harness upgrade'],
  '0.5.0': ['Varios repos y workspace, dependencias entre specs y snapshots de contratos', 'Registro curado de skills con instalador verificado', 'Sincronización con GitHub Issues'],
  '0.6.0': ['Cualquier tracker: GitHub desde la CLI y el resto desde el agente con su MCP (/sdd:tracker)'],
  '0.7.0': ['Comando sdd-harness y atajo sdd-harness-init', 'Ocho skills propias más (clean-code, design-system, api-design…)', 'Git hooks en cada repo de un workspace'],
  '0.8.0': ['Flujo ligero: solo dos paradas (spec y plan+tareas) que se aprueban hablando ("sí", "continúa")', 'El agente propone el commit al cerrar cada historia y lo hace con tu OK', 'Tareas nuevas y cambios de harness.config.yaml en cualquier momento, con sync automático', 'Comandos /sdd:* solo informativos o para lanzar trabajo en paralelo (status, spec, next, docs, review, validate, commit)', 'Estado visible en spec.md (frontmatter) y tasks.md; sin lock de sesión ni gates'],
  '0.8.1': ['Nunca más de 2 subagentes trabajando a la vez (backend, frontend, qa…): sdd.js next lista 2 como máximo y un tercer subagente produce un aviso'],
  '2.1.0': [
    'orchestration.max_parallel: cuántos subagentes pueden trabajar a la vez (1–4; antes siempre 2)',
    'gates.decisions: summary (como hasta ahora) o interview, para que el agente te entreviste sobre las decisiones pendientes; nuevo sdd.js decisions y /sdd:decisions',
    'sdd.js pause / resume y /sdd:pause, /sdd:resume: los subagentes activos terminan y no se lanza ninguno nuevo, para cerrar o suspender una sesión',
    'sdd.js done solo cierra una tarea con una verificación verde y actual de su componente; sdd.js brief incluye las reglas que recibe el subagente',
    'Antigravity: regla siempre activa (.agents/rules/sdd-harness.md) con lo que los modelos de Google dejaban de seguir',
  ],
  '2.2.0': [
    'Límite de subagentes por desarrollador: sdd.js agents <1-4> lo fija solo en tu máquina (.harness/state/local.json, nunca se versiona); orchestration.max_parallel pasa a ser el valor por defecto del proyecto',
    'sdd.js agents muestra el límite efectivo y su origen; sdd.js agents --clear vuelve al del proyecto',
    'Skills, agentes, AGENTS.md y la regla de Antigravity ya no llevan el número escrito: remiten a sdd.js next',
  ],
};

/**
 * RF-UPG-04: configuration migrations. Each one takes the parsed YAML
 * document (comments are kept) and changes it in place.
 * @type {{ to: string, migrate: (doc: import('yaml').Document) => void }[]}
 */
export const MIGRATIONS = [
  {
    // 2.1.0: the two orchestration options, with the values the project had implicitly (2 subagents, decisions in the summary).
    to: '2.1.0',
    migrate(doc) {
      // Nodes are created explicitly so the comment can hang on the scalar.
      const add = (section, key, value, text) => {
        if (doc.hasIn([section, key])) return;
        const node = doc.createNode(value);
        node.comment = ` ${text}`;
        if (!doc.hasIn([section])) doc.set(section, doc.createNode({}));
        doc.setIn([section, key], node);
      };
      add('orchestration', 'max_parallel', 2, 'subagentes a la vez por defecto, de 1 a 4 (cada dev lo cambia en su máquina: sdd.js agents N)');
      add('gates', 'decisions', 'summary', 'summary (se cuentan en los resúmenes) | interview (te pregunta una cada vez)');
    },
  },
];

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
