# Validación — Spec 001 (sdd-harness)

Fecha: 2026-09-29 · Versión: 0.7.0 · Alcance acordado: MVP para Claude Code con mensajes en español (ver §10 de la spec).

Leyenda: ✔ cumplido con evidencia · ◐ cumplido en parte o solo por instrucción al agente · ✖ pendiente.

La evidencia es el archivo de test (en `test/`) que nombra el requisito, o una nota cuando el requisito se cumple por instrucción. La suite completa pasa en la matriz de CI (Windows, macOS y Linux con Node 20, 22 y 24).

## Resumen

| Estado | Requisitos |
|---|---|
| ✔ Cumplido | 173 |
| ◐ Parcial o por instrucción | 11 |
| ✖ Pendiente | 2 |
| **Total** | **186** |

## INS

| Requisito | Estado | Evidencia |
|---|---|---|
| RF-INS-01 | ✔ | Test: `cli`, `install` |
| RF-INS-02 | ✔ | Test: `cli`, `engine` |
| RF-INS-03 | ✔ | Test: `cli` |
| RF-INS-04 | ✔ | Test: `cli` |
| RF-INS-05 | ✔ | Test: `cli` |
| RF-INS-06 | ✔ | Test: `cli` |
| RF-INS-07 | ✔ | Test: `cli`, `init`, `retry` |

## INI

| Requisito | Estado | Evidencia |
|---|---|---|
| RF-INI-01 | ✔ | Test: `init` |
| RF-INI-02 | ✔ | Test: `detect`, `init` |
| RF-INI-03 | ✔ | Test: `detect`, `init` |
| RF-INI-04 | ✔ | Test: `init` |
| RF-INI-05 | ✔ | Test: `detect`, `init` |
| RF-INI-06 | ✔ | Test: `init` |
| RF-INI-07 | ✔ | Test: `init` |
| RF-INI-08 | ✔ | Test: `init` |
| RF-INI-09 | ✔ | Test: `init` |
| RF-INI-10 | ✔ | Test: `generate`, `init` |
| RF-INI-11 | ✔ | Test: `detect`, `init` |
| RF-INI-12 | ✔ | Test: `detect`, `init` |
| RF-INI-13 | ✔ | Test: `init` |
| RF-INI-14 | ✔ | Test: `init` |
| RF-INI-15 | ✔ | Test: `init` |
| RF-INI-16 | ✔ | Test: `init` |
| RF-INI-17 | ✔ | Test: `init` |
| RF-INI-18 | ✔ | Test: `engine`, `init` |

## CNV

| Requisito | Estado | Evidencia |
|---|---|---|
| RF-CNV-01 | ✔ | Test: `detect` |
| RF-CNV-02 | ✔ | Test: `detect` |
| RF-CNV-03 | ✔ | Test: `detect` |
| RF-CNV-04 | ✔ | Test: `generate` |
| RF-CNV-05 | ✔ | Test: `generate` |
| RF-CNV-06 | ✔ | Test: `detect`, `generate` |

## GEN

| Requisito | Estado | Evidencia |
|---|---|---|
| RF-GEN-01 | ✔ | Test: `generate` |
| RF-GEN-02 | ✔ | Test: `generate` |
| RF-GEN-03 | ✔ | Test: `generate` |
| RF-GEN-04 | ✔ | Test: `claude-adapter`, `generate` |
| RF-GEN-05 | ✔ | Test: `claude-adapter`, `generate` |
| RF-GEN-06 | ✔ | Test: `claude-adapter`, `generate` |
| RF-GEN-07 | ✔ | Test: `generate` |
| RF-GEN-08 | ✔ | Test: `generate`, `init` |
| RF-GEN-09 | ✔ | Test: `sync` |
| RF-GEN-10 | ✔ | Test: `sync` |
| RF-GEN-11 | ✔ | Test: `engine`, `sync` |
| RF-GEN-12 | ✔ | Test: `config`, `sync` |
| RF-GEN-13 | ✔ | Test: `sync` |
| RF-GEN-14 | ✔ | Test: `generate` |

## MRG

