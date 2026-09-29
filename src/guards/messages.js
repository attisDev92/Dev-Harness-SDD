// Messages the guards show to agents. Dependency-free (copied into .harness/scripts/).

const MESSAGES = {
  en: {
    gitBlocked: (m) => `Blocked: "${m}" creates commits or rewrites history/remote. Committing is the user's job: stop and propose the commit message with /sdd:commit instead.`,
    gitDynamic: (m) => `Blocked: "${m}" builds a git command dynamically, so the harness cannot verify it is safe. Run git with literal arguments.`,
    gitPiped: (m) => `Blocked: "${m}" runs commands read from a pipe, so the harness cannot verify them. Run the commands directly.`,
    tooDeep: () => 'Blocked: the command is nested too deeply for the harness to verify it. Run the inner command directly.',
    commitTool: (m) => `Blocked: "${m}" creates commits or tags. Committing is the user's job: use /sdd:commit to propose the message.`,
    remoteChange: (m) => `Blocked: "${m}" changes the remote repository. Only the user does that.`,
    codeGit: (m) => `Blocked: the code run by this command calls git to create commits or rewrite history ("${m}"). Committing is the user's job.`,
    docBlocked: (p, allowed) => `Blocked: "${p}" is not in the documentation whitelist. Agents may only create docs in: ${allowed.join(', ')}. If the user explicitly asked for this document, ask them to confirm so it is added to the whitelist.`,
    retryAllowed: (n, max) => `Automatic fix attempt ${n} of ${max} allowed. Change only files in the task scope.`,
    retryExhausted: (max) => `Stop: the ${max} automatic fix attempts for this task are used up. Start triage with the debugger role and let the user choose.`,
    retryRepeated: () => 'Stop: the same error happened in two consecutive attempts. Start triage with the debugger role and let the user choose.',
    retryOutOfScope: (files) => `Stop: the fix needs files outside the task scope (${files.join(', ')}). No automatic attempts: start triage and let the user choose.`,
    retryProtected: (files) => `Stop: the fix touches a protected zone (${files.join(', ')}). No automatic attempts: start triage and let the user choose.`,
    retryReset: (task) => `Attempt counter reset for task ${task}.`,
    notActivated: () => 'This project is not activated (no harness.config.yaml found). Run "harness init" first.',
    badInput: (e) => `Invalid guard input: ${e}`,
    internalError: (e) => `Blocked: the guard failed (${e}). Fail-safe: the action was not allowed.`,
  },
  es: {
    gitBlocked: (m) => `Bloqueado: "${m}" crea commits o reescribe el historial o el remoto. El commit lo hace el usuario: detente y propón el mensaje con /sdd:commit.`,
    gitDynamic: (m) => `Bloqueado: "${m}" construye un comando de git de forma dinámica y el harness no puede verificar que sea seguro. Ejecuta git con argumentos literales.`,
    gitPiped: (m) => `Bloqueado: "${m}" ejecuta comandos leídos de una tubería y el harness no puede verificarlos. Ejecuta los comandos directamente.`,
    tooDeep: () => 'Bloqueado: el comando está demasiado anidado para que el harness lo verifique. Ejecuta el comando interior directamente.',
    commitTool: (m) => `Bloqueado: "${m}" crea commits o tags. El commit lo hace el usuario: usa /sdd:commit para proponer el mensaje.`,
    remoteChange: (m) => `Bloqueado: "${m}" modifica el repositorio remoto. Eso solo lo hace el usuario.`,
    codeGit: (m) => `Bloqueado: el código que ejecuta este comando llama a git para crear commits o reescribir el historial ("${m}"). El commit lo hace el usuario.`,
    docBlocked: (p, allowed) => `Bloqueado: "${p}" no está en la lista blanca de documentación. Los agentes solo pueden crear documentos en: ${allowed.join(', ')}. Si el usuario pidió este documento explícitamente, pídele que lo confirme para añadirlo a la lista blanca.`,
    retryAllowed: (n, max) => `Intento automático de corrección ${n} de ${max} permitido. Modifica solo archivos del alcance de la tarea.`,
    retryExhausted: (max) => `Detente: se agotaron los ${max} intentos automáticos de esta tarea. Inicia el triage con el rol debugger y deja que el usuario elija.`,
    retryRepeated: () => 'Detente: el mismo error se repitió en dos intentos consecutivos. Inicia el triage con el rol debugger y deja que el usuario elija.',
    retryOutOfScope: (files) => `Detente: el arreglo necesita archivos fuera del alcance de la tarea (${files.join(', ')}). Sin intentos automáticos: inicia el triage y deja que el usuario elija.`,
    retryProtected: (files) => `Detente: el arreglo toca una zona protegida (${files.join(', ')}). Sin intentos automáticos: inicia el triage y deja que el usuario elija.`,
    retryReset: (task) => `Contador de intentos reiniciado para la tarea ${task}.`,
    notActivated: () => 'Este proyecto no está activado (no hay harness.config.yaml). Ejecuta primero "harness init".',
    badInput: (e) => `Entrada del guardián no válida: ${e}`,
    internalError: (e) => `Bloqueado: el guardián falló (${e}). Por seguridad, la acción no se permitió.`,
  },
};

export function guardMessages(lang) {
  return MESSAGES[lang] ?? MESSAGES.en;
}
