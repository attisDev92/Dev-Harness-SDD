// SDD templates in Spanish and English (RF-CNV-04). The SDD commands (v0.3)
// copy them into specs/ and docs/; the placeholders are in <angle brackets>.

const en = {
  constitution: `# Constitution

Short, verifiable principles. They take precedence over every other instruction.

1. The agent never commits: it proposes commit messages and the user commits.
2. Every stack or architecture decision requires an approved ADR.
3. No task is finished with verification failing.
4. <principle>
5. <principle>
6. <principle>
`,
  spec: `# <PREFIX>-<NNN> — <name>

| Field | Value |
|---|---|
| Status | Draft, pending approval |
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

Ordered by dependency. One task at a time, tests first.

- [ ] T1 <title> · Requirements: RF-01 · Component: <id> · Scope: <globs> · Depends on: — · Done when: <verifiable check>
`,
  progress: `# Progress — <PREFIX>-<NNN>

| Field | Value |
|---|---|
| Phase | <spec \\| clarify \\| plan \\| tasks \\| implement \\| validate> |
| Current task | <T#> |
| State | <in progress \\| awaiting manual test \\| blocked \\| done> |

## Blockers

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

1. El agente nunca hace commit: propone los mensajes y el commit lo hace el usuario.
2. Toda decisión de stack o arquitectura requiere un ADR aprobado.
3. Ninguna tarea termina con la verificación en rojo.
4. <principio>
5. <principio>
6. <principio>
`,
  spec: `# <PREFIJO>-<NNN> — <nombre>

| Campo | Valor |
|---|---|
| Estado | Borrador, pendiente de aprobación |
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

Ordenadas por dependencia. Una tarea cada vez, tests primero.

- [ ] T1 <título> · Requisitos: RF-01 · Componente: <id> · Alcance: <globs> · Depende de: — · Hecho cuando: <comprobación verificable>
`,
  progress: `# Progreso — <PREFIJO>-<NNN>

| Campo | Valor |
|---|---|
| Fase | <spec \\| clarify \\| plan \\| tasks \\| implement \\| validate> |
| Tarea actual | <T#> |
| Estado | <en curso \\| esperando prueba manual \\| bloqueada \\| hecha> |

## Bloqueos

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
