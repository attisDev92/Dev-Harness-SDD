// Messages of the flow runtime (hooks and sdd.js), for agents and users.
// Dependency-free: copied into .harness/scripts/.

const APPROVE_HINT = {
  en: 'Stop here and ask the user to reply "/sdd:approve" or "/sdd:reject <reason>". Do not continue until they answer.',
  es: 'Detente aquí y pide al usuario que responda "/sdd:approve" o "/sdd:reject <motivo>". No sigas hasta que responda.',
};

const en = {
  verdict: {
    harnessFile: (v) => `Blocked: "${v.match}" belongs to the harness (harness.config.yaml, .harness/ or a generated file). Agents never change it; tell the user what should change.`,
    progressBlock: (v) => `Blocked: the status block of ${v.match} is maintained by the harness scripts. Write your notes outside the block.`,
    specApproved: (v) => `Blocked: ${v.match} is approved. Changes to an approved spec go through /sdd:change (run: node .harness/scripts/sdd.js change start).`,
    needsApproval: (v) => `Blocked: ${v.match} needs the ${v.phase} to be approved first (RF-SDD-13). Request it with: node .harness/scripts/sdd.js gate request ${v.phase}`,
    tasksApproved: (v) => `Blocked: the tasks are approved; only "node .harness/scripts/sdd.js task done <T#>" ticks them. Changes go through /sdd:change.`,
    constitutionApproved: (v) => `Blocked: ${v.match} is approved. Propose the change to the user; they edit it.`,
    depsEdit: (v) => `${v.match} changes dependencies or a lockfile. The user must approve it.`,
    depsInstall: (v) => `"${v.match}" adds, removes or upgrades dependencies. The user must approve it.`,
    protectedZone: (v) => `Blocked: ${v.match} is in the protected zone "${v.zone}". Stop and present what you want to change and why, the alternatives, and an ADR draft (node .harness/scripts/sdd.js new-adr <name>); then request approval: node .harness/scripts/sdd.js gate request protected --files ${v.match} --adr <ADR file>`,
    triageNoCode: () => 'Blocked: triage is in progress. No code changes until the user chooses an option from the triage report.',
    gatePending: (v) => `Blocked: a decision is pending (${v.gate}). Wait for the user's answer before changing code.`,
    changePending: () => 'Blocked: a spec change is in progress. Show the spec diff and get it approved (gate request change) before touching code.',
    noTask: (v) => `Blocked: ${v.match} is code and no task is in progress. Start one with /sdd:next (node .harness/scripts/sdd.js next).`,
    otherComponent: (v) => `Blocked: ${v.match} belongs to component "${v.component}", but task ${v.task} is for another component.`,
    outOfScope: (v) => `Blocked: ${v.match} is outside the scope of task ${v.task} (${(v.scope ?? []).join(', ')}). A fix that needs it is not automatic: start triage (node .harness/scripts/sdd.js triage start) and let the user decide.`,
    hookCall: () => 'Blocked: the harness hooks are run by the tool, never by the agent.',
  },
  gate: {
    unknownGate: (p) => `Unknown gate "${p.kind}". Use one of: ${p.kinds.join(', ')}.`,
    gatePending: (p) => `A decision is already pending (${p.kind}). Wait for the user.`,
    noActiveSpec: () => 'There is no active spec. Create one with /sdd:spec (node .harness/scripts/sdd.js new-spec <name>).',
    needsApproval: (p) => `The ${p.phase} must be approved first.`,
    noTask: () => 'No task is in progress.',
    verifyFirst: () => 'Verification must pass (node .harness/scripts/sdd.js verify) before asking for the manual test.',
    filesRequired: () => 'List the files with --files a,b.',
    adrRequired: () => 'A protected-zone change needs an ADR draft: pass --adr docs/decisions/ADR-NNNN-name.md.',
    noChange: () => 'No spec change is in progress (node .harness/scripts/sdd.js change start).',
    noTriage: () => 'No triage is in progress.',
    requested: (kind) => `Decision requested: ${kind}. ${kind === 'manual-test' ? 'Give the manual test instructions, then ask the user to reply "OK" or "KO <what failed>". Do not continue until they answer.' : APPROVE_HINT.en}`,
  },
  next: {
    lockHeld: (h) => `Another session (${h.session}) has work in progress since ${h.started}. Only one session may run tasks at a time.`,
    gatePending: (k) => `A decision is pending (${k}). Wait for the user.`,
    manualPending: (t) => `Task ${t} is waiting for the user's manual test. It is not done and no other task can start.`,
    triage: (t) => `Task ${t} is in triage. Wait for the user to choose an option.`,
    inProgress: (t) => `Task ${t} is still in progress. Finish it (verify, review, manual test, task done) first.`,
    noSpec: () => 'There is no active spec.',
    tasksNotApproved: () => 'The tasks of the active spec are not approved yet.',
    noTasks: (f) => `${f} has no tasks.`,
    allDone: () => 'All tasks are done. Next: /sdd:validate.',
    problems: (t, ps) => `Task ${t} cannot run yet: ${ps.join(', ')}. Complete it in tasks.md through /sdd:change.`,
    noVerify: (c) => `Component "${c}" has no verification commands. Ask the user to add components.${c}.verify to harness.config.yaml and run "sdd-harness sync" (RF-VER-02).`,
    storyPending: (s) => `The manual test of ${s} is pending: request it before starting new work.`,
    started: (t, role) => [
      `Task ${t.id}: ${t.title}`,
      `Component: ${t.component} · Role: ${role} · Scope: ${t.scope.join(', ')}`,
      `Requirements: ${t.requirements.join(', ')}`,
      `Done when: ${t.doneWhen}`,
      '',
      `Delegate it to the ${role} subagent. It writes the tests first, then the code, only inside the scope.`,
      'Then run: node .harness/scripts/sdd.js verify',
    ].join('\n'),
  },
  verify: {
    pass: (c) => `Verification passed for ${c}. Next: review (reviewer subagent), then request the manual test.`,
    fail: (f, v) => `Verification failed: ${f.name} (${f.command}).\n${v.decision === 'retry' ? `Automatic fix attempt ${v.attempt} of ${v.max} allowed, only inside the task scope.` : v.kind === 'retryRepeated' ? 'The same error happened twice in a row: stop and start triage (node .harness/scripts/sdd.js triage start).' : `The ${v.max} automatic attempts are used up: stop and start triage (node .harness/scripts/sdd.js triage start).`}`,
    unconfigured: (c) => `Component "${c}" has no verification commands (RF-VER-02).`,
  },
  done: {
    notCurrent: (t) => `Task ${t} is not the task in progress.`,
    needsVerify: () => 'Verification is not green. Run node .harness/scripts/sdd.js verify.',
    needsManual: () => 'The user has not approved the manual test yet.',
    done: (t) => `Task ${t} is done and ticked in tasks.md. Next: /sdd:next.`,
  },
  triage: {
    started: () => 'Triage started. Delegate to the debugger subagent: error, reproduction steps, hypotheses by likelihood, 2–3 options with pros and cons, and a recommendation. No code changes. Then request the decision: node .harness/scripts/sdd.js gate request triage',
    already: () => 'Triage is already in progress.',
  },
  change: {
    started: (s) => `Change mode for ${s}: update the spec first, show the diff, then request approval (node .harness/scripts/sdd.js gate request change). No code until it is approved.`,
  },
  spec: {
    created: (id, file) => `Spec ${id} created: ${file}. Interview the user one question at a time (6 at most), then fill it in.`,
    unknownComponent: (c, all) => `Unknown component "${c}". Use one of: ${all.join(', ')}.`,
    componentRequired: (all) => `Several components exist: pass --component <${all.join('|')}>.`,
    adrCreated: (f) => `ADR draft created: ${f}`,
  },
  hook: {
    approved: (k, text) => `The user APPROVED the pending decision (${k})${text ? `: "${text}"` : ''}. Continue with the next step.`,
    rejected: (k, text) => `The user REJECTED the pending decision (${k})${text ? `: "${text}"` : ''}. Do not continue with that step.`,
    triageFromKo: () => 'The manual test failed (KO): start the debugger triage now. Do not change code.',
    noGate: () => 'There is no pending decision to approve or reject.',
    resumed: (s) => `sdd-harness: resuming the work in progress.\n${s}`,
    rebuilt: () => 'Note: .harness/state was missing; the flow state was rebuilt from progress.md. Check it with /sdd:status.',
    stopVerify: (t, f) => `Task ${t} has ${f ? `failing verification (${f})` : 'changes that were not verified'}. Run node .harness/scripts/sdd.js verify before finishing; a task is never done with red verification.`,
    lanes: (role, files) => `The ${role} subagent changed files outside its paths: ${files.join(', ')}. Stop, show them to the user and ask whether to keep or discard them (node .harness/scripts/sdd.js gate request lanes --files ${files.join(',')}). Do not revert anything yourself.`,
    lockBusy: (h) => `Another session (${h.session}) is running tasks in this project. Wait until it finishes.`,
  },
  status: {
    title: 'sdd-harness status',
    spec: 'Active spec', phase: 'Phase', approved: 'Approved', task: 'Current task', gate: 'Pending decision', triage: 'Triage', blocks: 'Blockers', cost: 'Cost', none: '—', notAvailable: 'not available',
  },
  validate: {
    covered: (id, files) => `  ✔ ${id}: ${files.join(', ')}`,
    uncovered: (id) => `  ✖ ${id}: not covered by any test`,
    summary: (c, n) => `${c} of ${n} requirements have at least one test. Run the verification and give the verdict requirement by requirement.`,
  },
};

