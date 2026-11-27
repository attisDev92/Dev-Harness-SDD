---
status: plan-approved
---

# Spec 002 — Adaptación completa a Google Antigravity y blindaje anti-salto para modelos

| Campo | Valor |
|---|---|
| Estado | Aprobada (auditoría revisada y decisiones confirmadas con el usuario) |
| Fecha | 2026-11-27 |
| Depende de | `001-sdd-harness` |
| Idioma | Spec y docs en español; código e identificadores en inglés |
| Ubicación en el repo | `specs/002-antigravity-and-model-hardening/spec.md` |

---

## 1. Contexto y objetivo

El harness funciona con nivel de enforcement fuerte en Claude Code, pero al usarlo con herramientas y modelos de Google —en particular **Google Antigravity** (App 2.0, CLI `agy`, Antigravity IDE y extensiones) y modelos **Gemini 4**— se presentan dos problemas:

1. **Desajustes técnicos con los contratos reales de Antigravity:** el directorio de trabajo de `.agents/hooks.json` es `.agents/` (rompiendo rutas relativas a `.harness/`), los eventos planos (`SessionStart`, `PreInvocation`, `PostInvocation`, `Stop`) no admiten el envoltorio `{ hooks: [...] }`, `UserPromptSubmit` no existe en Antigravity, las herramientas actuales de edición son `write_file` y `edit_file` (con `Path`, `Content`, `Target`, `Replacement`), `invoke_subagent` es asíncrono en segundo plano (con `TypeName`, `Role`, `Prompt` en la raíz), `.agents/workflows/` está deprecado frente a `.agents/skills/sdd-<cmd>/SKILL.md` (`/sdd-<cmd>`) y Antigravity ya soporta subagentes nativos en `.agents/agents/<role>.md`.
2. **Comportamiento de modelos rápidos y paralelistas (Gemini 4 y otros):** tienden a escribir código directamente si el guardián solo emite un aviso antes de aprobar el plan, encadenar comandos en un mismo turno, editar a mano `status:` en `spec.md` o `[x]` en `tasks.md`, lanzar `sdd.js verify` sin esperar a que termine un subagente asíncrono, o sustituir `specs/` por artefactos internos de la plataforma (`brain/`).

Esta spec actualiza el núcleo de guardianes y el adaptador de Antigravity para alcanzar enforcement `strong` real y evitar que cualquier modelo se salte el flujo SDD.

---

## 2. Requisitos funcionales (EARS)

### 2.1 Blindaje determinista del flujo SDD en el núcleo (HRD)

- **RF-HRD-01:** MIENTRAS no exista ninguna spec con `status: plan-approved` (proyecto sin spec, o spec en `draft` o `spec-approved`) y `gates.unplanned` sea `block` (valor por defecto), EL SISTEMA bloqueará la escritura y edición de archivos de código de cualquier componente e indicará el paso del flujo SDD que corresponde ejecutar (`new-spec`, `stop spec` o `stop plan`). *(Actualiza RF-ORQ-13).*
- **RF-HRD-02:** DONDE `gates.unplanned` se configure como `warn` en `harness.config.yaml`, EL SISTEMA emitirá un aviso sin bloquear cuando se escriba código de componentes antes de `plan-approved`.
- **RF-HRD-03:** MIENTRAS exista al menos una spec en `plan-approved`, SI un agente escribe código en un componente sin tarea abierta o fuera del alcance de sus tareas abiertas, ENTONCES EL SISTEMA seguirá emitiendo un aviso (`noTask` / `outOfScope`) sin bloquear, permitiendo incorporar tareas surgidas en implementación (RF-SDD-19).
- **RF-HRD-04:** SI un agente intenta avanzar el campo `status` del frontmatter de `specs/*/spec.md` (`draft` → `spec-approved`, `plan-approved` o `done`) mediante herramientas de escritura o edición de archivos, ENTONCES EL SISTEMA bloqueará la edición e indicará que el estado solo cambia mediante `sdd.js approve` o `sdd.js validate`.
- **RF-HRD-05:** SI un agente intenta marcar una tarea como completada (`- [ ] T<n>` → `- [x] T<n>`) en `specs/*/tasks.md` mediante herramientas de escritura o edición de archivos, ENTONCES EL SISTEMA bloqueará la edición e indicará que las tareas solo se cierran con `sdd.js done <TID>` tras verificación verde. Añadir tareas nuevas (`- [ ]`) o editar descripciones seguirá permitido.
- **RF-HRD-06:** SI un agente intenta encadenar `sdd.js stop` y `sdd.js approve` en el mismo comando de terminal, o ejecutar `sdd.js approve` en el mismo turno en que registró la parada sin haber preguntado antes al usuario, ENTONCES EL SISTEMA rechazará la aprobación automática.