| Requisito | Estado | Evidencia |
|---|---|---|
| RF-MRG-01 | ✔ | Test: `engine` |
| RF-MRG-02 | ◐ | Test: `claude-adapter`, `engine`. JSON completo; TOML pendiente (solo lo necesita Codex). |
| RF-MRG-03 | ✔ | Test: `engine` |
| RF-MRG-04 | ✔ | Test: `engine` |
| RF-MRG-05 | ✔ | Test: `engine` |

## MOD

| Requisito | Estado | Evidencia |
|---|---|---|
| RF-MOD-01 | ✔ | Test: `generate`, `init`, `topology` |
| RF-MOD-02 | ✔ | Test: `generate`, `init` |
| RF-MOD-03 | ✔ | Test: `generate` |
| RF-MOD-04 | ✔ | Test: `generate`, `init` |
| RF-MOD-05 | ✔ | Test: `generate` |
| RF-MOD-06 | ✔ | Test: `sync` |

## REM

| Requisito | Estado | Evidencia |
|---|---|---|
| RF-REM-01 | ✔ | Test: `remove` |
| RF-REM-02 | ✔ | Test: `engine`, `remove` |
| RF-REM-03 | ✔ | Test: `engine`, `remove` |
| RF-REM-04 | ✔ | Test: `remove` |
| RF-REM-05 | ✔ | Test: `remove` |
| RF-REM-06 | ✔ | Test: `remove` |
| RF-REM-07 | ✔ | Test: `remove` |
| RF-REM-08 | ✔ | Test: `remove` |

## UPG

| Requisito | Estado | Evidencia |
|---|---|---|
| RF-UPG-01 | ✔ | Test: `mvp` |
| RF-UPG-02 | ✔ | Test: `doctor`, `mvp`, `sync` |
| RF-UPG-03 | ✔ | Test: `mvp` |
| RF-UPG-04 | ✔ | Test: `mvp` |

## DOC

| Requisito | Estado | Evidencia |
|---|---|---|
| RF-DOC-01 | ✔ | Test: `doctor` |
| RF-DOC-02 | ✔ | Test: `doctor` |
| RF-DOC-03 | ✔ | Test: `doctor` |
| RF-DOC-04 | ✔ | Test: `doctor` |
| RF-DOC-05 | ✔ | Test: `doctor` |
| RF-DOC-06 | ✔ | Test: `doctor` |

## SDD

| Requisito | Estado | Evidencia |
|---|---|---|
| RF-SDD-01 | ✔ | Test: `flow` |
| RF-SDD-02 | ✔ | Test: `flow` |
| RF-SDD-03 | ✔ | Ruta y numeración: `sdd-flow` ("Spec SVC-001-health-check created"). La entrevista (una pregunta cada vez, máx. 6) es instrucción de la skill `spec-generator`. |
| RF-SDD-04 | ✔ | Test: `flow`, `sdd-flow` |
| RF-SDD-05 | ✔ | Test: `flow` |
| RF-SDD-06 | ✔ | Test: `flow` |
| RF-SDD-07 | ◐ | Instrucción de la skill `spec-generator`; no hay comprobación automática del contenido. |
| RF-SDD-08 | ◐ | Comando `/sdd:clarify` con el subagente `spec-reviewer` (solo lectura) y el gate `clarify`; el análisis es del modelo. |
| RF-SDD-09 | ◐ | Comando `/sdd:plan` y rol `architect`; el gate `plan` es determinista, el contenido del plan es instrucción. |
| RF-SDD-10 | ◐ | Instrucción del rol `architect`; los contratos son zona protegida y se copian entre repos con `sdd.js contract import` (`topology`). |
| RF-SDD-11 | ✔ | `sdd.js new-adr` y el gate `protected` con ADR obligatorio: `sdd-flow` (RF-GAT-07/08), `flow`. |
| RF-SDD-12 | ✔ | Test: `flow` |
| RF-SDD-13 | ✔ | Test: `files-bash-guard`, `flow`, `sdd-flow` |
| RF-SDD-14 | ✔ | Test: `sdd-flow` |
| RF-SDD-15 | ✔ | Test: `sdd-flow` |
| RF-SDD-16 | ✔ | Test: `files-bash-guard`, `flow`, `sdd-flow` |
| RF-SDD-17 | ✔ | `sdd-flow`: "/sdd:status shows spec, task, blockers and cost as not available". |
| RF-SDD-18 | ✔ | Test: `files-bash-guard`, `sdd-flow` |