const es = {
  verdict: {
    harnessFile: (v) => (v.match === 'harness.config.yaml'
      ? 'Bloqueado: harness.config.yaml se cambia con la aprobación del usuario. Explica qué quieres cambiar y por qué, y pide la compuerta: node .harness/scripts/sdd.js gate request config --summary "<cambio>"'
      : `Bloqueado: "${v.match}" pertenece al harness (.harness/ o un archivo generado). Los agentes nunca lo cambian; di al usuario qué debería cambiar.`),
    progressBlock: (v) => `Bloqueado: el bloque de estado de ${v.match} lo mantienen los scripts del harness. Escribe tus notas fuera del bloque.`,
    contextBlock: (v) => `Bloqueado: el bloque generado de ${v.match} (entre <!-- harness:begin --> y <!-- harness:end -->) lo mantiene el harness. Escribe tus instrucciones fuera del bloque, con Edit o Write (no desde la shell).`,
    specApproved: (v) => `Bloqueado: ${v.match} está aprobada. Los cambios a una spec aprobada pasan por /sdd:change (ejecuta: node .harness/scripts/sdd.js change start).`,
    needsApproval: (v) => `Bloqueado: ${v.match} necesita que antes se apruebe ${v.phase} (RF-SDD-13). Pídelo con: node .harness/scripts/sdd.js gate request ${v.phase}`,
    tasksApproved: () => 'Bloqueado: las tareas están aprobadas; solo "node .harness/scripts/sdd.js task done <T#>" las marca. Los cambios pasan por /sdd:change.',
    constitutionApproved: (v) => `Bloqueado: ${v.match} está aprobada. Propón el cambio al usuario; lo edita él.`,
    depsEdit: (v) => `${v.match} cambia dependencias o un lockfile. El usuario debe aprobarlo.`,
    depsInstall: (v) => `"${v.match}" añade, quita o actualiza dependencias. El usuario debe aprobarlo.`,
    protectedZone: (v) => `Bloqueado: ${v.match} está en la zona protegida "${v.zone}". Detente y presenta qué quieres cambiar y por qué, las alternativas y un borrador de ADR (node .harness/scripts/sdd.js new-adr <nombre>); después pide aprobación: node .harness/scripts/sdd.js gate request protected --files ${v.match} --adr <archivo ADR>`,
    triageNoCode: () => 'Bloqueado: hay un triage en curso. No se cambia código hasta que el usuario elija una opción del informe.',
    gatePending: (v) => `Bloqueado: hay una decisión pendiente (${v.gate}). Espera la respuesta del usuario antes de cambiar código.`,
    changePending: () => 'Bloqueado: hay un cambio de spec en curso. Muestra el diff de la spec y consigue su aprobación (gate request change) antes de tocar código.',
    noTask: (v) => `Bloqueado: ${v.match} es código y no hay ninguna tarea en curso. Empieza una con /sdd:next (node .harness/scripts/sdd.js next).`,
    otherComponent: (v) => `Bloqueado: ${v.match} pertenece al componente "${v.component}", pero la tarea ${v.task} es de otro componente.`,
    outOfScope: (v) => `Bloqueado: ${v.match} está fuera del alcance de la tarea ${v.task} (${(v.scope ?? []).join(', ')}). Un arreglo que lo necesite no es automático: inicia el triage (node .harness/scripts/sdd.js triage start) y deja decidir al usuario.`,
    hookCall: () => 'Bloqueado: los hooks del harness los ejecuta la herramienta, nunca el agente.',
  },
  gate: {
    unknownGate: (p) => `Gate desconocido "${p.kind}". Usa uno de: ${p.kinds.join(', ')}.`,
    gatePending: (p) => `Ya hay una decisión pendiente (${p.kind}). Espera al usuario.`,
    noActiveSpec: () => 'No hay spec activa. Crea una con /sdd:spec (node .harness/scripts/sdd.js new-spec <nombre>).',
    needsApproval: (p) => `Antes hay que aprobar ${p.phase}.`,
    noTask: () => 'No hay ninguna tarea en curso.',
    verifyFirst: () => 'La verificación debe pasar (node .harness/scripts/sdd.js verify) antes de pedir la prueba manual.',
    filesRequired: () => 'Indica los archivos con --files a,b.',
    summaryRequired: () => 'Describe el cambio de configuración con --summary "<cambio>".',
    adrRequired: () => 'Un cambio en zona protegida necesita un borrador de ADR: pasa --adr docs/decisions/ADR-NNNN-nombre.md.',
    noChange: () => 'No hay ningún cambio de spec en curso (node .harness/scripts/sdd.js change start).',
    noTriage: () => 'No hay ningún triage en curso.',
    requested: (kind) => `Decisión solicitada: ${kind}. ${kind === 'config' ? 'Tras la aprobación edita harness.config.yaml y ejecuta "npx sdd-harness sync". No sigas hasta que responda.' : kind === 'manual-test' ? 'Da las instrucciones de prueba manual y pide al usuario que responda "OK" o "KO <qué falló>". No sigas hasta que responda.' : APPROVE_HINT.es}`,
  },
  next: {
    lockHeld: (h) => `Otra sesión (${h.session}) tiene trabajo en curso desde ${h.started}. Solo una sesión puede ejecutar tareas a la vez.`,
    gatePending: (k) => `Hay una decisión pendiente (${k}). Espera al usuario.`,
    manualPending: (t) => `La tarea ${t} espera la prueba manual del usuario. No está hecha y no puede empezar otra.`,
    triage: (t) => `La tarea ${t} está en triage. Espera a que el usuario elija una opción.`,
    inProgress: (t) => `La tarea ${t} sigue en curso. Termínala antes (verificación, revisión, prueba manual, task done).`,
    noSpec: () => 'No hay spec activa.',
    tasksNotApproved: () => 'Las tareas de la spec activa todavía no están aprobadas.',
    noTasks: (f) => `${f} no tiene tareas.`,
    allDone: () => 'Todas las tareas están hechas. Siguiente paso: /sdd:validate.',
    problems: (t, ps) => `La tarea ${t} todavía no se puede ejecutar: ${ps.join(', ')}. Complétala en tasks.md mediante /sdd:change.`,
    noVerify: (c) => `El componente "${c}" no tiene comandos de verificación. Pide al usuario que añada components.${c}.verify a harness.config.yaml y ejecute "sdd-harness sync" (RF-VER-02).`,
    storyPending: (s) => `Falta la prueba manual de ${s}: pídela antes de empezar trabajo nuevo.`,
    started: (t, role) => [
      `Tarea ${t.id}: ${t.title}`,
      `Componente: ${t.component} · Rol: ${role} · Alcance: ${t.scope.join(', ')}`,
      `Requisitos: ${t.requirements.join(', ')}`,
      `Hecho cuando: ${t.doneWhen}`,
      '',
      `Delégala al subagente ${role}. Escribe primero los tests y después el código, solo dentro del alcance.`,
      'Después ejecuta: node .harness/scripts/sdd.js verify',
    ].join('\n'),
  },
  verify: {
    pass: (c) => `La verificación de ${c} pasó. Siguiente: revisión (subagente reviewer) y después pedir la prueba manual.`,
    fail: (f, v) => `La verificación falló: ${f.name} (${f.command}).\n${v.decision === 'retry' ? `Intento automático ${v.attempt} de ${v.max} permitido, solo dentro del alcance de la tarea.` : v.kind === 'retryRepeated' ? 'El mismo error se repitió dos veces seguidas: detente e inicia el triage (node .harness/scripts/sdd.js triage start).' : `Se agotaron los ${v.max} intentos automáticos: detente e inicia el triage (node .harness/scripts/sdd.js triage start).`}`,
    unconfigured: (c) => `El componente "${c}" no tiene comandos de verificación (RF-VER-02).`,
  },
  done: {
    notCurrent: (t) => `La tarea ${t} no es la que está en curso.`,
    needsVerify: () => 'La verificación no está en verde. Ejecuta node .harness/scripts/sdd.js verify.',
    needsManual: () => 'El usuario todavía no aprobó la prueba manual.',
    done: (t) => `La tarea ${t} está hecha y marcada en tasks.md. Siguiente: /sdd:next.`,
  },
  triage: {
    started: () => 'Triage iniciado. Delega en el subagente debugger: error, pasos de reproducción, hipótesis por probabilidad, 2–3 opciones con ventajas e inconvenientes y una recomendación. Sin cambios de código. Después pide la decisión: node .harness/scripts/sdd.js gate request triage',
    already: () => 'Ya hay un triage en curso.',
  },
  change: {
    started: (s) => `Modo cambio para ${s}: actualiza primero la spec, muestra el diff y pide aprobación (node .harness/scripts/sdd.js gate request change). Nada de código hasta que se apruebe.`,
  },
  spec: {
    created: (id, file) => `Spec ${id} creada: ${file}. Entrevista al usuario con una pregunta cada vez (6 como máximo) y complétala.`,
    unknownComponent: (c, all) => `Componente desconocido "${c}". Usa uno de: ${all.join(', ')}.`,
    componentRequired: (all) => `Las specs viven en cada repo (specs.location: per-repo) y hay varios componentes: indica --component <${all.join('|')}>.`,
    adrCreated: (f) => `Borrador de ADR creado: ${f}`,
  },
  hook: {
    approved: (k, text) => `El usuario APROBÓ la decisión pendiente (${k})${text ? `: "${text}"` : ''}. Sigue con el siguiente paso.`,
    rejected: (k, text) => `El usuario RECHAZÓ la decisión pendiente (${k})${text ? `: "${text}"` : ''}. No sigas con ese paso.`,
    triageFromKo: () => 'La prueba manual falló (KO): inicia ahora el triage con el debugger. No cambies código.',
    noGate: () => 'No hay ninguna decisión pendiente que aprobar o rechazar.',
    resumed: (s) => `sdd-harness: retomando el trabajo en curso.\n${s}`,
    rebuilt: () => 'Nota: faltaba .harness/state; el estado del flujo se reconstruyó desde progress.md. Revísalo con /sdd:status.',
    stopVerify: (t, f) => `La tarea ${t} tiene ${f ? `la verificación fallando (${f})` : 'cambios sin verificar'}. Ejecuta node .harness/scripts/sdd.js verify antes de terminar; ninguna tarea se da por hecha con la verificación en rojo.`,
    lanes: (role, files) => `El subagente ${role} cambió archivos fuera de sus rutas: ${files.join(', ')}. Detente, enséñaselos al usuario y pregúntale si conservarlos o descartarlos (node .harness/scripts/sdd.js gate request lanes --files ${files.join(',')}). No reviertas nada por tu cuenta.`,
    lockBusy: (h) => `Otra sesión (${h.session}) está ejecutando tareas en este proyecto. Espera a que termine.`,
  },
  status: {
    title: 'Estado de sdd-harness',
    spec: 'Spec activa', phase: 'Fase', approved: 'Aprobado', task: 'Tarea actual', gate: 'Decisión pendiente', triage: 'Triage', blocks: 'Bloqueos', cost: 'Costo', none: '—', notAvailable: 'no disponible',
  },
  validate: {
    covered: (id, files) => `  ✔ ${id}: ${files.join(', ')}`,
    uncovered: (id) => `  ✖ ${id}: sin ningún test`,
    summary: (c, n) => `${c} de ${n} requisitos tienen al menos un test. Ejecuta la verificación y da el veredicto requisito por requisito.`,
  },
};