### 2.2 Contratos de hooks y confirmaciones en Antigravity (AGH)

- **RF-AGH-01:** EL SISTEMA generará `.agents/hooks.json` invocando `node ../.harness/scripts/hook.js <Evento>` para que funcione desde el directorio de trabajo `.agents/` tanto en Windows (`cmd /c`) como en Unix (`sh -c`).
- **RF-AGH-02:** EL SISTEMA generará en `.agents/hooks.json` estructuras agrupadas (`matcher` + `hooks`) únicamente para `PreToolUse` y `PostToolUse`, y listas planas de handlers para `SessionStart`, `PreInvocation`, `PostInvocation` y `Stop`, sin incluir `UserPromptSubmit`.
- **RF-AGH-03:** EL SISTEMA interceptará en `PreToolUse` y `PostToolUse` de Antigravity las herramientas `write_file`, `edit_file`, `write_to_file`, `replace_file_content`, `multi_replace_file_content`, `run_command`, `invoke_subagent` y `ask_question`, leyendo `Path`/`TargetFile` y reconstruyendo el contenido resultante desde `Content` (`Append`) y `Target`/`Replacement`.
- **RF-AGH-04:** CUANDO un agente en Antigravity ejecute `run_command` con operaciones destructivas o remotas de git (`push`, `rebase`, `merge`, `reset --hard`, `cherry-pick`, `stash drop`, `branch -D`, `tag`) o instalaciones de paquetes, o edite `harness.config.yaml` con `write_file`/`edit_file`, EL SISTEMA devolverá `{"decision": "ask"}` en `PreToolUse` para exigir confirmación nativa del usuario.
- **RF-AGH-05:** CUANDO haya una parada pendiente (`spec` o `plan`) y el usuario responda en lenguaje natural en Antigravity, EL SISTEMA evaluará `lastUserInput` en el evento `PreInvocation` del nuevo turno (`invocationNum === 1`), aprobará determinísticamente la parada en `spec.md` si la respuesta es afirmativa e inyectará el mensaje de sistema correspondiente con `injectSteps: [{"systemMessage": {"systemMessage": ...}}]`.
- **RF-AGH-06:** EL SISTEMA devolverá `{}` en `PostToolUse` para Antigravity y encolará cualquier aviso generado tras una herramienta (p. ej. sincronización de `harness.config.yaml` o desvíos de rutas) para inyectarlo al modelo en `PostInvocation` / `PreInvocation` usando `systemMessage` (sin usar `ephemeralMessage` deprecado).
- **RF-AGH-07:** CUANDO se dispare `Stop` en Antigravity, EL SISTEMA comprobará `continuationActive` y `terminationReason` (ignorando cancelaciones del usuario o errores fatales) antes de pedir `{"decision": "continue"}` por verificación fallida.
- **RF-AGH-08:** CUANDO se invoque `invoke_subagent` en Antigravity, EL SISTEMA identificará el rol desde `TypeName`, `Role` o el `Brief` en `Prompt`, mantendrá activo el registro del subagente asíncrono más allá de `PostToolUse` y verificará sus rutas (`lanes`) cuando finalice la sesión del subagente (`Stop` de su `conversationId`) o al verificar el componente.

