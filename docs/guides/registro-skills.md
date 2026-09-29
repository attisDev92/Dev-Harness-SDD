# Proponer una skill al registro

El registro curado (`src/skills/registry.json`) es la única fuente desde la que el harness instala skills de terceros (RF-SKL-05). Añadir o cambiar una entrada siempre pasa por revisión de código.

## Requisitos de una skill

- Repositorio público en GitHub con la skill en una carpeta con `SKILL.md`.
- Licencia permitida: MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause o ISC, declarada en el repo o en la propia skill. Sin licencia clara no entra.
- Sin scripts que se ejecuten solos. Puede traer ejemplos o scripts de apoyo: el harness avisa al instalar y nunca los ejecuta, pero la revisión debe comprobar que son inofensivos.
- Útil para un rol y un stack concretos.

## Entrada del registro

```json
{
  "name": "nombre-en-el-frontmatter",
  "repo": "owner/repo",
  "path": "skills/nombre",
  "sha": "<commit de 40 caracteres>",
  "hash": "<sha256 del contenido de la carpeta>",
  "license": "MIT",
  "when": { "stack": ["react", "next"] },
  "roles": ["frontend-dev", "reviewer"]
}
```

| Campo | Significado |
|---|---|
| `sha` | Commit fijado. Nunca una rama. |
| `hash` | Hash del contenido: se recalcula al instalar y, si no coincide, se aborta (RF-SKL-06). |
| `when` | Cuándo la necesita un proyecto: `{ "always": true }`, `{ "kind": "frontend" }`, `{ "stack": [...] }` o `{ "design": "figma" }`. |
| `roles` | Qué subagentes la cargan (RF-SKL-12). |

## Calcular el hash

```bash
node -e "
import('./src/skills/installer.js').then(async (m) => {
  const entry = { repo: 'owner/repo', path: 'skills/nombre', sha: '<sha>' };
  const { files } = await m.fetchSkill(entry);
  console.log(m.treeHash(files));
});"
```

## Pull request

1. Añade la entrada a `src/skills/registry.json`.
2. Si la licencia o el origen cambian, actualiza `NOTICE`.
3. Explica en el PR para qué rol y stack sirve, y confirma que revisaste el contenido del commit fijado.
4. Actualizar una skill = cambiar `sha` y `hash`. Los proyectos lo verán con `sdd-harness skills update`, que enseña el diff antes de aplicar.
