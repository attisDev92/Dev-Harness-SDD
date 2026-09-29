# Tareas — Spec 001

## v0.1

- [x] T1 Paquete, `bin/harness.cjs` y comprobación de Node · RF-INS-01, 04, 06 · `package.json`, `bin/**` · Hecho cuando: `sdd-harness --version` funciona tras `npm install -g` y Node 18 sale con código 1
- [x] T2 Ayuda en español e inglés · RF-INS-05, RNF-12 · `src/cli/**` · Hecho cuando: `--help` y `<comando> --help` salen en el idioma de `--lang`, `HARNESS_LANG`, `cli.language` o el locale
- [x] T3 Rutas: caché propia y bloqueo de directorios globales · RF-INS-02, 03, 07 · `src/cli/paths.js` · Hecho cuando: ejecutar la CLI no escribe en el perfil ni en un proyecto no activado
- [x] T4 Esquema de `harness.config.yaml` · RF-GEN-12 · `src/config/**` · Hecho cuando: `sdd-harness config validate` lista cada campo inválido con línea y columna y sale con 1
- [x] T5 Tokenizador de shell · RF-GAT-02 · `src/guards/shell.js` · Hecho cuando: separa cadenas, sustituciones y comillas de sh, cmd y PowerShell
- [x] T6 Guardián de git · RF-GAT-01, 02 · `src/guards/git-guard.js` · Hecho cuando: pasa la batería de evasión del caso límite 10
- [x] T7 Guardián de documentos · RF-MD-01, 02 · `src/guards/docs-guard.js`, `glob.js` · Hecho cuando: bloquea `.md` nuevos fuera de la lista blanca
- [x] T8 Contador de reintentos · RF-RET-01, 02, 03, 06, 07 · `src/guards/retry.js` · Hecho cuando: el tercer fallo, un error repetido o un arreglo fuera de alcance devuelven `triage` (exit 2)
- [ ] T9 CI multiplataforma (workflow escrito, aún sin ejecutar) · RNF-16 · `.github/workflows/ci.yml` · Hecho cuando: la matriz Windows/macOS/Linux × Node 20/22/24 ejecuta la suite

## v0.2

- [x] T10 Motor: bloques gestionados, fusión JSON, diff, manifiesto y escritura transaccional · RF-MRG-01…05, RF-GEN-08, RF-INI-18 · `src/engine/**` · Hecho cuando: un fallo a mitad de escritura deja el proyecto idéntico
- [x] T11 Detección de topología, componentes, stack, verificación, convenciones e idioma · RF-INI-02, 03, 05, 11, 12, RF-CNV-01…03, 06 · `src/detect/**` · Hecho cuando: las cinco fixtures se detectan correctamente
- [x] T12 Generador del núcleo: AGENTS.md raíz y por componente, CLAUDE, plantillas, guardianes, guards.json, exclude · RF-GEN-01…04, 07, 14, RF-CNV-04, 05, RF-MOD-01…05 · `src/generate/**` · Hecho cuando: el modo local no modifica archivos versionados
- [x] T13 `sdd-harness-init` con entrevista, resumen y confirmación · RF-INI-01…18 · `src/cli/interview.js`, `src/cli/commands/init.js` · Hecho cuando: cancelar en cualquier punto no escribe nada
- [x] T14 `sdd-harness sync` · RF-GEN-09…13, RF-MOD-06 · `src/cli/commands/sync.js` · Hecho cuando: dos `sync` seguidos no cambian ningún byte
- [x] T15 `sdd-harness remove` · RF-REM-01…08 · `src/cli/commands/remove.js` · Hecho cuando: init → sync → remove deja cada fixture idéntica
- [x] T16 `sdd-harness doctor` base · RF-DOC-01…06 · `src/cli/commands/doctor.js` · Hecho cuando: errores salen con código 1, avisos no, y `--json` funciona
- [x] T17 Skills en `.agents/skills/` y copias por herramienta · RF-GEN-05, 06 · Hecho en v0.3 con las cuatro skills del flujo
- [ ] T18 Fusión TOML · RF-MRG-02 · Pendiente: llega con el adaptador de Codex (v0.5)

