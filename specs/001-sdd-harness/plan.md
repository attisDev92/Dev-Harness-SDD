# Plan — Spec 001, hito v0.1

Cubre: RF-INS-01…07, RF-GEN-12, RF-GAT-01/02, RF-MD-01/02, RF-RET-01/02/03/06/07 (contador) y los RNF aplicables (01, 04, 05, 08, 12, 13 parcial, 15, 16).

## Decisiones

| Decisión | Alternativa descartada | Motivo |
|---|---|---|
| ESM puro sobre Node ≥ 20, sin build | TypeScript + bundler | Cero pasos de compilación; los guardianes se copian tal cual a `.harness/scripts/` |
| Única dependencia de la CLI: `yaml` (ISC, sin dependencias) | Parser YAML propio | El esquema admite mapas en flujo y comentarios; `yaml` da posiciones de línea para RF-GEN-12 |
| Guardianes sin dependencias y sin YAML: leen `.harness/guards.json` | Que los guardianes lean `harness.config.yaml` | Arranque rápido (RNF-08) y copia autocontenida; `sync` (v0.2) generará ese JSON |
| `bin/harness.cjs` en ES5 comprueba Node antes de cargar el ESM | Comprobar en el ESM | Así una versión antigua de Node recibe el mensaje en vez de un error de sintaxis (RF-INS-06) |
| Tests con `node:test` | Vitest/Jest | Sin dependencias de desarrollo; matriz CI en Windows, macOS y Linux |
| Guardianes fail-safe: error interno ⇒ bloquear (exit 2) | Fail-open | Un guardián roto no debe abrir la puerta a un commit |

## Módulos

| Módulo | Requisitos |
|---|---|
| `bin/harness.cjs`, `bin/node-check.cjs` | INS-01, INS-04, INS-06 |
| `src/cli/main.js`, `src/cli/i18n.js` | INS-05, RNF-12; `config validate` (GEN-12) |
| `src/cli/paths.js` | INS-02 (rechaza escribir en `~/.claude`, `~/.codex`, `~/.gemini`, `~/.config/opencode`…), INS-03 (caché propia, creada solo al necesitarla) |
| `src/config/schema.js`, `src/config/load.js` | GEN-12, caso límite 5, RNF-05 |
| `src/guards/docs-guard.js`, `glob.js` | MD-01, MD-02 |
| `src/guards/hook.js` | Punto de entrada de los hooks de Claude Code (ver "Revisión v0.8") |

> v0.8 eliminó `shell.js`, `git-guard.js`, `bash-guard.js`, `retry.js` y `cli.js` (`sdd-harness guard`): git y dependencias usan los permisos nativos de la herramienta.

## Estrategia de tests

Un archivo por área, con los IDs de RF en el nombre de cada test. La instalación global real (INS-01) se ejecuta con `HARNESS_TEST_INSTALL=1`, activado en CI.

## Límites conocidos

- La detección en código (JS, Python…) es heurística: busca llamadas a `git` con subcomandos bloqueados o librerías git conocidas.
- `make`, `just` y los scripts de workspaces de npm (`-w`) no se inspeccionan todavía.
- Sin `.harness/guards.json` (lo generan `init` y `sync` desde v0.2) se usan los valores por defecto de RF-MD-02 y RET-01.

---

# Plan — hito v0.2

Cubre: RF-INI-01…18, RF-CNV-01…06, RF-GEN-01…04 y 07…14, RF-MRG-01…05 (JSON), RF-MOD-01…06, RF-REM-01…08, RF-DOC-01…06 en su versión base, casos límite 1–8, 22–25 y RNF-06/07/08.

## Decisiones

| Decisión | Alternativa descartada | Motivo |
|---|---|---|
| Estado deseado declarativo (`file`, `block`, `json`) + planificador que compara disco, manifiesto y deseado | Escribir directamente desde cada comando | Un solo motor para `init`, `sync` y `remove`: diff previo, detección de ediciones a mano, idempotencia y reversión exacta salen de la misma lógica |
| Escritura transaccional en memoria (originales guardados antes de escribir, temp + rename, rollback) | Copia de seguridad en disco | Sin restos en el proyecto si algo falla (RF-INI-18, RNF-07) |
| Prompts por líneas sin dependencias, con `id` por pregunta | Librería de prompts interactivos | Funciona igual en terminal y por tubería; los tests responden por `id` |
| En modo local, si `AGENTS.md` está versionado el contexto va a `.harness/context/` y Claude Code lo importa desde `CLAUDE.local.md`; el resto de herramientas se reporta como "requiere modo team" | Añadir un bloque al archivo versionado | RF-MOD-02 prohíbe modificar archivos versionados; RF-MOD-04 pide explicarlo |
| Conservar los finales de línea CRLF en archivos del usuario al insertar bloques | Normalizar todo a LF | No generar diffs espurios en archivos que no son del harness (RNF-05 aplica a los generados) |
| Un repo con repos anidados se propone como `multi-repo`; el anidamiento de rutas solo se permite entre repos distintos | Proponer `monorepo` | Con `monorepo` las rutas se solapan y el caso límite 5 lo prohíbe |
| `doctor` informa el enforcement **actual** a partir de lo que registra el manifiesto (`enforces`), además del potencial | Mostrar la tabla del README | RF-DOC-02 exige el nivel real; hasta v0.3 todo es "solo por instrucción" y así se dice |

