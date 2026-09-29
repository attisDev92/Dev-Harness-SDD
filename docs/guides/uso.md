# Guía de uso

Esta guía recorre sdd-harness de principio a fin con Claude Code. Para el porqué del diseño, mira el [README](../../README.es.md).

## 1. Instalación

```bash
npm install -g github:attisDev92/Dev-Harness-SDD
sdd-harness --version
```

Requisitos: Node.js 20 o superior y Git. No se instala nada más de forma global ni se toca `~/.claude`.

## 2. Activar un proyecto

```bash
cd mi-proyecto
sdd-harness-init          # atajo de: sdd-harness init
```

La entrevista detecta y te pide confirmar:

| Pregunta | Qué decide |
|---|---|
| Topología | Repo único, monorepo, varios repos o workspace (carpeta con varios repos) |
| Componentes | Rutas, tipo (frontend, backend, base de datos, otro), prefijo de specs y comandos de verificación |
| Herramientas | Hoy, Claude Code |
| Convenciones e idiomas | Lo que ya declara el proyecto (AGENTS.md, CONTRIBUTING.md, linters, historial de commits) |
| Diseño, tracker, prueba manual | Fuente de diseño, tracker (cualquiera), cuándo pruebas tú |
| Modo | `local`: el equipo no ve nada · `team`: la configuración se commitea |
| Git hooks, CI | Pre-commit con los mismos checks que la CI · plantilla de GitHub Actions |
| Zonas protegidas | Qué cambios exigen tu aprobación y un ADR |

Antes de escribir, enseña cada archivo que va a crear o modificar. Ctrl+C cancela sin escribir nada.

Sin entrevista: `sdd-harness-init --config preset.yaml --yes`.

Después:

```bash
sdd-harness doctor        # salud y nivel real de protección
sdd-harness skills install  # skills de terceros verificadas que necesita tu stack
```

## 3. El flujo en Claude Code

| Comando | Qué pasa | Tú |
|---|---|---|
| `/sdd:constitution` | Propone 6–10 principios | Apruebas |
| `/sdd:spec <idea>` | Entrevista (máx. 6 preguntas) y spec en EARS | Apruebas |
| `/sdd:clarify` | Revisión de la spec: huecos y contradicciones | Apruebas |
| `/sdd:plan` | Plan técnico, contratos y ADRs | Apruebas |
| `/sdd:tasks` | Tareas de < 30 min con alcance y "Hecho cuando" | Apruebas |
| `/sdd:next` | Una tarea: tests primero, verificación, revisión | Pruebas a mano: `OK` o `KO <qué falló>` |
| `/sdd:validate` | Requisito por requisito: qué test lo cubre | Apruebas |
| `/sdd:change <cambio>` | Primero la spec, con diff | Apruebas |
| `/sdd:status` | Dónde estamos y qué bloquea | — |
| `/sdd:commit` | Propone el mensaje por repo | **Tú haces el commit** |
| `/sdd:tracker` | Sincroniza tasks.md con tu tracker | Apruebas antes de escribir en él |

Respondes a cada decisión con `/sdd:approve` o `/sdd:reject <motivo>`. Solo cuenta lo que escribes tú: el agente no puede aprobarse a sí mismo.

## 4. Qué bloquea el harness

- Commits, push, merge, rebase, tags y cambios del remoto, aunque vengan encadenados, dentro de otra shell, por alias o en scripts.
- Instalar o quitar dependencias sin tu permiso.
- Tocar zonas protegidas sin un ADR aprobado.
- Documentos fuera de la lista blanca.
- Código fuera de la tarea en curso o de su alcance, o durante un triage.
- Terminar con la verificación en rojo.
- Editar `harness.config.yaml`, `.harness/` o los archivos generados.

`sdd-harness doctor` te dice qué se aplica de verdad y qué solo por instrucción.

## 5. Mantenimiento

| Comando | Para qué |
|---|---|
| `sdd-harness sync` | Regenerar tras cambiar `harness.config.yaml` (enseña el diff antes) |
| `sdd-harness upgrade` | Pasar el proyecto a una versión nueva del harness |
| `sdd-harness skills list \| install \| update \| verify` | Skills de terceros |
| `sdd-harness contracts sync` | Actualizar snapshots de contratos entre repos |
| `sdd-harness tracker connect \| sync \| status` | GitHub Issues desde la CLI; el resto de trackers con `/sdd:tracker` |
| `sdd-harness remove` | Quitar el harness; nunca toca `specs/` ni `docs/` |

## 6. Varios repos

`sdd-harness workspace init` en una carpeta con varios repos. Cada repo guarda sus specs; las dependencias se escriben como `api#API-004` en la spec, y `sdd.js contract import api#API-004` copia el contrato del proveedor con su origen.
