// sdd-harness skills list | install | update | verify (RF-SKL-03..15).

import path from 'node:path';
import { parseArgs } from '../../guards/args.js';
import { CONFIG_FILE, findProjectRoot } from '../../guards/project.js';
import { loadConfigFile } from '../../config/load.js';
import { unifiedDiff } from '../../engine/diff.js';
import { readFileSync, existsSync } from 'node:fs';
import { loadRegistry, requiredSkills, readLock, installSkills, verifySkills, fetchSkill, ALLOWED_LICENSES } from '../../skills/installer.js';
import { CancelledError, createLinePrompter, createScriptedPrompter } from '../prompt.js';
import { syncCommand } from './sync.js';

const M = {
  notActivated: 'Este proyecto no está activado. Ejecuta primero "sdd-harness-init".',
  usage: 'Uso: sdd-harness skills <list|install|update|verify> [nombres] [--yes]',
  header: 'Skills curadas que necesita este proyecto:',
  none: 'Este proyecto no necesita skills de terceros.',
  row: (s, status) => `  ${status.padEnd(12)} ${s.name}  (${s.repo}@${s.sha.slice(0, 7)} · ${s.license})`,
  status: { installed: 'instalada', pending: 'pendiente', license: 'bloqueada', modified: 'modificada' },
  network: (n) => `Se descargarán ${n} skill${n === 1 ? '' : 's'} desde github.com (commits fijados en el registro).`,
  confirm: (s, info) => `¿Instalo "${s.name}" de ${s.repo} (licencia ${s.license}, ${info.files} archivos${info.scripts.length ? `; CONTIENE SCRIPTS: ${info.scripts.join(', ')}. El harness nunca los ejecuta` : ''})?`,
  scriptsWarn: (s, list) => `Aviso: "${s.name}" contiene scripts (${list.join(', ')}). El harness nunca los ejecuta.`,
  installed: (list) => `Instaladas: ${list.join(', ')}. Se asignan a los roles con un sync:`,
  skipped: {
    license: (d) => `licencia "${d ?? 'desconocida'}" no permitida (permitidas: ${ALLOWED_LICENSES.join(', ')})`,
    network: (d) => `no se pudo descargar (${d}); queda pendiente`,
    missing: (d) => `no disponible en el origen (${d}); no se busca otra versión`,
    hash: (d) => `el hash descargado no coincide con el del registro (${d.slice(0, 12)}…); instalación abortada`,
    declined: () => 'no instalada por decisión del usuario',
  },
  skippedLine: (name, text) => `  ✖ ${name}: ${text}`,
  verifyOk: (n) => `${n} skill${n === 1 ? '' : 's'} verificada${n === 1 ? '' : 's'} contra .harness/skills.lock.`,
  verifyBad: (p) => `  ✖ ${p.file}: ${p.problem === 'missing' ? 'falta' : 'modificado'}`,
  upToDate: 'Todas las skills instaladas están en la versión del registro.',
  updateDiff: (s) => `Cambios en "${s.name}" (${s.from.slice(0, 7)} → ${s.to.slice(0, 7)}):`,
  updateConfirm: (s) => `¿Actualizo "${s.name}"?`,
};

