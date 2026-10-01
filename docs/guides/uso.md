# Guía de uso

Esta guía recorre sdd-harness de principio a fin con Claude Code. Para el porqué del diseño, mira el [README](../../README.es.md).

## 1. Instalación

```bash
npm install -g github:attisDev92/Dev-Harness-SDD
sdd-harness --version
```

Requisitos: Node.js 24 (LTS) o superior y Git. No se instala nada más de forma global ni se toca `~/.claude`.

## 2. Activar un proyecto

```bash
cd mi-proyecto
sdd-harness-init          # atajo de: sdd-harness init
```

La entrevista detecta y te pide confirmar:

| Pregunta | Qué decide |
|---|---|
| Topología | Repo único, monorepo, varios repos o workspace (carpeta con varios repos) |
| Componentes | Rutas, tipo (frontend, backend, base de datos, otro) y comandos de verificación. Las specs se configuran aparte (`specs.id_prefix` y, en multi-repo/workspace, `specs.location`) |
| Herramientas | Hoy, Claude Code |
| Convenciones e idiomas | Lo que ya declara el proyecto (AGENTS.md, CONTRIBUTING.md, linters, historial de commits) |
| Diseño, tracker, prueba manual | Fuente de diseño, tracker (cualquiera), cuándo pruebas tú |
| Modo | `local`: el equipo no ve nada · `team`: la configuración se commitea |
| Git hooks, CI | Pre-commit que solo rechaza secretos · plantilla de GitHub Actions con docs y verificación |
| Zonas protegidas | Qué cambios exigen tu aprobación y un ADR |

Antes de escribir, enseña cada archivo que va a crear o modificar. Ctrl+C cancela sin escribir nada.

Sin entrevista: `sdd-harness-init --config preset.yaml --yes`.

Después:

```bash
sdd-harness doctor        # salud y nivel real de protección
sdd-harness skills install  # skills de terceros verificadas que necesita tu stack
```

## 3. El flujo en Claude Code

Dile al agente lo que quieres construir ("quiero un login con email") y la skill `sdd` hace el resto:

1. **Spec**: te entrevista (máx. 6 preguntas), escribe los requisitos en EARS y los revisa. 🛑 **Parada 1**: apruebas la spec.
2. **Plan y tareas**: el architect escribe plan, contratos, ADRs y `tasks.md` de una vez. 🛑 **Parada 2**: apruebas el plan con sus tareas.
3. **Implementación**: frontend y backend en paralelo (nunca más de 2 subagentes a la vez, del rol que sea), tests primero. Tras cada tarea, verificación y después revisión y documentación, en paralelo solo si hay hueco.
4. **Al cerrar una historia**: prueba manual (una pregunta normal) y el agente **propone el commit**; si dices que sí, lo hace.
5. **Al final**: validación requisito por requisito; la spec queda como `done`.

**Para aprobar, habla normal**: "sí", "continúa", "aprobado", "dale" o el botón "Aprobar". Cualquier otra respuesta se toma como cambios.

Sin parar el flujo:

- **Tareas que surgen**: el agente las añade a `tasks.md` ("añadida en implementación") y te lo cuenta.
- **Cambios de requisitos**: primero se actualiza la spec (con diff) y se sigue.
- **`harness.config.yaml`**: puedes cambiarlo cuando quieras; Claude Code te pide confirmar la edición y la configuración se regenera sola.

Atajos opcionales (ninguno hace falta para avanzar):

| Comando | Para qué |
|---|---|
| `/sdd:status` | Qué pasó: spec y estado, últimas tareas cerradas, pendientes, último verify y últimos commits |
| `/sdd:spec <idea>` | Empezar una spec |
| `/sdd:next` | Lanzar las tareas listas, hasta 2 a la vez |
| `/sdd:docs` | Poner la documentación al día en segundo plano |
| `/sdd:review` | Revisión (y QA) de lo cambiado |
| `/sdd:validate` | Informe requisito → test |
| `/sdd:commit` | Proponer el commit ahora |
| `/sdd:tracker` | Sincronizar `tasks.md` con tu tracker |

El estado es visible: `status` en el frontmatter de `spec.md` (`draft` → `spec-approved` → `plan-approved` → `done`) y las casillas de `tasks.md`.

## 4. Qué pregunta y qué bloquea el harness

- **Pregunta (confirmación nativa de Claude Code)**: `git push`, `rebase`, `merge`, `reset --hard`, borrar ramas, tags, instalar dependencias y editar `harness.config.yaml`.
- **Avisa, sin parar**: zonas protegidas (con ADR en borrador), código sin tarea o fuera de su alcance, cambios en dependencias o lockfiles, un subagente que escribe fuera de sus rutas.
- **Recuerda una vez**: terminar con la verificación en rojo.
- **Bloquea**: solo `.harness/`, los archivos generados y el bloque generado de `AGENTS.md`/`CLAUDE.md`. El pre-commit solo rechaza secretos y `.env`.

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