## Módulos

| Módulo | Requisitos |
|---|---|
| `src/detect/stack.js`, `project.js`, `conventions.js` | INI-02, 03, 05, 11, 12; CNV-01…03, 06 |
| `src/cli/interview.js`, `prompt.js` | INI-01…12, 17; CNV-02, 03 |
| `src/generate/core.js`, `context.js`, `templates.js` | GEN-01…04, 07, 14; CNV-04, 05; MOD-01…05; GAT-09; OBS-05 |
| `src/engine/plan.js`, `blocks.js`, `json-merge.js`, `diff.js`, `manifest.js`, `transaction.js`, `git.js` | GEN-08…13; MRG-01…05; REM-02…04; INI-18 |
| `src/cli/commands/init.js`, `sync.js`, `remove.js`, `doctor.js` | INI-13…16; GEN-09, 10; MOD-06; REM-01, 05…08; DOC-01…06 |

## Pendiente dentro de estos grupos

- RF-GEN-05/06 (skills en `.agents/skills/` y copias por herramienta): no hay skills que colocar hasta v0.3 (`sdd-orchestrator`) y v0.7 (registro).
- RF-MRG-02 para TOML: el motor fusiona JSON; TOML llega con el adaptador de Codex (v0.5).
- `harness.workspace.yaml` y las specs por repo (RF-TOP-02/03) son de v0.4; en v0.2 el workspace se detecta y se configura en la raíz.

---

# Plan — hito v0.3

Cubre: RF-ADP-01/02/03/05/06 (Claude Code), RF-SDD-01…18, RF-ORQ-01…10 y 12, RF-GAT-01…14, RF-RET-01…07, RF-DOM-01…04, RF-VER-01…06, RF-GEN-05/06 y los casos límite 10–15 y 26.

## Decisiones

| Decisión | Alternativa descartada | Motivo |
|---|---|---|
| El estado del flujo lo llevan scripts (`sdd.js`, `.harness/state/flow.json`), no el modelo | Instrucciones en los prompts | "Los permisos y los hooks son leyes": fases, tarea actual, contador de intentos y gates se comprueban de forma determinista |
| Las aprobaciones solo llegan por lo que escribe el usuario (hook `UserPromptSubmit`: `/sdd:approve`, `/sdd:reject`, `OK`, `KO`); el agente solo puede *pedir* un gate | Un comando `approve` que el agente pudiera ejecutar | El agente no puede aprobarse a sí mismo; el guardián de shell además bloquea invocar `hook.js` y escribir en `.harness/` |
| Añadir `/sdd:approve` y `/sdd:reject` a la interfaz pública | Solo detectar palabras libres ("sí", "vale") | Una respuesta explícita es inequívoca; `OK`/`KO` se aceptan porque la spec los nombra para la prueba manual |
| Reglas de escritura por fase y por tarea en el guardián de archivos (spec aprobada congelada, plan tras spec, código solo en la tarea actual y su alcance, nada durante triage o con un gate pendiente) | Confiar en que el orquestador siga el orden | RF-SDD-13/18, RF-RET-02/05 y RF-GAT-11 pasan a ser deterministas |
| Las mismas reglas se aplican a las escrituras por shell (redirecciones y argumentos de `rm`, `mv`, `cp`, `sed -i`, `tee`, `Set-Content`…) | Vigilar solo las herramientas Write/Edit | Si no, `echo > archivo` saltaría todas las reglas |
| Carriles por rol comprobados con una instantánea de `git status` + hashes antes y después de cada subagente | Leer el diff de git al final | Detecta cambios también en archivos que ya estaban modificados; no revierte nada (RF-DOM-04) |
| El estado se refleja en un bloque gestionado de `progress.md` con los datos en JSON | Solo `flow.json` | Si se borra `.harness/state/`, el flujo se reconstruye (caso límite 13) |
| Hooks y permisos se añaden a `settings.json`/`settings.local.json` con semántica de "añadir a la lista" | Sustituir las claves `hooks` y `permissions` | Conserva los hooks y reglas del equipo; `remove` quita solo lo añadido |
| Git hooks propios vía `core.hooksPath` solo si no hay otro gestor; con husky en modo team se encadena con un bloque gestionado | Reemplazar el gestor existente | RF-VER-05 |
| Los scripts copiados llevan su propio `package.json` con `"type": "module"` | Depender de la detección automática de ESM de Node | Funciona igual en Node 20, 22 y 24 |

