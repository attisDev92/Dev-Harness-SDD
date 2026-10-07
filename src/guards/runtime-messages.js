// Messages of the flow runtime (hooks and sdd.js), for agents and users.
// MVP: Spanish only; English falls back to it. Dependency-free: copied into .harness/scripts/.

const S = 'node .harness/scripts/sdd.js';

const es = {
  verdict: {
    harnessFile: (v) => `Bloqueado: "${v.match}" pertenece al harness (.harness/ o un archivo generado). Los agentes no lo cambian; si hace falta, cambia harness.config.yaml y la configuración se regenera sola.`,
    contextBlock: (v) => `Bloqueado: el bloque generado de ${v.match} (entre <!-- harness:begin --> y <!-- harness:end -->) lo mantiene el harness. Escribe tus instrucciones fuera del bloque.`,
    docBlocked: (v) => `Bloqueado: "${v.match}" no está en la lista blanca de documentación (gates.docs: whitelist). Permitidos: ${(v.allowed ?? []).join(', ')}. Si el usuario lo pidió, añádelo a docs_whitelist en harness.config.yaml.`,
    needsApproval: (v) => `Aviso: escribes ${v.match} y la spec todavía no está aprobada. Si el usuario ya dijo que sí, registra la aprobación (${S} approve); si no, pregúntale antes de seguir.`,
    depsEdit: (v) => `Aviso: ${v.match} cambia dependencias o un lockfile. Menciónalo en tu resumen.`,
    protectedZone: (v) => `Aviso: ${v.match} está en la zona protegida "${v.zone}". Sigue si es lo que pidió el usuario, deja la decisión en un ADR en borrador (${S} new-adr <nombre>) y cuéntala en tu resumen.`,
    noTask: (v) => `Aviso: ${v.match} es código del componente "${v.component}" y no hay ninguna tarea pendiente suya. Si es trabajo nuevo, añádelo a tasks.md como tarea "añadida en implementación" (y a la spec si cambia un requisito) y sigue.`,
    outOfScope: (v) => `Aviso: ${v.match} está fuera del alcance de ${v.task} (${(v.scope ?? []).join(', ')}). Si es parte de la tarea, amplía su alcance en tasks.md; si es trabajo nuevo, añade una tarea. Sigue.`,
  },
  stop: {
    unknown: (s) => `Parada desconocida "${s}". Usa spec o plan.`,
    requested: (stop, id) => `Parada "${stop}" de ${id} registrada. Pregunta al usuario si aprueba (AskUserQuestion con "Aprobar" como primera opción, o en texto). Una respuesta afirmativa ("sí", "continúa", "aprobado", "dale"…) queda registrada sola; si elige "Aprobar" en AskUserQuestion, ejecuta ${S} approve. Cualquier otra respuesta son cambios: aplícalos y vuelve a preguntar.`,
    approved: (stop, id) => `Aprobado: ${stop} de ${id}. ${stop === 'spec' ? 'Siguiente: plan, contratos y tasks.md (subagente architect), y la parada "plan".' : 'Siguiente: implementar. Lanza las tareas listas, hasta 2 a la vez (' + S + ' next).'}`,
    nothingPending: () => 'No hay ninguna parada pendiente. Pide primero la aprobación al usuario.',
  },
  hook: {
    approvedByUser: (stop, id, text) => `El usuario APROBÓ ${stop} de ${id}${text ? ` ("${text}")` : ''}; ya está registrado en spec.md. Sigue con el siguiente paso sin volver a preguntar.`,
    changesRequested: (stop, id) => `El usuario no aprobó todavía ${stop} de ${id}: su mensaje son cambios o preguntas. Atiéndelos, actualiza los documentos y vuelve a pedir la aprobación.`,
    resumed: (s) => `sdd-harness: trabajo en curso.\n${s}`,
    stopVerify: (c, cmd) => `La última verificación de ${c} falló (${cmd}). Corrígela (hasta 2 intentos) o, si no es posible, inicia el triage con el debugger y díselo al usuario. Ninguna tarea se da por hecha con la verificación en rojo.`,
    tooMany: (role, n) => `Aviso: lanzas ${role} con ${n} subagentes ya trabajando. El máximo son 2 a la vez, del rol que sea: no se les puede seguir la pista y el consumo de tokens se dispara. Espera a que termine uno antes de lanzar más.`,
    lanes: (role, files) => `El subagente ${role} cambió archivos fuera de sus rutas: ${files.join(', ')}. Revisa si es intencionado y cuéntaselo al usuario en tu resumen.`,
    configSynced: (out) => `harness.config.yaml cambió y la configuración se regeneró (sdd-harness sync).${out ? `\n${out}` : ''}`,
    configSyncFailed: (err) => `harness.config.yaml cambió, pero no se pudo regenerar la configuración: ${err}. Pide al usuario que ejecute "sdd-harness sync".`,
  },
  next: {
    noSpec: () => 'No hay spec en curso. Crea una: node .harness/scripts/sdd.js new-spec <nombre>.',
    notApproved: (status) => `El plan todavía no está aprobado (estado: ${status}). Pide la parada "plan" antes de implementar.`,
    noTasks: (f) => `${f} no tiene tareas.`,
    allDone: () => 'Todas las tareas están hechas. Siguiente: validar la spec (node .harness/scripts/sdd.js validate).',
    ready: (t, role) => [
      `${t.id} ${t.title}  →  ${role} (${t.component})`,
      ...(t.scope.length ? [`  Alcance: ${t.scope.join(', ')}`] : []),
      ...(t.requirements.length ? [`  Requisitos: ${t.requirements.join(', ')}`] : []),
      ...(t.doneWhen ? [`  Hecho cuando: ${t.doneWhen}`] : []),
    ].join('\n'),
    parallel: () => 'Delégalas a la vez (varias llamadas a subagentes en el mismo mensaje). Máximo 2 subagentes trabajando a la vez, del rol que sea. Tests primero. Al terminar cada una: verify --component <id>, marca su casilla en tasks.md, y lanza reviewer y doc-writer solo si hay hueco (si no, de uno en uno).',
    queued: (ids) => `Sin hueco ahora (máximo 2 a la vez): ${ids.join(', ')}. Vuelve a llamar a next cuando termine una.`,
    waiting: (w) => `Esperando dependencias: ${w.map((x) => `${x.task.id} espera a ${x.on.join(', ')}`).join(' · ')}.`,
    problems: (t, ps) => `${t} necesita arreglo en tasks.md: ${ps.join(', ')}.`,
    noVerify: (c) => `El componente "${c}" no tiene comandos de verificación: añade components.${c}.verify a harness.config.yaml (RF-VER-02).`,
  },
  verify: {
    pass: (c) => `La verificación de ${c} pasó. Marca las tareas terminadas en tasks.md; después reviewer y doc-writer, en paralelo solo si no hay otro subagente trabajando (máximo 2 a la vez).`,
    fail: (f) => `La verificación falló: ${f.name} (${f.command}). Corrígela, hasta 2 intentos; si el error se repite o necesitas salirte del alcance, triage con el debugger y pregunta al usuario.`,
    unconfigured: (c) => `El componente "${c}" no tiene comandos de verificación (RF-VER-02).`,
    pickComponent: (all) => `Indica el componente: --component <${all.join('|')}>.`,
  },
  spec: {
    created: (id, file) => `Spec ${id} creada: ${file}. Entrevista al usuario con una pregunta cada vez (6 como máximo), complétala y pide la parada "spec".`,
    unknownComponent: (c, all) => `Componente desconocido "${c}". Usa uno de: ${all.join(', ')}.`,
    componentRequired: (all) => `Las specs viven en cada repo (specs.location: per-repo) y hay varios componentes: indica --component <${all.join('|')}>.`,
    idInvalid: (v) => `--id "${v}" no es válido: usa un número de 1 a 999 (por ejemplo --id 7 o --id 007).`,
    idTaken: (id) => `${id} ya existe en esta rama. Elige otro número con --id, acordado con el resto del equipo.`,
    idOnBranch: (id, ref) => `Aviso: ${id} ya existe en la rama ${ref}. Si no es la misma spec, acordad otro número antes de fusionar.`,
    skipped: (list) => `Números saltados porque ya existen en otras ramas: ${list.join(', ')}.`,
    adrCreated: (f) => `Borrador de ADR creado: ${f}`,
  },
  status: {
    title: 'Estado de sdd-harness',
    spec: 'Spec en curso', phase: 'Estado', pending: 'Parada pendiente', done: 'Hechas', open: 'Pendientes', added: 'Añadidas en implementación',
    ready: 'Listas para empezar', verify: 'Última verificación', lastCommits: 'Últimos commits', warnings: 'Avisos', none: '—',
    missingDependency: (ref) => `depende de ${ref}, que no existe`,
  },
  validate: {
    covered: (id, files) => `  ✔ ${id}: ${files.join(', ')}`,
    uncovered: (id) => `  ✖ ${id}: sin ningún test`,
    summary: (c, n) => `${c} de ${n} requisitos tienen al menos un test. Ejecuta la verificación y da el veredicto requisito por requisito.`,
    closed: (id) => `Todas las tareas de ${id} están hechas: la spec queda como "done".`,
  },
  contract: {
    noProvider: (p) => `No encuentro la spec proveedora "${p.ref}". Usa repo#ID-NNN (por ejemplo api#API-004).`,
    noContract: (p) => `La spec ${p.spec} no tiene contratos en contracts/${p.files?.length ? ` (hay: ${p.files.join(', ')})` : ''}.`,
    imported: (f, s) => `Snapshot creado: ${f} (de ${s.repo}, spec ${s.spec}, commit ${s.commit ?? 'sin commits'}). Adaptarse a un cambio de este contrato se consulta con el usuario.`,
  },
  tracker: {
    disabled: 'No hay tracker activado en harness.config.yaml (tracker.enabled y tracker.provider).',
    badInput: (m) => `Entrada no válida: ${m}. Formato: {"<SPEC-ID>": [{"key": "ABC-1", "title": "T1 …", "done": false}]}`,
    spec: (id) => `Spec ${id}:`,
    create: (x) => `  → crear en el tracker: ${x.title}`,
    push: (x) => `  → actualizar ${x.remote.key}: ${x.title} (${x.done ? 'cerrada' : 'abierta'})`,
    pull: (x) => `  ← actualizar ${x.task.id} en tasks.md: ${x.title} (${x.done ? 'hecha' : 'pendiente'})`,
    conflict: (x) => `  ! ${x.task.id} cambió en ambos lados: local "${x.task.title}" · tracker "${x.remote.title}". Pregunta al usuario cuál conservar.`,
    missing: (x) => `  ! ${x.task.id} está vinculada a ${x.key}, que ya no existe en el tracker. No se borra nada: pregunta al usuario.`,
    proposal: (x) => `  ? nueva en el tracker: ${x.remote.key} "${x.title}". Solo se añade a tasks.md si el usuario lo acepta.`,
    nothing: 'Todo está sincronizado.',
    needsOk: (c, u) => `Hay que crear ${c} y actualizar ${u} elementos en el tracker. Enséñale el plan al usuario y hazlo cuando diga que sí.`,
    localOnly: 'No hay nada que escribir en el tracker. Aplica los cambios locales: node .harness/scripts/sdd.js tracker apply',
    noPlan: 'No hay plan de sincronización. Ejecuta antes: node .harness/scripts/sdd.js tracker plan',
    applied: (n) => `tasks.md actualizado en ${n} spec${n === 1 ? '' : 's'}. La spec no se toca.`,
  },
};

export function runtimeMessages() {
  return es;
}

/** Text of a guard verdict. */
export function verdictText(v) {
  const f = es.verdict[v.kind];
  return f ? f(v) : `${v.kind}: ${v.match}`;
}