### 2.3 Customizations nativas de Antigravity y claridad multi-modelo (AGN)

- **RF-AGN-01:** EL SISTEMA definirá cuatro niveles de modelo equivalentes entre herramientas (`orchestrator`, `high`, `mid`, `low`, además de permitir sobrescribir cualquier rol individual en `models.<tool>.<rol>`) y generará en Antigravity tanto el agente principal `.agents/agents/sdd-orchestrator.md` (`mainAgent: true`, `subagent: false`) como los subagentes `.agents/agents/<role>.md` (`subagent: true`, `mainAgent: false`, herramientas nativas explícitas y `skills`):
  - `orchestrator` (sesión principal): `opus` en Claude Code ↔ `gemini-4-neon-high` (o `Orchestrator (Neon)`) en Antigravity.
  - `high` (`architect`, `spec-reviewer`, `reviewer`, `debugger`): `opus` en Claude Code ↔ `gemini-4-carbon-high` (`Model: "pro"` en `invoke_subagent`) en Antigravity.
  - `mid` (`frontend-dev`, `backend-dev`, `qa-tester`): `sonnet` en Claude Code ↔ `gemini-4-hydrogen-high` (`Model: "flash"` en `invoke_subagent`) en Antigravity.
  - `low` (`doc-writer` y tareas etiquetadas `[mecánica]`): `haiku` en Claude Code ↔ `gemini-4-hydrogen-low` (`Model: "flash_lite"` en `invoke_subagent`) en Antigravity.
- **RF-AGN-07:** EL SISTEMA mostrará los modelos efectivos por nivel en `sdd-harness doctor`, en la sección `Roles` de `AGENTS.md` y en `sdd.js brief <TID>` (rebajando automáticamente a nivel `low` las tareas marcadas `[mecánica]`).
- **RF-AGN-02:** EL SISTEMA generará los atajos del flujo para Antigravity como skills invocables con `/` en `.agents/skills/sdd-<cmd>/SKILL.md` (incluyendo `sdd-tracker` cuando `tracker.enabled` sea `true`), eliminando la generación en `.agents/workflows/` (deprecado) y reportando `/sdd-<cmd>` en `sdd-harness doctor`.
- **RF-AGN-03:** DONDE un proyecto tenga componentes en subdirectorios (`path` distinto de `.`), EL SISTEMA generará en Antigravity reglas `.agents/rules/component-<id>.md` con `trigger: glob` para que el contexto del componente se cargue automáticamente al operar sobre sus archivos.
- **RF-AGN-04:** DONDE `design.source` sea `figma` o `penpot` y `antigravity` esté activada, EL SISTEMA configurará `.agents/mcp_config.json` con el formato Streamable HTTP de Antigravity (`url` sin `type: "http"`).
- **RF-AGN-05:** EL SISTEMA actualizará el límite de tamaño de reglas de `antigravity` a `24000` caracteres, incluirá `description` en el frontmatter de `.agents/rules/sdd-harness.md` e instruirá explícitamente sobre: (a) lectura previa de `.agents/skills/sdd/SKILL.md`, (b) espera asíncrona tras `invoke_subagent` antes de ejecutar `sdd.js verify`, y (c) prohibición de sustituir `specs/` por artefactos en `brain/` o activar `swarm` sin que el usuario lo pida.
- **RF-AGN-06:** EL SISTEMA eliminará menciones exclusivas a Claude Code (`Claude Code`, `AskUserQuestion`, y referencias a `CLAUDE.md` cuando `claude-code` no esté activada) en el contexto común (`AGENTS.md`) y en los mensajes de runtime, y evitará depender de pipes JSON inline en `sdd-tracker` para compatibilidad con PowerShell en Windows.
