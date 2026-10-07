// Practice skills of the harness (RF-SKL-01): clean-code, design-system,
// backend-architecture, api-design, secure-coding, db-migrations,
// testing-strategy and docs-writer. Only the ones the project needs are
// generated (RF-SKL-12), and design-system follows the design source.

const DESIGN_SOURCE = {
  none: 'No hay fuente de diseño externa: el sistema de diseño es el código. Antes de crear un componente, busca si ya existe uno parecido y extiéndelo.',
  'tokens-in-code': 'Los tokens viven en el código (colores, tipografía, espaciado, radios, sombras). Úsalos siempre; nunca escribas valores sueltos como `#3a7bd5` o `13px`. Si falta un token, propónlo en lugar de inventarlo.',
  penpot: 'La fuente de verdad es Penpot. Lee tokens y componentes con el MCP de Penpot antes de implementar; si el código y Penpot no coinciden, pregunta al usuario cuál manda.',
  figma: 'La fuente de verdad es Figma. Lee variables, estilos y componentes con el MCP de Figma antes de implementar; si el código y Figma no coinciden, pregunta al usuario cuál manda.',
};

const skill = (name, description, body) => `---
name: ${name}
description: ${description}
---

${body.trim()}
`;

export function practiceSkills(config) {
  const kinds = new Set(Object.values(config.components ?? {}).map((c) => c.kind ?? 'other'));
  const stack = Object.values(config.components ?? {}).map((c) => String(c.stack ?? '').toLowerCase()).join('+');
  const frontend = kinds.has('frontend');
  const backend = kinds.has('backend') || kinds.has('db') || kinds.has('other');
  const database = kinds.has('db') || /postgres|mysql|sqlite|mongo|prisma|drizzle|typeorm|sequelize|knex|sqlalchemy|django|rails|laravel/.test(stack);
  const out = {};

  out['clean-code'] = skill('clean-code', 'Código claro y pequeño. Úsala al implementar cualquier tarea, en frontend o backend.', `
# Clean code

**Primero mandan las convenciones del proyecto** (AGENTS.md, CONTRIBUTING.md, linters). Esta skill solo rellena lo que ellas no dicen.

- Nombres que dicen qué es y para qué sirve; nada de \`data\`, \`tmp\`, \`handleStuff\`.
- Funciones pequeñas con una sola responsabilidad. Si necesitas un comentario para explicar *qué* hace un bloque, extráelo a una función con ese nombre.
- KISS: la solución más simple que cumple el requisito. YAGNI: nada "por si acaso". DRY solo cuando la duplicación es real (tres veces, no dos).
- Sin abstracciones prematuras: ni interfaces con una sola implementación ni capas vacías.
- Errores explícitos: nunca los silencies; falla pronto y con un mensaje útil.
- Sin código muerto, sin comentarios de código antiguo, sin \`console.log\` de depuración.
- Toca solo lo que pide la tarea. Un refactor fuera del alcance es otra tarea.
`);

  out['testing-strategy'] = skill('testing-strategy', 'Qué probar y cómo: pirámide de tests, datos de prueba y un test por requisito. Úsala al escribir tests.', `
# Estrategia de tests

- **Tests primero**: escribe el test que falla, luego el código mínimo que lo pasa.
- **Un test o más por requisito**, con su ID en el nombre (\`RF-03 rechaza correos inválidos\`) para que \`/sdd:validate\` lo encuentre.
- Pirámide: muchos unitarios (lógica pura, rápidos), algunos de integración (bordes reales: base de datos, HTTP), pocos E2E (los flujos que el usuario prueba a mano).
- Cada test prueba **un comportamiento** observable, no la implementación. Nombres que se leen como una frase.
- Datos de prueba explícitos y mínimos dentro del test; nada de fixtures compartidos gigantes.
- Sin tests frágiles: nada de \`sleep\`, horas reales ni orden entre tests. Controla el tiempo, la aleatoriedad y la red.
- Cubre también el camino de error de cada requisito "SI … ENTONCES".
- Un test que falla a veces es un fallo: repórtalo como posible inestabilidad en el triage.
`);

  out['secure-coding'] = skill('secure-coding', 'Checklist de seguridad basado en OWASP. Úsala al implementar backend y al revisar.', `
# Código seguro

- **Entrada**: valida en el borde (tipo, formato, longitud, rango) con una lista de lo permitido, no de lo prohibido.
- **Inyección**: consultas siempre parametrizadas; nunca concatenes datos del usuario en SQL, comandos de shell, rutas o HTML.
- **Autenticación**: contraseñas con un hash lento (argon2, bcrypt); tokens con caducidad; límite de intentos.
- **Autorización**: comprueba en el servidor, en cada petición, que *ese* usuario puede acceder a *ese* recurso (no solo que está autenticado).
- **Secretos**: nunca en el código ni en logs; siempre de variables de entorno o un gestor de secretos.
- **Errores**: al cliente, mensajes genéricos; el detalle solo en logs internos, sin datos personales.
- **Cabeceras y CORS**: orígenes explícitos (nada de \`*\` con credenciales), CSP, HSTS, \`X-Content-Type-Options\`.
- **Dependencias**: no añadas ninguna sin aprobación; prefiere las mantenidas y conocidas.
- Revisando: informa cada hallazgo con archivo, línea, riesgo y arreglo propuesto.
`);

  out['docs-writer'] = skill('docs-writer', 'Actualiza la documentación permitida (README, CHANGELOG, arquitectura, lecciones). Úsala en el rol doc-writer.', `
# Documentación

- Solo documentos de la **lista blanca** de AGENTS.md. Cualquier otro necesita que el usuario lo pida.
- README: qué es, cómo se instala, cómo se usa. Actualízalo cuando cambie algo que el usuario ve.
- CHANGELOG: una entrada por cambio visible, en la sección "Sin publicar", agrupada en Añadido / Cambiado / Corregido / Eliminado.
- \`docs/architecture/\`: cómo encajan las piezas y por qué; enlaza los ADRs en vez de repetirlos.
- \`docs/lessons.md\`: lo aprendido en triages y revisiones que evitará repetir errores.
- Frases cortas, ejemplos que funcionan, nada de relleno. Si un documento contradice al código, manda el código: corrige el documento.
`);

  if (frontend) {
    const source = config.design?.source ?? 'none';
    out['design-system'] = skill('design-system', 'Sistema de diseño: tokens, API de componentes, variantes y estados. Úsala al crear o cambiar interfaz.', `
# Sistema de diseño

**Fuente de diseño de este proyecto: ${source}.** ${DESIGN_SOURCE[source] ?? DESIGN_SOURCE.none}

- **Reutiliza antes de crear**: busca un componente existente y extiéndelo con una variante.
- **Tokens, no valores**: color, tipografía, espaciado, radios, sombras y movimiento salen de tokens.
- **API de componentes**: props pocas y con nombres de negocio (\`variant="danger"\`, no \`color="red"\`); los hijos por composición, no por props gigantes.
- **Variantes y tamaños** declarados en un solo sitio; nada de estilos condicionales repartidos.
- **Estados completos**: normal, hover, foco visible, activo, deshabilitado, cargando, vacío y error.
- **Accesibilidad**: contraste AA, navegación por teclado, etiquetas para lectores de pantalla, objetivos táctiles de 44 px.
- **Responsive** desde el móvil; sin anchos fijos.
`);
  }

  if (backend) {
    out['backend-architecture'] = skill('backend-architecture', 'Capas, fronteras y dirección de dependencias en el backend. Úsala al diseñar o implementar backend.', `
# Arquitectura de backend

- **Capas**: entrada (HTTP, colas, CLI) → aplicación (casos de uso) → dominio (reglas) → infraestructura (base de datos, servicios externos).
- **Las dependencias apuntan hacia dentro**: el dominio no conoce frameworks ni la base de datos.
- **Validación en los bordes**: los datos que entran se validan y se convierten una sola vez; dentro se confía en los tipos.
- **Errores**: el dominio lanza errores de negocio con nombre; la capa de entrada los traduce a códigos HTTP en un solo sitio.
- **Transacciones** en el caso de uso, no en los controladores ni en los repositorios.
- **Configuración** por variables de entorno leídas y validadas al arrancar.
- Sigue la estructura que ya tenga el proyecto; cambiarla es una decisión de arquitectura (ADR y aprobación).
`);
    out['api-design'] = skill('api-design', 'Diseño de APIs: contrato primero, REST coherente, errores y paginación uniformes. Úsala al definir o implementar endpoints.', `
# Diseño de APIs

- **Contrato primero**: el contrato (OpenAPI) se escribe en \`contracts/\` de la spec antes que el código, y el código lo cumple.
- **Recursos en plural** y verbos HTTP con su significado: GET lee, POST crea, PUT/PATCH cambia, DELETE borra.
- **Códigos de estado** correctos: 201 al crear, 204 sin cuerpo, 400 entrada inválida, 401 sin autenticar, 403 sin permiso, 404, 409 conflicto, 422 regla de negocio.
- **Un solo formato de error**: \`{ "error": { "code": "…", "message": "…", "details": [...] } }\`.
- **Paginación** uniforme (cursor preferido) con límite máximo; filtros y orden por parámetros de consulta.
- **Versionado**: nunca rompas un contrato publicado; lo incompatible va en una versión nueva.
- **Idempotencia** en operaciones que se pueden reintentar (clave de idempotencia en POST sensibles).
- Cambiar un contrato que otro repo consume requiere aprobación (zona protegida).
`);
  }

  if (database) {
    out['db-migrations'] = skill('db-migrations', 'Migraciones de base de datos seguras y reversibles. Úsala en cualquier cambio de esquema.', `
# Migraciones de base de datos

- **El plan aprobado ya aprueba su modelo de datos**: una migración que aparece en el modelo de datos del plan aprobado no pide otra aprobación ni un ADR. Impleméntala.
- **Lo que no está en el plan**: añádelo al modelo de datos de plan.md y cuéntalo en tu resumen.
- **ADR solo para decisiones estructurales**: elegir o cambiar el motor de base de datos, la estrategia multi-tenant, el particionado, desnormalizar, o borrar o transformar datos existentes. Crear tablas o añadir columnas no lo es.
- **Reversible**: cada migración tiene su vuelta atrás probada.
- **Expand / contract** para no romper lo que está en producción:
  1. Expandir: añade columnas o tablas nuevas, compatibles con el código actual.
  2. Migrar datos por lotes y desplegar el código que usa lo nuevo.
  3. Contraer: elimina lo viejo solo cuando ya nada lo usa, en otra migración.
- **Nunca** renombres ni borres columnas en un solo paso; nunca cambies una migración ya aplicada.
- Índices sobre tablas grandes, de forma concurrente si el motor lo permite.
- Columnas nuevas nullable o con valor por defecto; las restricciones se añaden después de rellenar los datos.
- Prueba la migración (ida y vuelta) contra una copia con datos representativos.
`);
  }
  return out;
}