## v0.3

- [x] T19 Runtime del flujo sin dependencias: estado, gates, tareas, verificación · RF-SDD-04…17, RF-ORQ-01…09, RF-GAT-10…14, RF-RET-01…07 · `src/guards/{state,flow,tasks,verify,sdd}.js` · Hecho cuando: una tarea recorre verificación, triage, prueba manual y cierre solo con scripts
- [x] T20 Guardianes de archivos y shell · RF-GAT-05…09, RF-SDD-13/18, RF-RET-02/05 · `src/guards/{files-guard,bash-guard}.js` · Hecho cuando: las escrituras por herramienta y por shell siguen las mismas reglas
- [x] T21 Hooks de Claude Code · RF-ADP-01/02, RF-VER-01, RF-DOM-03/04, RF-ORQ-09/12 · `src/guards/hook.js` · Hecho cuando: el hook bloquea, pregunta o registra decisiones con payloads reales
- [x] T22 Adaptador de Claude Code: subagentes, comandos, skills, settings · RF-ADP-01/05/06, RF-ORQ-10, RF-DOM-02 · `src/generate/adapters/claude-code.js` · Hecho cuando: init → sync → remove deja idéntico un proyecto con settings previos
- [x] T23 Red de seguridad: pre-commit y plantilla de CI · RF-VER-03…06 · `src/guards/checks.js`, `src/generate/githooks.js` · Hecho cuando: un `git commit` real con un secreto se bloquea
- [x] T24 `doctor` con enforcement real y git hooks · RF-DOC-02, RF-ADP-03 · Hecho cuando: quitar los hooks a mano baja el nivel a "solo instrucción"
- [ ] T25 Prueba manual del flujo completo con Claude Code en una sesión real (criterio de finalización 4)

## MVP (v0.4)

- [x] T26 Mensajes nuevos solo en español y español por defecto · decisión de alcance del MVP
- [x] T27 Log de eventos del flujo · RF-OBS-01, 02, 05 · `src/guards/state.js` · Hecho cuando: cada evento queda en `.harness/logs/events.jsonl`
- [x] T28 `sdd-harness upgrade` · RF-UPG-01…04 · `src/cli/commands/upgrade.js` · Hecho cuando: muestra novedades y diff, y registra la versión nueva

## Pendiente (post-MVP)

- [x] T9 CI multiplataforma ejecutada (RNF-16): verde en Windows, macOS y Linux con Node 20, 22 y 24
- [ ] T18 Fusión TOML (RF-MRG-02)
- [x] T25 Demo del flujo completo con Claude Code real (criterio 4): hecha el 29-09-2026
- [x] T29 Topologías de varios repos y workspace, depends_on y snapshots de contratos (RF-TOP-*)
- [ ] T30 Adaptadores de opencode, Codex y Antigravity; modo degradado (RF-ADP para otras herramientas, RF-ORQ-11)
- [x] T31 Registro curado de skills e instalador verificado (RF-SKL-02…15)
- [x] T32 Sincronización con GitHub Issues (RF-TRK-*)
- [x] T35 Cualquier tracker: GitHub desde la CLI y el resto desde el agente con su MCP (`/sdd:tracker`, `sdd.js tracker plan|apply`, gate `tracker`)
- [x] T36 Resto de skills propias de RF-SKL-01
- [x] T37 Git hooks por repo en topología workspace
- [ ] T33 Costo y tokens por tarea (RF-OBS-03)
- [ ] T34 Mensajes en inglés de lo añadido en el MVP (RNF-12)

## v0.7

- [x] T38 Nombre definitivo: paquete `dev-harness-sdd`, comando `sdd-harness` y atajo `sdd-harness-init`
- [x] T39 `LICENSE` (Apache-2.0) y `NOTICE`
- [x] T40 Guías en español e inglés: uso, adaptadores y registro de skills (RNF-18)
- [x] T41 Recorrido de validación RF por RF (criterio 8): `validation.md`