## ORQ

| Requisito | Estado | Evidencia |
|---|---|---|
| RF-ORQ-01 | ✔ | Test: `flow`, `sdd-flow` |
| RF-ORQ-02 | ✔ | Test: `files-bash-guard`, `sdd-flow` |
| RF-ORQ-03 | ✔ | Test: `sdd-flow` |
| RF-ORQ-04 | ◐ | Instrucción de la tarea y del rol; el guardián permite los archivos de test dentro del componente. No se verifica el orden. |
| RF-ORQ-05 | ✔ | `sdd.js verify` ejecuta los comandos del componente: `sdd-flow` ("one task end to end"). |
| RF-ORQ-06 | ◐ | Instrucción de `/sdd:next` y del orquestador; el gate `review` existe pero no se exige antes de la prueba manual. |
| RF-ORQ-07 | ✔ | Gate `review`: los hallazgos se muestran y el usuario decide (`flow`: decisiones de gates). |
| RF-ORQ-08 | ✔ | Bloque gestionado de `progress.md` con tarea, estado, bloqueos y decisiones: `flow` (caso límite 13), `sdd-flow`. |
| RF-ORQ-09 | ✔ | Test: `sdd-flow` |
| RF-ORQ-10 | ✔ | Test: `claude-adapter` |
| RF-ORQ-11 | ✖ | Pendiente: el modo degradado solo hace falta para herramientas sin subagentes (fuera del alcance del MVP). |
| RF-ORQ-12 | ✔ | Test: `flow`, `sdd-flow` |

## GAT

| Requisito | Estado | Evidencia |
|---|---|---|
| RF-GAT-01 | ✔ | Test: `git-guard` |
| RF-GAT-02 | ✔ | Test: `git-guard` |
| RF-GAT-03 | ✔ | Test: `sdd-flow` |
| RF-GAT-04 | ✔ | Test: `sdd-flow`, `topology` |
| RF-GAT-05 | ✔ | Test: `files-bash-guard`, `sdd-flow` |
| RF-GAT-06 | ✔ | Test: `files-bash-guard`, `sdd-flow` |
| RF-GAT-07 | ✔ | Test: `files-bash-guard`, `flow`, `sdd-flow` |
| RF-GAT-08 | ✔ | Test: `files-bash-guard`, `flow`, `sdd-flow` |
| RF-GAT-09 | ✔ | Test: `files-bash-guard`, `generate` |
| RF-GAT-10 | ✔ | Test: `flow`, `sdd-flow` |
| RF-GAT-11 | ✔ | Test: `files-bash-guard`, `flow`, `sdd-flow` |
| RF-GAT-12 | ✔ | Test: `flow`, `sdd-flow` |
| RF-GAT-13 | ✔ | Test: `flow`, `sdd-flow` |
| RF-GAT-14 | ✔ | Test: `flow`, `sdd-flow` |

## RET

| Requisito | Estado | Evidencia |
|---|---|---|
| RF-RET-01 | ✔ | Test: `retry`, `sdd-flow` |
| RF-RET-02 | ✔ | Test: `files-bash-guard`, `retry`, `sdd-flow` |
| RF-RET-03 | ✔ | Test: `retry`, `sdd-flow` |
| RF-RET-04 | ✔ | Test: `flow`, `sdd-flow` |
| RF-RET-05 | ✔ | Test: `files-bash-guard`, `flow`, `sdd-flow` |
| RF-RET-06 | ✔ | Test: `flow`, `retry`, `sdd-flow` |
| RF-RET-07 | ✔ | Test: `retry`, `sdd-flow` |

## MD

| Requisito | Estado | Evidencia |
|---|---|---|
| RF-MD-01 | ✔ | Test: `docs-guard`, `files-bash-guard` |
| RF-MD-02 | ✔ | Test: `docs-guard` |
| RF-MD-03 | ◐ | El guardián pide confirmar al usuario; añadirlo a la lista blanca lo hace el usuario en `harness.config.yaml` + `sdd-harness sync`. |
| RF-MD-04 | ✔ | El rol `doc-writer` solo tiene la lista blanca como rutas de escritura y el guardián de docs aplica a todos: `generate` (RF-GEN-04), `docs-guard`. |

