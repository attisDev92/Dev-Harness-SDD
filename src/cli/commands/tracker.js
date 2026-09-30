// sdd-harness tracker connect | sync | status (RF-TRK-01..10), GitHub Issues first.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from '../../guards/args.js';
import { CONFIG_FILE, findProjectRoot, loadGuardSettings } from '../../guards/project.js';
import { listSpecs, specRoots } from '../../guards/tasks.js';
import { loadConfigFile } from '../../config/load.js';
import { githubClient, tokenFrom } from '../../tracker/github.js';
import { linkedTasks, planSync, updateTaskLine, nextTaskId } from '../../guards/tracker-sync.js';
import { CancelledError, createLinePrompter, createScriptedPrompter } from '../prompt.js';

const BASE_FILE = '.harness/state/tracker.json';

const M = {
  notActivated: 'Este proyecto no está activado. Ejecuta primero "sdd-harness-init".',
  usage: 'Uso: sdd-harness tracker <connect|sync|status> [--dry-run] [--yes]',
  disabled: 'No hay tracker activado. Añade en harness.config.yaml: tracker: {enabled: true, provider: <github|linear|jira|el tuyo>, project: <tablero o proyecto>} (con GitHub, además repo: <owner>/<repo>).',
  viaAgent: (p) => `El tracker "${p}" se sincroniza desde tu agente con su MCP: abre Claude Code en el proyecto y ejecuta /sdd:tracker. El harness calcula los cambios, te los enseña y actualiza tasks.md cuando dices que sí.`,
  noRepo: 'Falta tracker.repo (owner/repo) en harness.config.yaml.',
  noToken: 'Falta el token: define GITHUB_TOKEN o GH_TOKEN en el entorno. El harness nunca lo guarda en el proyecto.',
  connected: (r) => `Conectado a ${r.name}${r.canWrite ? '' : ' (solo lectura: no se podrán crear ni modificar issues)'}.`,
  failed: (m) => `Error del tracker: ${m}. No se modificó tasks.md.`,
  spec: (id) => `Spec ${id}:`,
  create: (t) => `  → crear en GitHub: ${t}`,
  push: (x) => `  → actualizar en GitHub ${x.remote.key}: ${x.title}${x.done ? ' (cerrado)' : ' (abierto)'}`,
  pull: (x) => `  ← actualizar ${x.task.id} en tasks.md: ${x.title}${x.done ? ' (hecha)' : ' (pendiente)'}`,
  conflict: (x) => `  ! ${x.task.id} cambió en ambos lados: local "${x.task.title}" (${x.task.done ? 'hecha' : 'pendiente'}) · GitHub "${x.remote.title}" (${x.remote.done ? 'cerrado' : 'abierto'})`,
  missing: (x) => `  ! ${x.task.id} está vinculada a ${x.key}, que ya no existe en GitHub. No se borra nada: decide tú.`,
  proposal: (x) => `  ? nueva en GitHub: ${x.remote.key} "${x.title}" (propuesta, no se añade sin tu aprobación)`,
  nothing: 'Todo está sincronizado.',
  dryRun: 'Simulación: no se aplicó nada.',
  pickConflict: (x) => `¿Qué versión de ${x.task.id} conservo?`,
  keepLocal: 'la de tasks.md', keepRemote: 'la de GitHub',
  addProposal: (x) => `¿Añado "${x.title}" a tasks.md? (con su componente; el resto de campos se completa después)`,
  confirmRemote: (c, u) => `Se crearán ${c} y se modificarán ${u} issues en GitHub. ¿Continúo?`,
  aborted: 'No se aplicó nada.',
  done: 'Sincronización completada.',
  status: (id, linked, total, at) => `  ${id}: ${linked}/${total} tareas vinculadas${at ? ` · última sincronización ${at}` : ''}`,
};

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export async function trackerCommand(argv, { io }) {
  const out = (s) => io.stdout.write(`${s}\n`);
  const err = (s) => io.stderr.write(`${s}\n`);
  const { flags, positional } = parseArgs(argv, { boolean: ['yes', 'dry-run'] });
  const action = positional[0];
  const root = findProjectRoot(io.cwd);
  if (!root) { err(M.notActivated); return 1; }
  if (!['connect', 'sync', 'status'].includes(action)) { err(M.usage); return 1; }
  const tracker = loadConfigFile(path.join(root, CONFIG_FILE)).config?.tracker ?? {};
  if (!tracker.enabled) { err(M.disabled); return 1; }
  const native = tracker.provider === 'github';
  if (native && !tracker.repo && action !== 'status') { err(M.noRepo); return 1; }

  const settings = loadGuardSettings(root);
  const specs = listSpecs(root, specRoots(settings)).filter((s) => existsSync(path.join(root, s.dir, 'tasks.md')));
  const baseFile = path.join(root, BASE_FILE);
  const base = readJson(baseFile, { specs: {}, at: null });

  if (action === 'status') {
    for (const s of specs) {
      const tasks = linkedTasks(readFileSync(path.join(root, s.dir, 'tasks.md'), 'utf8'));
      out(M.status(s.id, tasks.filter((t) => t.link).length, tasks.length, base.at));
    }
    return 0;
  }

  // Any other tracker syncs from the agent, through the tracker's own MCP.
  if (!native) {
    out(M.viaAgent(tracker.provider));
    return 0;
  }

  const token = tokenFrom(io.env);
  if (!token) { err(M.noToken); return 1; }
  const client = githubClient({ repo: tracker.repo, token, fetch: io.fetch });

  if (action === 'connect') {
    try {
      out(M.connected(await client.check()));
      return 0;
    } catch (e) {
      err(M.failed(e.message));
      return 1;
    }
  }

  // sync: read both sides first; any error stops before writing anything (RF-TRK-10).
  const work = [];
  try {
    for (const s of specs) {
      const file = path.join(root, s.dir, 'tasks.md');
      const text = readFileSync(file, 'utf8');
      const tasks = linkedTasks(text);
      const remote = await client.list(s.id);
      work.push({ spec: s, file, text, tasks, plan: planSync({ tasks, remote, base: base.specs[s.id] ?? {}, provider: 'github' }) });
    }
  } catch (e) {
    err(M.failed(e.message));
    return 1;
  }

  let any = false;
  for (const w of work) {
    const p = w.plan;
    if (![p.create, p.push, p.pull, p.conflicts, p.missing, p.proposals].some((l) => l.length)) continue;
    any = true;
    out(M.spec(w.spec.id));
    p.create.forEach((x) => out(M.create(x.title)));
    p.push.forEach((x) => out(M.push(x)));
    p.pull.forEach((x) => out(M.pull(x)));
    p.conflicts.forEach((x) => out(M.conflict(x)));
    p.missing.forEach((x) => out(M.missing(x)));
    p.proposals.forEach((x) => out(M.proposal(x)));
  }
  if (!any) { out(M.nothing); return 0; }
  if (flags['dry-run']) { out(M.dryRun); return 0; }

  const prompter = io.prompter ?? (flags.yes ? createScriptedPrompter({}) : createLinePrompter({ input: io.stdin, output: io.stdout }));
  try {
    // RF-TRK-07: conflicts are never resolved automatically.
    for (const w of work) {
      w.plan.resolved = [];
      for (const c of w.plan.conflicts) {
        if (flags.yes) continue;
        const pick = await prompter.select(`conflict:${w.spec.id}:${c.task.id}`, M.pickConflict(c), [{ value: 'local', label: M.keepLocal }, { value: 'remote', label: M.keepRemote }, { value: 'skip', label: 'ninguna por ahora' }], { default: 'skip' });
        if (pick !== 'skip') w.plan.resolved.push({ ...c, pick });
      }
      w.plan.accepted = [];
      for (const pr of w.plan.proposals) {
        if (!flags.yes && (await prompter.confirm(`proposal:${pr.remote.key}`, M.addProposal(pr), { default: false }))) w.plan.accepted.push(pr);
      }
    }
    const creates = work.reduce((n, w) => n + w.plan.create.length, 0);
    const updates = work.reduce((n, w) => n + w.plan.push.length + w.plan.resolved.filter((r) => r.pick === 'local').length, 0);
    // RF-TRK-08: confirmation before touching the tracker.
    if ((creates || updates) && !flags.yes && !(await prompter.confirm('remote', M.confirmRemote(creates, updates), { default: true }))) {
      out(M.aborted);
      return 1;
    }

    const links = new Map();
    try {
      for (const w of work) {
        for (const x of w.plan.create) {
          const body = `Tarea ${x.task.id} de la spec ${w.spec.id} (sdd-harness). La spec vive en el repositorio; aquí solo se sincronizan estado y título.`;
          const created = await client.create(w.spec.id, x.title, body);
          if (x.task.done) await client.update(created.number, { title: x.title, done: true });
          links.set(`${w.spec.id}:${x.task.id}`, `github:${created.key}`);
        }
        for (const x of w.plan.push) await client.update(x.remote.number, { title: x.title, done: x.done });
        for (const r of w.plan.resolved.filter((y) => y.pick === 'local')) await client.update(r.remote.number, { title: `${r.task.id} ${r.task.title}`, done: r.task.done });
      }
    } catch (e) {
      err(M.failed(e.message));
      return 1;
    }

    // Local side: never the spec (RF-TRK-05), only tasks.md.
    for (const w of work) {
      let text = w.text;
      for (const x of w.plan.create) text = updateTaskLine(text, x.task.id, { link: links.get(`${w.spec.id}:${x.task.id}`) });
      for (const x of w.plan.pull) text = updateTaskLine(text, x.task.id, { title: x.title, done: x.done });
      for (const r of w.plan.resolved.filter((y) => y.pick === 'remote')) text = updateTaskLine(text, r.task.id, { title: r.remote.title.replace(/^T\d+\s+/, ''), done: r.remote.done });
      let tasks = linkedTasks(text);
      for (const pr of w.plan.accepted) {
        const id = nextTaskId(tasks);
        text = `${text.replace(/\n*$/, '\n')}- [${pr.remote.done ? 'x' : ' '}] ${id} ${pr.title} <!-- github:${pr.remote.key} -->\n`;
        tasks = linkedTasks(text);
      }
      if (text !== w.text) writeFileSync(w.file, text);
      // Unresolved conflicts and tasks gone from the tracker keep their old base,
      // so the next sync asks again instead of picking a side.
      const previous = base.specs[w.spec.id] ?? {};
      const pending = new Set([
        ...w.plan.conflicts.filter((c) => !w.plan.resolved.some((r) => r.task.id === c.task.id)).map((c) => c.task.id),
        ...w.plan.missing.map((m) => m.task.id),
      ]);
      base.specs[w.spec.id] = Object.fromEntries(linkedTasks(text).filter((t) => t.link).map((t) => [
        t.id,
        pending.has(t.id) && previous[t.id] ? previous[t.id] : { title: t.title, done: t.done, key: t.link },
      ]));
    }
    base.at = new Date().toISOString();
    mkdirSync(path.dirname(baseFile), { recursive: true });
    writeFileSync(baseFile, JSON.stringify(base, null, 2) + '\n');
    out(M.done);
    return 0;
  } catch (e) {
    if (e instanceof CancelledError) return 130;
    throw e;
  } finally {
    prompter.close();
  }
}
