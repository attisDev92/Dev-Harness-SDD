# Plan — Spec 002 (Antigravity + Blindaje Anti-Salto)

## Módulos afectados

1. **Esquema, configuración y migración (`src/config/schema.js`, `src/guards/project.js`, `src/generate/core.js`, `src/cli/commands/upgrade.js`, `package.json`):**
   - Añadir `gates.unplanned: oneOf(['block', 'warn'])` (por defecto `'block'`), propagarlo a `.harness/guards.json` (`unplanned`) y `loadGuardSettings(root)`.
   - Actualizar `TOOL_CONTEXT_LIMITS.antigravity` a `24000` en `src/generate/core.js` y deduplicar entradas idénticas (`kind` + `path`) antes de `planChanges` para evitar duplicar skills canónicas de `.agents/skills/` en `.harness/manifest.lock`.
   - Subir versión a `2.3.0` con notas en `CHANGES['2.3.0']` y migración suave en `MIGRATIONS` (`gates.unplanned: block`).
   - *(Cubre: RF-HRD-01, RF-HRD-02, RF-AGN-05).*

2. **Guardianes de archivos, comandos y flujo (`src/guards/files-guard.js`, `src/guards/shell-guard.js` → integrado en `hook.js`, `src/guards/hook.js`, `src/guards/state.js`, `src/guards/runtime-messages.js`):**
   - En `files-guard.js`:
     - Ampliar `contentAfter(input, current)` para soportar `Content` (`Append: true` concatena a `current`, si no reemplaza) y `Target` / `Replacement` (reemplazo global como `edit_file` de Antigravity).
     - Bloquear avance manual de `status:` en `specs/*/spec.md` (`manualSpecStatus`) y marcado manual `- [ ]` → `- [x]` en `specs/*/tasks.md` (`manualTaskDone`).
     - Antes de `plan-approved` (`!hasApprovedPlan`), devolver `block('unplannedCode', ...)` (o `warn` si `settings.unplanned === 'warn'`) para cualquier archivo de código de un componente. Una vez en `plan-approved`, mantener `warn('noTask')` y `warn('outOfScope')`.
   - En `hook.js`:
     - Soportar todas las herramientas de Antigravity (`write_file`, `edit_file`, `write_to_file`, `replace_file_content`, `multi_replace_file_content`, `run_command`, `invoke_subagent`, `ask_question`) y extraer ruta desde `input.Path ?? input.file_path ?? input.notebook_path ?? input.path ?? input.TargetFile`.
     - En `PreToolUse` (`isAgy`):
       - Para `run_command`: bloquear encadenamiento `sdd.js stop` + `sdd.js approve` en el mismo comando y ejecución de `sdd.js approve` cuando `runtime.pending?.waitingForUser` sigue activo; devolver `{"decision": "ask", "reason": ...}` para comandos git remotos/destructivos e instalación de dependencias.
       - Para `write_file`/`edit_file` sobre `harness.config.yaml`: devolver `{"decision": "ask", "reason": ...}`.
       - Para avisos (`warn` / `tooMany`): encolar en `runtime.queuedAlerts` para inyectarlos como `systemMessage` en `PostInvocation` además de `decision: "allow"`.
       - Para `invoke_subagent`: resolver rol desde `TypeName`, `Role`, `Subagents?.[0]?.Role` o `Prompt` (`Rol: <role>`), y registrar subagente asíncrono (`async: true`, `parentConv: payload.conversationId`).
     - En `PostToolUse`: si `isAgy`, marcar `waitingForUser = true` tras `sdd.js stop`, limpiarlo tras `ask_question`, conservar subagentes `async: true` activos, encolar avisos de `harness.config.yaml` en `runtime.queuedAlerts`, y devolver siempre `{}` en `stdout`.
     - En `PreInvocation` (`isAgy`): enlazar `subConv` si la sesión pertenece a un subagente recién lanzado; en `invocationNum === 1`, limpiar `waitingForUser` y procesar `parseDecision(payload.lastUserInput)` si hay parada pendiente (aprobando en `spec.md` e inyectando `systemMessage`), además del resumen de sesión al arrancar y cualquier alerta encolada.
     - En `PostInvocation` (`isAgy`): vaciar `runtime.queuedAlerts` hacia `injectSteps: [{"systemMessage": {"systemMessage": ...}}]`.
     - En `Stop`: respetar `payload.continuationActive` y `payload.terminationReason` en Antigravity; si el `conversationId` corresponde a un subagente asíncrono registrado, cerrar su entrada en `runtime.subagents`, verificar `lanes` y encolar alerta si escribió fuera de sus rutas.
   - *(Cubre: RF-HRD-01..06, RF-AGH-03..08, RF-AGN-06).*