## DOM

| Requisito | Estado | Evidencia |
|---|---|---|
| RF-DOM-01 | ✔ | Rutas por rol generadas desde los componentes: `generate` (RF-GEN-04: "only the roles the project needs"). |
| RF-DOM-02 | ✔ | Test: `claude-adapter` |
| RF-DOM-03 | ✔ | Test: `sdd-flow` |
| RF-DOM-04 | ✔ | Test: `sdd-flow` |

## VER

| Requisito | Estado | Evidencia |
|---|---|---|
| RF-VER-01 | ✔ | Test: `sdd-flow` |
| RF-VER-02 | ✔ | Test: `doctor`, `sdd-flow` |
| RF-VER-03 | ✔ | Test: `claude-adapter`, `doctor`, `topology` |
| RF-VER-04 | ✔ | Test: `claude-adapter` |
| RF-VER-05 | ✔ | Test: `claude-adapter`, `init` |
| RF-VER-06 | ✔ | Test: `claude-adapter` |

## TOP

| Requisito | Estado | Evidencia |
|---|---|---|
| RF-TOP-01 | ✔ | Test: `topology` |
| RF-TOP-02 | ✔ | Test: `topology` |
| RF-TOP-03 | ✔ | Test: `topology` |
| RF-TOP-04 | ✔ | Test: `topology` |
| RF-TOP-05 | ✔ | Test: `topology` |
| RF-TOP-06 | ✔ | Test: `topology` |
| RF-TOP-07 | ✔ | Test: `topology` |
| RF-TOP-08 | ✔ | Test: `topology` |
| RF-TOP-09 | ✔ | Test: `topology` |
| RF-TOP-10 | ✔ | Test: `topology` |
| RF-TOP-11 | ✔ | Test: `topology` |

## SKL

| Requisito | Estado | Evidencia |
|---|---|---|
| RF-SKL-01 | ✔ | Test: `generate` |
| RF-SKL-02 | ✔ | Test: `skills-tracker` |
| RF-SKL-03 | ✔ | Test: `skills-tracker` |
| RF-SKL-04 | ✔ | Test: `skills-tracker` |
| RF-SKL-05 | ✔ | Test: `skills-tracker` |
| RF-SKL-06 | ✔ | Test: `skills-tracker` |
| RF-SKL-07 | ✔ | Test: `skills-tracker` |
| RF-SKL-08 | ✔ | Test: `skills-tracker` |
| RF-SKL-09 | ✔ | Test: `skills-tracker` |
| RF-SKL-10 | ✔ | Test: `skills-tracker` |
| RF-SKL-11 | ✔ | Test: `skills-tracker` |
| RF-SKL-12 | ✔ | Test: `generate`, `skills-tracker` |
| RF-SKL-13 | ✔ | Test: `skills-tracker` |
| RF-SKL-14 | ✔ | Test: `skills-tracker` |
| RF-SKL-15 | ✔ | Test: `skills-tracker` |

## TRK

| Requisito | Estado | Evidencia |
|---|---|---|
| RF-TRK-01 | ✔ | Test: `skills-tracker` |
| RF-TRK-02 | ✔ | Test: `skills-tracker` |
| RF-TRK-03 | ✔ | Test: `skills-tracker` |
| RF-TRK-04 | ✔ | Test: `skills-tracker` |
| RF-TRK-05 | ✔ | Test: `skills-tracker` |
| RF-TRK-06 | ✔ | Test: `skills-tracker` |
| RF-TRK-07 | ✔ | Test: `skills-tracker` |
| RF-TRK-08 | ✔ | Test: `skills-tracker` |
| RF-TRK-09 | ✔ | Test: `skills-tracker` |
| RF-TRK-10 | ✔ | Test: `skills-tracker` |

## OBS

| Requisito | Estado | Evidencia |
|---|---|---|
| RF-OBS-01 | ✔ | Test: `mvp` |
| RF-OBS-02 | ✔ | Test: `mvp` |
| RF-OBS-03 | ✖ | Pendiente: Claude Code no expone todavía el costo por tarea a los hooks. |
| RF-OBS-04 | ✔ | `sdd-flow`: el costo aparece como "no disponible" y `cost: null` en JSON. |
| RF-OBS-05 | ✔ | Test: `generate`, `mvp` |