## Límites conocidos

- La sintaxis `/sdd:<comando>` depende de que Claude Code nombre así los comandos de `.claude/commands/sdd/`. Está por verificar en una sesión real, igual que el formato `permissionDecision: "ask"` del hook y el nombre `Task`/`Agent` de la herramienta de subagentes (se aceptan ambos).
- El bloqueo de sesión (RF-ORQ-12) usa el `session_id` de los hooks; en herramientas sin hooks queda como instrucción.
- La detección de escrituras por shell cubre los comandos habituales; un programa arbitrario que escriba archivos solo se detecta después, por la instantánea de carriles o por los git hooks.
- Las skills propias de esta versión son `sdd-orchestrator`, `spec-generator`, `triage-report` y `adr`; el resto de RF-SKL-01 llega en v0.7.

## Revisión v0.8: flujo ligero (30-09-2026)

Al probarlo, una spec de media hora tardaba horas: 14 gates con `/sdd:approve`, uno pendiente cada vez; no se podía cambiar la configuración a mitad del desarrollo ni añadir tareas; el agente se negaba a hacer commit incluso cuando se lo pedía el usuario, porque varias instrucciones decían "nunca hagas commit"; y el harness reimplementaba en ~1000 líneas lo que Claude Code ya hace con sus permisos. Estas decisiones sustituyen a las de arriba cuando chocan.

| Decisión | Alternativa descartada | Motivo |
|---|---|---|
| Dos paradas (spec; plan y tareas). El usuario responde hablando; el hook `UserPromptSubmit` reconoce las frases afirmativas y registra la aprobación | 14 gates con `/sdd:approve` | RF-SDD-13, RF-GAT-08. Menos turnos y ningún comando para avanzar |
| Estado visible: `status` en el frontmatter de `spec.md` y casillas de `tasks.md`; `.harness/state/runtime.json` solo guarda la parada pendiente, el último verify, los avisos mostrados y los subagentes | `flow.json` más un espejo en `progress.md` | RF-SDD-18. Borrar `.harness/state` no pierde nada importante; sin estado oculto que se desincronice |
| Git y dependencias con `permissions.ask` nativos; `git add`/`git commit` en `allow`, porque el commit se acuerda en la conversación al cerrar cada historia | Analizar shell, PowerShell, alias y scripts | RF-GAT-01/02/03. Usar lo que ya existe; no preguntar dos veces |
| `harness.config.yaml` editable con la confirmación nativa; `PostToolUse` ejecuta `sdd-harness sync --yes` | Gate `config` | RF-GAT-09. Se puede cambiar a mitad del desarrollo |
| Solo el componente es obligatorio en una tarea; el agente añade las que surgen ("añadida en implementación") | Tareas con alcance, RF y "Hecho cuando" obligatorios, cambios por `/sdd:change` | RF-SDD-12/19 |
| Los `/sdd:*` que quedan (`status`, `spec`, `next`, `docs`, `review`, `validate`, `commit`) informan o lanzan trabajo en paralelo | 12 comandos de fase y aprobación | RF-ORQ-14 |
| El hook `Stop` recuerda una sola vez cada verificación fallida | Bloquear el cierre con cualquier cambio sin verificar | RF-VER-01 sin frenar turnos de conversación |
| El pre-commit solo busca secretos y `.env`; la lista blanca de docs y la verificación, en CI | Los mismos checks en pre-commit y CI | Un commit acordado con el usuario no falla por un lint |
| Sin lock de sesión | Una sola sesión con tareas | RF-ORQ-12; el lock bloqueaba también el sync lanzado por el hook |

Límite conocido: el auto-sync ejecuta el `sdd-harness` instalado en el PATH. Si la CLI global es más antigua que la del proyecto, se avisa y conviene actualizarla.