3. **Adaptador de Antigravity, contexto compartido, skills y doctor (`src/generate/adapters/antigravity.js`, `src/generate/adapters/claude-code.js`, `src/generate/context.js`, `src/generate/skills.js`, `src/cli/commands/doctor.js`, `src/detect/project.js`):**
   - En `antigravity.js`:
     - Generar `.agents/agents/<role>.md` con `tools` nativas por rol, `subagent: true`, `mainAgent: false`, `model` (`DEFAULT_MODELS = { high: 'pro', mid: 'inherit', low: 'flash' }` o `config.models?.antigravity?.[tier]`) y `skills`.
     - Generar `.agents/skills/sdd-<cmd>/SKILL.md` (y `sdd-tracker` si hay tracker activo) en lugar de `.agents/workflows/sdd-<cmd>.md`.
     - Generar `.agents/rules/component-<id>.md` (`trigger: glob`, `globs: "**/<dir>/**"`) para componentes con ruta distinta de `.`.
     - Generar `.agents/mcp_config.json` para `figma` / `penpot`.
     - Corregir `.agents/hooks.json` (`node ../.harness/scripts/hook.js <Event>`, eventos planos directos, `PostInvocation` añadido, sin `UserPromptSubmit`).
     - Reforzar `.agents/rules/sdd-harness.md` (`description` en frontmatter, idioma alineado con `config`, espera asíncrona de `invoke_subagent`, prohibición de `brain/` como sustituto de `specs/` y de `swarm` no solicitado).
   - En `claude-code.js` y `skills.js`: actualizar `trackerCommand` para usar `--file` en vez de pipes JSON por `stdin`, y documentar la espera asíncrona cuando los subagentes corren en segundo plano.
   - En `context.js` y `runtime-messages.js`: neutralizar menciones exclusivas a Claude Code / `AskUserQuestion` y condicionar la nota de `CLAUDE.md`.
   - En `doctor.js` y `project.js`: cambiar `invoke` de `antigravity` a `/sdd-${c}` y ampliar `TOOL_MARKERS.antigravity`.
   - *(Cubre: RF-AGH-01..02, RF-AGN-01..06).*

## Estrategia de tests

- Tests unitarios y de integración con `node:test` (0 dependencias externas, deterministas):
  - `test/files-guard.test.js`: pruebas de `RF-HRD-01..05` (`unplannedCode` en `block` y `warn`, `noTask` en `plan-approved`, bloqueo de `manualSpecStatus` y `manualTaskDone`, `contentAfter` con `Content`/`Append` y `Target`/`Replacement`).
  - `test/antigravity-adapter.test.js`: pruebas de `RF-AGH-01..02` y `RF-AGN-01..05` (subagentes `.agents/agents/*.md`, modelos y herramientas nativas, skills `/sdd-*`, ausencia de `.agents/workflows/`, reglas `glob` por componente, `.agents/mcp_config.json`, estructura plana/agrupada de `.agents/hooks.json` y CWD `../.harness`).
  - `test/sdd-flow.test.js`: pruebas extremo a extremo simulando payloads reales camelCase de Antigravity (`RF-HRD-06`, `RF-AGH-03..08`: bloqueo de código sin plan, `ask` en `git push`/`npm install`/`harness.config.yaml`, aprobación hablando vía `PreInvocation.lastUserInput`, alertas vía `PostInvocation`, ciclo asíncrono de `invoke_subagent` + `lanes` en `Stop`, anti-autoaprobación en mismo turno, `Stop` con `continuationActive`).
  - Actualizar `test/doctor.test.js`, `test/generate.test.js` y `test/mvp.test.js` para reflejar `/sdd-spec`, límite `24000` y versión `2.3.0`.
