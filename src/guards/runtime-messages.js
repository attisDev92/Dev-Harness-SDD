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
    protectedZone: (v) => v.zone === 'db'
      ? `Aviso: ${v.match} cambia el esquema y no hay un plan aprobado con modelo de datos que lo recoja. Si es parte de la spec, añádelo al modelo de datos de plan.md y cuéntalo en tu resumen. Crea un ADR (${S} new-adr <nombre>) solo si es una decisión estructural: motor de base de datos, multi-tenant, particionado, o borrar o transformar datos existentes.`
      : `Aviso: ${v.match} está en la zona protegida "${v.zone}". Sigue si es lo que pidió el usuario, deja la decisión en un ADR en borrador (${S} new-adr <nombre>) y cuéntala en tu resumen.`,
    noTask: (v) => `Aviso: ${v.match} es código del componente "${v.component}" y no hay ninguna tarea pendiente suya. Si es trabajo nuevo, añade una tarea "añadida en implementación" o menciónalo en tu resumen. Sigue.`,
    outOfScope: (v) => `Aviso: ${v.match} está fuera del alcance de ${v.task} (${(v.scope ?? []).join(', ')}). Menciónalo en tu resumen y sigue.`,
  },
  stop: {
    unknown: (s) => `Parada desconocida "${s}". Usa spec o plan.`,
    requested: (stop, id) => `Parada "${stop}" de ${id} registrada. Pregunta al usuario si aprueba (AskUserQuestion con "Aprobar" como primera opción, o en texto). Una respuesta afirmativa ("sí", "continúa", "aprobado", "dale"…) queda registrada sola; si elige "Aprobar" en AskUserQuestion, ejecuta ${S} approve. Cualquier otra respuesta son cambios: aplícalos y vuelve a preguntar.`,
    approved: (stop, id, max = 2) => `Aprobado: ${stop} de ${id}. ${stop === 'spec' ? 'Siguiente: plan, contratos y tasks.md (subagente architect), y la parada "plan".' : `Siguiente: implementar. Lanza las tareas listas, hasta ${max} a la vez (${S} next).`}`,
    nothingPending: () => 'No hay ninguna parada pendiente. Pide primero la aprobación al usuario.',
    openClarifications: (n, id) => `La spec ${id} tiene ${n} aclaración${n === 1 ? '' : 'es'} pendiente${n === 1 ? '' : 's'} y gates.decisions es "interview": entrevista al usuario (una pregunta cada vez), escribe las respuestas en spec.md y vuelve a pedir la parada.`,
  },
  decisions: {
    none: () => 'No hay decisiones pendientes del usuario.',
    title: (id, n) => `Decisiones pendientes de ${id} (${n}):`,
    item: (d) => ({
      clarification: `  ? Aclaración en ${d.file}: ${d.text}`,
      adr: `  ? ADR en borrador (${d.file}): ${d.text}`,
      added: `  ? Tarea añadida en implementación, sin confirmar: ${d.text}`,
      alert: `  ? ${d.text}  [clave: ${d.key}]`,
    })[d.kind],
    interview: () => `Entrevista al usuario: una pregunta cada vez, con 2–3 opciones y tu recomendación. Aplica cada respuesta donde toca (spec.md, plan.md, el ADR o tasks.md) y, para las de clave, registra la decisión con ${S} decisions --resolve <clave>. Después sigue.`,
    summary: () => `Cuéntaselas al usuario en tu resumen y sigue; lo que sea suyo lo decide él. Al resolverse una, actualiza el documento o registra la de clave con ${S} decisions --resolve <clave>.`,
    resolved: (k) => `Decisión registrada como resuelta: ${k}.`,
    unknown: (k) => `No hay ninguna decisión pendiente con la clave "${k}".`,
  },
  pause: {
    on: (n) => `Pausa registrada. ${n ? `${n === 1 ? 'El subagente activo termina' : `Los ${n} subagentes activos terminan`} su tarea (verify, done y su informe); no` : 'No'} lances ningún subagente nuevo ni empieces tareas nuevas. Deja tasks.md, progress.md y los docs al día y da un resumen de dónde queda todo y cómo retomar (${S} resume o /sdd:resume).`,
    already: (at) => `Ya estaba en pausa desde ${at}. No lances subagentes nuevos; termina lo activo y da el resumen.`,
    off: () => `Pausa retirada. Sigue con ${S} next.`,
    notPaused: () => 'No había ninguna pausa activa.',
    nextPaused: (at) => `En pausa desde ${at}: no se lanzan tareas nuevas. Termina lo que esté activo y da el resumen de dónde queda todo. Para retomar: ${S} resume.`,
    launchBlocked: (role, at) => `Bloqueado: el usuario pidió pausar (${at}) y ${role} sería un subagente nuevo. Termina lo activo, deja los documentos al día y da el resumen. Si el usuario ya dijo que sigamos, ejecuta ${S} resume y vuelve a lanzarlo.`,
  },
  hook: {
    approvedByUser: (stop, id, text) => `El usuario APROBÓ ${stop} de ${id}${text ? ` ("${text}")` : ''}; ya está registrado en spec.md. Sigue con el siguiente paso sin volver a preguntar.`,
    changesRequested: (stop, id) => `El usuario no aprobó todavía ${stop} de ${id}: su mensaje son cambios o preguntas. Atiéndelos, actualiza los documentos y vuelve a pedir la aprobación.`,
    resumed: (s) => `sdd-harness: trabajo en curso.\n${s}`,
    stopVerify: (c, cmd) => `La última verificación de ${c} falló (${cmd}). Corrígela (hasta 2 intentos) o, si no es posible, inicia el triage con el debugger y díselo al usuario. Ninguna tarea se da por hecha con la verificación en rojo.`,
    tooMany: (role, n, max = 2) => `Aviso: lanzas ${role} con ${n} subagentes ya trabajando. El máximo son ${max} a la vez, del rol que sea: no se les puede seguir la pista y el consumo de tokens se dispara. Espera a que termine uno antes de lanzar más.`,
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
    batch: (ids) => `  Lote recomendado: ${ids.join(' → ')} (un solo subagente para todas).`,
    parallel: (max = 2) => `Delégalas a la vez (varias llamadas a subagentes en el mismo mensaje), pasando a cada subagente la salida de ${S} brief <TID> tal cual. Máximo ${max} subagente${max === 1 ? '' : 's'} trabajando a la vez. Tests primero. Al terminar: ${S} verify --component <id> --tests, luego ${S} done <TID>.`,
    queued: (ids, max = 2) => `Sin hueco ahora (máximo ${max} a la vez): ${ids.join(', ')}. Vuelve a llamar a next cuando termine una.`,
    waiting: (w) => `Esperando dependencias: ${w.map((x) => `${x.task.id} espera a ${x.on.join(', ')}`).join(' · ')}.`,
    problems: (t, ps) => `${t} necesita arreglo en tasks.md: ${ps.join(', ')}.`,
    noVerify: (c) => `El componente "${c}" no tiene comandos de verificación: añade components.${c}.verify a harness.config.yaml (RF-VER-02).`,
  },
  done: {
    notFound: (id) => `Tarea ${id} no encontrada en tasks.md.`,
    alreadyDone: (id) => `La tarea ${id} ya estaba marcada como hecha.`,
    marked: (id, note) => `Tarea ${id} marcada como hecha en tasks.md.${note ? ` Nota registrada en progress.md.` : ''}`,
    notVerified: (id, c) => `No se cierra ${id}: la última verificación de "${c}" no está en verde. Ejecuta ${S} verify --component ${c} --tests y, cuando pase, vuelve a ${S} done ${id}. Nunca des por pasados tests que no has ejecutado.`,
    stale: (id, c) => `No se cierra ${id}: los archivos de "${c}" cambiaron después de la última verificación. Ejecuta de nuevo ${S} verify --component ${c} --tests y después ${S} done ${id}.`,
    noVerifyNote: (c) => `Aviso: "${c}" no tiene comandos de verificación, así que la tarea se cierra sin comprobar nada. Añade components.${c}.verify a harness.config.yaml.`,
  },
  brief: {
    notFound: (id) => `Tarea ${id} no encontrada.`,
    rulesTitle: 'Reglas para el subagente (pásale este brief tal cual):',
    rules: (role, comp, cmds) => [
      `- Actúa como el rol \`${role}\`: carga la skill \`role-${role}\` si existe (en Claude Code ya eres ese agente).`,
      '- Tests primero: escribe el test del requisito (con su ID, p. ej. RF-01, en el nombre) y luego el código mínimo que lo pasa.',
      '- Toca solo el alcance de la tarea. Nada de refactors, limpieza, cambios de estilo o de UI ni "mejoras" fuera de ella: si hacen falta, repórtalas como tarea nueva en vez de hacerlas.',
      `- Verifica de verdad: ejecuta ${cmds.length ? cmds.map((c) => `\`${c}\``).join(', ') : 'los comandos de verificación del componente'} desde \`${comp}\` y pega el resultado real. No inventes ni resumas tests que no has ejecutado; la tarea solo se cierra con ${S} verify en verde.`,
      '- Al terminar informa: archivos cambiados, resultado de la verificación y trabajo nuevo que surgió. Sin commit ni push.',
    ].join('\n'),
  },
  focus: {
    set: (id) => `Spec en curso fijada: ${id}.`,
    cleared: () => 'Foco automático activado (siguiente spec según avance).',
    notFound: (id) => `Spec "${id}" no encontrada.`,
  },
  verify: {
    pass: (c, max = 2) => `La verificación de ${c} pasó. Cierra las tareas terminadas con ${S} done <TID>; al cerrar la historia, reviewer y doc-writer, en paralelo solo si hay hueco (máximo ${max} a la vez).`,
    fail: (f) => `La verificación falló: ${f.name} (${f.command}). Corrígela, hasta 2 intentos; si el error se repite o necesitas salirte del alcance, triage con el debugger y pregunta al usuario.`,
    unconfigured: (c) => `El componente "${c}" no tiene comandos de verificación (RF-VER-02).`,
    noEval: () => 'Ningún componente tiene verify.eval: no hay evaluaciones que correr.',
    evalPass: (c) => `Evaluaciones de ${c}: pasan. Cuéntalo al usuario con la propuesta de commit.`,
    evalFail: (c) => `Evaluaciones de ${c}: no pasan. No son deterministas y cuestan dinero: no las repitas para que pasen ni corrijas a ciegas. Enseña el resultado al usuario con la propuesta de commit y que decida.`,
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
    paused: (at) => `En pausa desde ${at}: no se lanzan tareas nuevas (retomar: ${S} resume)`,
    decisions: (n, mode) => `Decisiones pendientes del usuario: ${n} (${S} decisions${mode === 'interview' ? '; entrevístale antes de seguir' : ''})`,
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