es.contract = {
  noProvider: (p) => `No encuentro la spec proveedora "${p.ref}". Usa repo#ID-NNN (por ejemplo api#API-004).`,
  noContract: (p) => `La spec ${p.spec} no tiene contratos en contracts/${p.files?.length ? ` (hay: ${p.files.join(', ')})` : ''}.`,
  imported: (f, s) => `Snapshot creado: ${f} (de ${s.repo}, spec ${s.spec}, commit ${s.commit ?? 'sin commits'}). Adaptarse a un cambio de este contrato requiere aprobación.`,
};
es.gate.noTrackerPlan = () => 'Primero calcula los cambios: node .harness/scripts/sdd.js tracker plan';
es.tracker = {
  disabled: 'No hay tracker activado en harness.config.yaml (tracker.enabled y tracker.provider).',
  badInput: (m) => `Entrada no válida: ${m}. Formato: {"<SPEC-ID>": [{"key": "ABC-1", "title": "T1 …", "done": false}]}`,
  spec: (id) => `Spec ${id}:`,
  create: (x) => `  → crear en el tracker: ${x.title}`,
  push: (x) => `  → actualizar ${x.remote.key}: ${x.title} (${x.done ? 'cerrada' : 'abierta'})`,
  pull: (x) => `  ← actualizar ${x.task.id} en tasks.md: ${x.title} (${x.done ? 'hecha' : 'pendiente'})`,
  conflict: (x) => `  ! ${x.task.id} cambió en ambos lados: local "${x.task.title}" · tracker "${x.remote.title}". Pregunta al usuario cuál conservar.`,
  missing: (x) => `  ! ${x.task.id} está vinculada a ${x.key}, que ya no existe en el tracker. No se borra nada: pregunta al usuario.`,
  proposal: (x) => `  ? nueva en el tracker: ${x.remote.key} "${x.title}". Solo se añade a tasks.md si el usuario lo aprueba.`,
  nothing: 'Todo está sincronizado.',
  needsGate: (c, u) => `Hay que crear ${c} y actualizar ${u} elementos en el tracker. Pide aprobación antes de tocarlo: node .harness/scripts/sdd.js gate request tracker`,
  localOnly: 'No hay nada que escribir en el tracker. Aplica los cambios locales: node .harness/scripts/sdd.js tracker apply',
  noPlan: 'No hay plan de sincronización. Ejecuta antes: node .harness/scripts/sdd.js tracker plan',
  notApproved: 'El usuario todavía no aprobó los cambios en el tracker (gate "tracker").',
  applied: (n) => `tasks.md actualizado en ${n} spec${n === 1 ? '' : 's'}. La spec no se toca.`,
};
es.status.missingDependency =(ref) => `depende de ${ref}, que no existe`;

// MVP: messages added after v0.3 exist only in Spanish; English falls back to them.
function withFallback(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = v && typeof v === 'object' && typeof base[k] === 'object' ? { ...base[k], ...v } : v;
  return out;
}
const enFull = withFallback(es, en);

export function runtimeMessages(lang) {
  return lang === 'en' ? enFull : es;
}

/** Text of a guard verdict, whatever guard produced it. */
export function verdictText(v, lang, legacy) {
  const t = runtimeMessages(lang);
  if (t.verdict[v.kind]) return t.verdict[v.kind](v);
  if (legacy?.[v.kind]) return v.kind === 'docBlocked' ? legacy.docBlocked(v.match, v.allowed ?? []) : legacy[v.kind](v.match);
  return `${v.kind}: ${v.match}`;
}