## ADP

| Requisito | Estado | Evidencia |
|---|---|---|
| RF-ADP-01 | ◐ | Test: `claude-adapter`. Implementado para Claude Code; opencode, Codex y Antigravity pendientes. |
| RF-ADP-02 | ◐ | Test: `claude-adapter`. Implementado para Claude Code; otras herramientas pendientes. |
| RF-ADP-03 | ✔ | Test: `doctor` |
| RF-ADP-04 | ◐ | Test: `doctor`. Aviso de allowlist de Antigravity en `doctor`; el adaptador de Antigravity está pendiente. |
| RF-ADP-05 | ✔ | Test: `claude-adapter` |
| RF-ADP-06 | ✔ | Test: `claude-adapter` |

## Requisitos no funcionales

| Requisito | Estado | Evidencia |
|---|---|---|
| RNF-01 Plataformas | ✔ | CI en Windows, macOS y Linux; sin bash, WSL ni symlinks |
| RNF-02 Runtime | ✔ | Node.js ≥ 20 y Git; la versión mínima sigue abierta (§11) |
| RNF-03 Cero dependencias en el proyecto | ✔ | Los scripts copiados no tienen dependencias |
| RNF-04 Rutas | ✔ | Los tests usan rutas con espacios y "ñandú"; CI con rutas cortas de Windows y `/private/var` de macOS |
| RNF-05 Saltos de línea | ✔ | `config`, `engine` |
| RNF-06 Idempotencia | ✔ | `sync` (dos sync seguidos), `remove` (dos remove seguidos) |
| RNF-07 Atomicidad | ✔ | `engine`, `init` (RF-INI-18) |
| RNF-08 Rendimiento | ✔ | `git-guard`, `cli`; medido a mano: `doctor` y `sync --dry-run` ~0,5 s con 10 001 archivos |
| RNF-09 Red | ✔ | Solo skills y tracker, avisando antes |
| RNF-10 Sin red | ✔ | El resto de comandos no usa la red |
| RNF-11 Seguridad | ✔ | Tokens solo de variables de entorno; detección de secretos en pre-commit |
| RNF-12 Idioma de la CLI | ◐ | Español completo; inglés solo en lo anterior al MVP |
| RNF-13 Accesibilidad de la terminal | ✔ | Sin colores; `--json` en `doctor` y `sdd.js status` |
| RNF-14 Uso en CI | ✔ | `--yes`, `--config`, `--dry-run`; códigos de salida documentados |
| RNF-15 Calidad | ◐ | La mayoría de RF tienen test; los marcados ◐ o ✖ arriba no |
| RNF-16 CI del harness | ✔ | Matriz en verde |
| RNF-17 Licencia | ✔ | `LICENSE` y `NOTICE` |
| RNF-18 Documentación | ✔ | README y guías en español e inglés (`docs/guides/`) |

## Criterios de finalización

| Criterio | Estado |
|---|---|
| 1. Cada RF con al menos un test | ◐ Ver tabla: los ◐ por instrucción y los ✖ no tienen test propio |
| 2. Matriz de CI en verde | ✔ |
| 3. Fixtures con init, sync, doctor y remove | ✔ `remove` (criterio 6) recorre las cinco fixtures |
| 4. Demo manual con Claude Code | ✖ Pendiente |
| 5. `doctor` con el nivel de enforcement correcto | ◐ Correcto para Claude Code; el resto de herramientas figura como "solo instrucción" |
| 6. `remove` deja cada fixture idéntica | ✔ |
| 7. README, guías y NOTICE | ✔ |
| 8. Este recorrido | ✔ |

## Veredicto

**Spec cumplida para el alcance acordado del MVP (Claude Code, mensajes en español), con excepciones.** 173 de 186 requisitos funcionales están cumplidos con evidencia y 11 lo están en parte o por instrucción al agente. Quedan pendientes, por decisión de alcance: el modo degradado y los adaptadores de otras herramientas (RF-ORQ-11, parte de RF-ADP), el costo por tarea (RF-OBS-03), la fusión TOML (parte de RF-MRG-02), los mensajes en inglés de lo nuevo (RNF-12) y la demo con Claude Code real (criterio 4). Para la v1.0 completa falta esa lista.
