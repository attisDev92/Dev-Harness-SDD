// SDD templates in Spanish and English (RF-CNV-04). sdd.js and the sdd skill
// copy them into specs/ and docs/; the placeholders are in <angle brackets>.
// The status of a spec lives in its frontmatter, added by `sdd.js new-spec`.

const en = {
  constitution: `# Constitution

Short, verifiable principles. They take precedence over every other instruction.

1. The agent proposes the commit when a story closes and commits only after the user's OK.
2. Every stack or architecture decision is recorded in an ADR.
3. No task is finished with verification failing.
4. <principle>
5. <principle>
6. <principle>
`,
  spec: `# <PREFIX>-<NNN> — <name>

| Field | Value |
|---|---|
| Date | <YYYY-MM-DD> |
| Depends on | <none \\| repo#ID> |

> This spec describes WHAT and WHY. HOW belongs in plan.md.

## Context and goal

## User stories

- **H1:** As <actor> I want <capability> so that <benefit>.

## Functional requirements (EARS)

- **RF-01:** WHEN <event>, THE SYSTEM SHALL <response>.
- **RF-02:** IF <unwanted condition>, THEN THE SYSTEM SHALL <response>.
- **RF-03:** WHILE <state>, THE SYSTEM SHALL <response>.
- **RF-04:** WHERE <feature is included>, THE SYSTEM SHALL <response>.

## Non-functional requirements

## Edge cases

## Out of scope

## Open questions

- [NEEDS CLARIFICATION: <question>]
`,
  plan: `# Plan — <PREFIX>-<NNN>

## Modules

| Module | Responsibility | Requirements |
|---|---|---|

## Data model

## Decisions

| Decision | Discarded alternative | Reason | ADR |
|---|---|---|---|

## Contracts

## Test strategy

| Requirement | Test level | Test |
|---|---|---|
`,
  tasks: `# Tasks — <PREFIX>-<NNN>

Ordered by dependency; tasks of different components run in parallel, tests first. Only the component is required. Work that comes up while implementing is added at the end, marked "added during implementation".

- [ ] T1 <title> · Requirements: RF-01 · Component: <id> · Scope: <globs> · Depends on: — · Done when: <verifiable check>
`,
  progress: `# Progress — <PREFIX>-<NNN>

Decisions and notes taken while building this spec. The status is in spec.md and tasks.md.

## Decisions

| Date | Decision | By |
|---|---|---|
`,
  adr: `# ADR-<NNNN> — <title>

| Field | Value |
|---|---|
| Status | Proposed |
| Date | <YYYY-MM-DD> |
| Spec | <PREFIX>-<NNN> |

## Context

## Decision

## Discarded alternatives

| Alternative | Why not |
|---|---|

## Consequences
`,
};

const es = {
  constitution: `# Constitución

Principios cortos y verificables. Prevalecen sobre cualquier otra instrucción.

1. El agente propone el commit al cerrar cada historia y solo lo hace con el OK del usuario.
2. Toda decisión de stack o arquitectura queda registrada en un ADR.
3. Ninguna tarea termina con la verificación en rojo.
4. <principio>
5. <principio>
6. <principio>
`,
  spec: `# <PREFIJO>-<NNN> — <nombre>

| Campo | Valor |
|---|---|
| Fecha | <AAAA-MM-DD> |
| Depende de | <ninguna \\| repo#ID> |

> Esta spec describe el QUÉ y el POR QUÉ. El CÓMO va en plan.md.

## Contexto y objetivo

## Historias de usuario

- **H1:** Como <actor> quiero <capacidad> para <beneficio>.

## Requisitos funcionales (EARS)

- **RF-01:** CUANDO <evento>, EL SISTEMA <respuesta>.
- **RF-02:** SI <condición no deseada>, ENTONCES EL SISTEMA <respuesta>.
- **RF-03:** MIENTRAS <estado>, EL SISTEMA <respuesta>.
- **RF-04:** DONDE <se incluya la función>, EL SISTEMA <respuesta>.

## Requisitos no funcionales

## Casos límite

## Fuera de alcance

## Dudas abiertas

- [NECESITA ACLARACIÓN: <pregunta>]
`,
  plan: `# Plan — <PREFIJO>-<NNN>

## Módulos

| Módulo | Responsabilidad | Requisitos |
|---|---|---|

## Modelo de datos

## Decisiones

| Decisión | Alternativa descartada | Motivo | ADR |
|---|---|---|---|

## Contratos

## Estrategia de tests

| Requisito | Nivel | Test |
|---|---|---|
`,
  tasks: `# Tareas — <PREFIJO>-<NNN>

Ordenadas por dependencia; las de componentes distintos avanzan en paralelo, tests primero. Solo el componente es obligatorio. El trabajo que surge al implementar se añade al final, marcado "añadida en implementación".

- [ ] T1 <título> · Requisitos: RF-01 · Componente: <id> · Alcance: <globs> · Depende de: — · Hecho cuando: <comprobación verificable>
`,
  progress: `# Progreso — <PREFIJO>-<NNN>

Decisiones y notas tomadas al construir esta spec. El estado está en spec.md y tasks.md.

## Decisiones

| Fecha | Decisión | Quién |
|---|---|---|
`,
  adr: `# ADR-<NNNN> — <título>

| Campo | Valor |
|---|---|
| Estado | Propuesto |
| Fecha | <AAAA-MM-DD> |
| Spec | <PREFIJO>-<NNN> |

## Contexto

## Decisión

## Alternativas descartadas

| Alternativa | Por qué no |
|---|---|

## Consecuencias
`,
};

/** Template names and the configured language that applies to each. */
export const TEMPLATE_LANG = {
  constitution: 'docs',
  spec: 'specs',
  plan: 'specs',
  tasks: 'specs',
  progress: 'specs',
  adr: 'docs',
};

export function template(name, lang) {
  return (lang === 'es' ? es : en)[name];
}