export async function skillsCommand(argv, ctx) {
  const { io } = ctx;
  const out = (s) => io.stdout.write(`${s}\n`);
  const err = (s) => io.stderr.write(`${s}\n`);
  const { flags, positional } = parseArgs(argv, { boolean: ['yes', 'json'] });
  const [action, ...names] = positional;
  const root = findProjectRoot(io.cwd);
  if (!root) {
    err(M.notActivated);
    return 1;
  }
  if (!['list', 'install', 'update', 'verify'].includes(action)) {
    err(M.usage);
    return 1;
  }
  const config = loadConfigFile(path.join(root, CONFIG_FILE)).config ?? {};
  const registry = io.registry ?? loadRegistry();
  const lock = readLock(root);
  const required = requiredSkills(config, registry);
  const fetcher = io.fetchSkill ?? ((entry) => fetchSkill(entry, { fetch: io.fetch }));

  if (action === 'list') {
    if (!required.length && !Object.keys(lock.skills).length) {
      out(M.none);
      return 0;
    }
    out(M.header);
    const problems = new Set(verifySkills(root).problems.map((p) => p.name));
    for (const s of required) {
      const status = !ALLOWED_LICENSES.includes(s.license) ? 'license' : lock.skills[s.name] ? (problems.has(s.name) ? 'modified' : 'installed') : 'pending';
      out(M.row(s, M.status[status]));
    }
    return 0;
  }

  if (action === 'verify') {
    const { skills, problems } = verifySkills(root);
    if (problems.length) {
      problems.forEach((p) => err(M.verifyBad(p)));
      return 1;
    }
    out(M.verifyOk(skills.length));
    return 0;
  }

  const prompter = io.prompter ?? (flags.yes ? createScriptedPrompter({}) : createLinePrompter({ input: io.stdin, output: io.stdout }));
  try {
    if (action === 'install') {
      const wanted = required.filter((s) => (names.length ? names.includes(s.name) : !lock.skills[s.name]));
      if (!wanted.length) {
        out(M.upToDate);
        return 0;
      }
      out(M.network(wanted.length)); // RNF-09: say it before going to the network
      const decide = async (entry, info) => {
        if (info.scripts.length) out(M.scriptsWarn(entry, info.scripts));
        return flags.yes || prompter.confirm(`skill:${entry.name}`, M.confirm(entry, info), { default: !info.scripts.length });
      };
      const result = await installSkills(root, wanted, { fetchSkill: fetcher, decide });
      if (result.installed.length) {
        out(M.installed(result.installed));
        // Assign them to the roles and hide them from git in local mode (RF-SKL-12).
        await syncCommand(['--yes'], { ...ctx, io: { ...io, prompter: undefined } });
      }
      for (const s of result.skipped) err(M.skippedLine(s.name, M.skipped[s.reason](s.detail)));
      return result.skipped.some((s) => !['declined', 'license'].includes(s.reason)) ? 1 : 0;
    }

    // update (RF-SKL-11): installed skills whose pinned commit changed in the registry.
    const outdated = Object.entries(lock.skills)
      .map(([name, s]) => ({ name, installed: s, entry: registry.skills.find((r) => r.name === name) }))
      .filter((x) => x.entry && (x.entry.sha !== x.installed.sha || x.entry.hash !== x.installed.hash));
    if (!outdated.length) {
      out(M.upToDate);
      return 0;
    }
    const chosen = [];
    for (const x of outdated) {
      let got;
      try {
        got = await fetcher(x.entry);
      } catch (e) {
        err(M.skippedLine(x.name, M.skipped.network(e.message)));
        continue;
      }
      out(M.updateDiff({ name: x.name, from: x.installed.sha, to: x.entry.sha }));
      for (const [rel, content] of Object.entries(got.files)) {
        const current = path.join(root, '.agents/skills', x.name, rel);
        const before = existsSync(current) ? readFileSync(current, 'utf8') : null;
        const diff = unifiedDiff(before, content.toString('utf8'), `${x.name}/${rel}`);
        if (diff) out(diff);
      }
      if (flags.yes || (await prompter.confirm(`update:${x.name}`, M.updateConfirm(x), { default: true }))) chosen.push(x.entry);
    }
    const result = await installSkills(root, chosen, { fetchSkill: fetcher });
    if (result.installed.length) out(M.installed(result.installed));
    for (const s of result.skipped) err(M.skippedLine(s.name, M.skipped[s.reason](s.detail)));
    return result.skipped.length ? 1 : 0;
  } catch (e) {
    if (e instanceof CancelledError) return 130;
    throw e;
  } finally {
    prompter.close();
  }
}
