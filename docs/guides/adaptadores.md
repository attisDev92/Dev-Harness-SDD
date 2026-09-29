# Escribir un adaptador

Un adaptador traduce el harness neutral a los archivos nativos de una herramienta de agentes (RF-ADP-01…06). El núcleo no cambia al añadir una herramienta.

## Pipeline

```
harness.config.yaml
  → generateCore     AGENTS.md, plantillas, .harness/scripts, skills canónicas
  → adaptadores      uno por herramienta de `tools`
  → git hooks, CI    red de seguridad universal
  → finalize         .harness/guards.json, .git/info/exclude, límites de tamaño
  → planChanges      diff contra disco y manifiesto, conflictos, transacción
```

Punto de entrada: `src/generate/index.js`.

## Interfaz

```js
export const id = 'mi-herramienta';          // valor en harness.config.yaml → tools
export const RULES = ['commits', 'deps', 'protected', 'docs', 'retries', 'verify', 'lanes'];

export function generate(config, { tracked, skills, installedSkills }) {
  return { entries, notices };
}
```

Regístralo en `ADAPTERS` de `src/generate/index.js`.

### Entradas

| Tipo | Campos | Uso |
|---|---|---|
| `file` | `path`, `content`, `executable?` | Archivo propio del harness (agentes, comandos, copias de skills) |
| `block` | `path`, `content`, `style?` (`html` o `hash`) | Bloque gestionado dentro de un archivo del usuario |
| `json` | `path`, `values` (claves con puntos), `appends` (clave → elementos) | Configuración fusionada clave a clave; `appends` añade a listas sin tocar lo que ya había |

Cada entrada lleva `tool: id`. La que conecta los guardianes con la herramienta lleva además `enforces: RULES`: `sdd-harness doctor` solo cuenta una regla como determinista mientras esa entrada esté intacta en disco.

### Reglas

| Regla | Guardián |
|---|---|
| `commits` | `.harness/scripts/hook.js` → `bash-guard.js` → `git-guard.js` |
| `deps` | `bash-guard.js` (instalaciones) y `files-guard.js` (manifiestos, lockfiles) → *preguntar* |
| `protected` | `files-guard.js` y los destinos de escritura por shell |
| `docs` | `files-guard.js` → `docs-guard.js` |
| `retries` | `sdd.js verify` → `retry.js` |
| `verify` | Hook de parada y `sdd.js task done` |
| `lanes` | Instantánea antes y después de cada subagente |

### Modo local y team

En modo local un adaptador no puede escribir en archivos versionados (RF-MOD-02). Consulta `tracked` y, si la única forma de configurar la herramienta es un archivo versionado, devuelve un aviso `toolNeedsTeam` en lugar de la entrada (RF-MOD-04).

### Payload de los hooks

`src/guards/hook.js` lee el payload de Claude Code. Una herramienta con otro formato necesita su propio script de entrada que normalice el payload y llame a los mismos guardianes (`checkShell`, `checkWrite`, `decide`…). Los guardianes son neutrales.

## Herramientas sin subagentes o sin hooks que bloqueen

El modo degradado (RF-ORQ-11, pendiente) ejecuta los roles uno detrás de otro en el mismo agente. En `RULES` solo van las reglas realmente conectadas; el resto aparece en `doctor` como "solo por instrucción" (RF-ADP-03).
