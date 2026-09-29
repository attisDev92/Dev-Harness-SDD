# Spec 001 — sdd-harness v1.0

| Campo | Valor |
|---|---|
| Estado | Borrador, pendiente de aprobación |
| Fecha | 2026-09-28 |
| Alcance | Producto completo v1.0 en una sola spec, entregado por hitos (ver sección final) |
| Idioma | Spec y docs en español; código e identificadores en inglés |
| Ubicación en el repo | `specs/001-sdd-harness/spec.md` |

> Esta spec describe **QUÉ** hace el sistema y **POR QUÉ**. El **CÓMO** (módulos, librerías internas, algoritmos) va en `plan.md`.
> Los nombres de comandos, archivos y rutas que aparecen aquí son parte de la **interfaz pública** del producto. No son decisiones internas.

---

## 1. Contexto y objetivo

Los agentes de IA para programar son rápidos, pero sin un entorno que los guíe improvisan. Crean archivos donde quieren, instalan librerías sin preguntar, hacen commits, entran en bucles intentando arreglar errores y toman decisiones de arquitectura en silencio. Las reglas escritas en markdown ayudan, pero el modelo puede ignorarlas.

**sdd-harness** es una herramienta de línea de comandos, open source, que cualquier persona instala una vez y activa por proyecto. Al activarla, prepara el proyecto para trabajar con Spec-Driven Development (SDD) usando agentes de IA con cuatro garantías:

1. **Flujo SDD completo:** constitución → spec → clarificación → plan → tareas → implementación (una tarea cada vez, tests primero) → validación → cambio.
2. **Roles especializados** (frontend, backend, QA, revisión, depuración, documentación) coordinados por un orquestador.
3. **Guardarraíles deterministas:** lo innegociable se aplica con scripts y permisos, no solo con instrucciones.
4. **El humano decide:** commits, dependencias, cambios de stack, arquitectura o base de datos, y la validación de cada implementación.

Funciona con varias herramientas de agentes (Claude Code, opencode, Codex y Antigravity), en varios sistemas operativos (Windows, macOS y Linux) y con varias topologías de proyecto (repo único, monorepo, varios repos y workspace).

## 2. Usuarios y actores

| Actor | Descripción |
|---|---|
| **Desarrollador** | Instala la CLI, activa el harness en sus proyectos y dirige el flujo SDD. Aprueba o rechaza en cada gate |
| **Compañero de equipo sin harness** | Trabaja en el mismo repo sin usar el harness. No debe verse afectado |
| **Agente de IA** | Herramienta de agentes que ejecuta el flujo según la configuración generada |
| **Contribuidor** | Persona que mejora el harness: adaptadores, skills del registro, conectores de tracker |

## 3. Glosario

| Término | Definición |
|---|---|
| **Proyecto activado** | Proyecto donde se ejecutó `harness init` con éxito y existe `harness.config.yaml` |
| **Herramienta** | Herramienta de agentes soportada: `claude-code`, `opencode`, `codex`, `antigravity` |
| **Adaptador** | Parte del sistema que traduce la configuración neutral al formato de una herramienta |
| **Componente** | Parte del proyecto con stack propio: frontend (`web`), backend (`api`), base de datos (`db`) u otros |
| **Topología** | `single` (repo único), `monorepo`, `multi-repo` o `workspace` (carpeta no versionada que contiene varios repos) |
| **Rol** | Especialización de un agente: `spec-reviewer`, `architect`, `frontend-dev`, `backend-dev`, `qa-tester`, `reviewer`, `debugger`, `doc-writer` |
| **Orquestador** | Lógica que dirige el flujo SDD desde la sesión principal del agente |
| **Gate** | Punto donde el sistema se detiene y espera una decisión explícita del desarrollador |
| **Zona protegida** | Conjunto de rutas o secciones cuya modificación exige aprobación: dependencias, base de datos, contratos, arquitectura, seguridad y la propia configuración del harness |
| **Arreglo en alcance** | Intento de corregir un fallo que solo modifica archivos del alcance de la tarea actual y ninguna zona protegida |
| **Artefactos** | Specs, contratos, ADRs y docs del proyecto. Son contenido del desarrollador, no archivos generados |
| **Archivo generado** | Archivo creado por el harness y registrado en `.harness/manifest.lock` |
| **Bloque gestionado** | Sección delimitada por `<!-- harness:begin -->` y `<!-- harness:end -->` dentro de un archivo que no es del harness |
| **Modo local** | Instalación donde nada generado se versiona y no se modifica ningún archivo ya versionado |
| **Modo team** | Instalación donde la configuración generada se versiona para todo el equipo |
| **Skill curada** | Skill de terceros presente en el registro del harness, con origen, SHA de commit, hash y licencia |
| **Nivel de enforcement** | Grado en que una herramienta puede bloquear acciones de forma determinista: `fuerte`, `medio-fuerte`, `medio` o `débil` |
| **Modo degradado** | Ejecución de los roles de forma secuencial en un mismo agente, cuando la herramienta no ofrece subagentes equivalentes |
| **Contrato** | Especificación de la interfaz entre componentes (por ejemplo, OpenAPI), cuyo dueño es el componente proveedor |
| **Snapshot de contrato** | Copia del contrato del proveedor guardada en el repo consumidor, junto con metadatos de origen |

## 4. Historias de usuario

- **H1:** Como desarrollador quiero instalar la CLI una sola vez para activarla solo en los proyectos que elija.
- **H2:** Como desarrollador quiero una entrevista guiada al activar el harness, para adaptarlo a las herramientas, la topología, el stack y las convenciones de cada proyecto.
- **H3:** Como desarrollador quiero que se respeten las convenciones que mi proyecto ya declara, para no tener que reescribirlas.
- **H4:** Como desarrollador quiero que ningún agente haga commits, instale dependencias ni cambie stack, arquitectura o base de datos sin mi aprobación, para mantener el control.
- **H5:** Como desarrollador quiero probar personalmente cada implementación antes de avanzar, para validar que funciona como espero.
- **H6:** Como desarrollador quiero que, ante un error fuera de alcance o repetido, el agente se detenga y me dé el diagnóstico con opciones, para no gastar tiempo ni tokens en bucles.
- **H7:** Como desarrollador quiero que frontend y backend los implementen agentes distintos con skills de su especialidad, para obtener código de mejor calidad y bien separado.
- **H8:** Como desarrollador quiero que los agentes solo creen documentos en ubicaciones permitidas, para mantener el repo ordenado.
- **H9:** Como desarrollador que trabaja con varios repos quiero que cada repo guarde sus specs y contratos con referencias cruzadas, para commitear cada repo por separado.
- **H10:** Como desarrollador quiero sincronizar mis tareas con un tracker en ambos sentidos, sin que el tracker pueda alterar la spec.
- **H11:** Como compañero de equipo sin harness quiero que el repo no cambie para mí cuando otra persona usa el harness en modo local.
- **H12:** Como desarrollador quiero desinstalar el harness de un proyecto sin perder mis specs ni mis docs.
- **H13:** Como desarrollador quiero saber qué protecciones se aplican de verdad en cada herramienta, para no tener una falsa sensación de seguridad.
- **H14:** Como desarrollador quiero ver el costo y el tiempo por spec y por tarea, para controlar el gasto.
- **H15:** Como contribuidor quiero añadir adaptadores, skills curadas y conectores de tracker siguiendo reglas claras.

---

## 5. Requisitos funcionales

Notación EARS: **CUANDO** (evento), **SI … ENTONCES** (no deseado), **MIENTRAS** (estado), **DONDE** (opcional) y **EL SISTEMA** (ubicuo). Los identificadores siguen el formato `RF-<ÁREA>-<nn>`.

### 5.1 Instalación y distribución (INS)

- **RF-INS-01:** CUANDO el usuario ejecute `npm install -g github:<owner>/<repo>`, EL SISTEMA quedará instalado con el comando `harness` disponible en la terminal.
- **RF-INS-02:** EL SISTEMA no escribirá en los directorios de configuración globales de ninguna herramienta de agentes (`~/.claude`, `~/.codex`, `~/.config/opencode`, `~/.gemini` y equivalentes).
- **RF-INS-03:** EL SISTEMA podrá usar un único directorio de caché propio en el perfil del usuario, que se podrá borrar sin afectar a ningún proyecto.
- **RF-INS-04:** CUANDO el usuario ejecute `harness --version`, EL SISTEMA mostrará la versión instalada.
- **RF-INS-05:** CUANDO el usuario ejecute `harness --help` o `harness <comando> --help`, EL SISTEMA mostrará la ayuda en el idioma configurado para la CLI.
- **RF-INS-06:** SI la versión de Node.js es inferior a la mínima soportada, ENTONCES EL SISTEMA terminará con código 1 indicando la versión requerida.
- **RF-INS-07:** MIENTRAS un proyecto no esté activado, EL SISTEMA no creará ni modificará ningún archivo en él, salvo cuando se ejecute `harness init`.

### 5.2 Activación del proyecto (INI)

- **RF-INI-01:** CUANDO el usuario ejecute `harness init` en un directorio, EL SISTEMA iniciará una entrevista interactiva para configurar ese proyecto.
- **RF-INI-02:** EL SISTEMA detectará la topología (repo git, monorepo o carpeta con varios repos git hijos) y la propondrá para que el usuario la confirme o la corrija.
- **RF-INI-03:** EL SISTEMA detectará los componentes y su stack a partir de los manifiestos existentes (por ejemplo `package.json`, `pyproject.toml`, `go.mod`, `composer.json`, `*.csproj`) y los propondrá para confirmación.
- **RF-INI-04:** EL SISTEMA preguntará qué herramientas de agentes se usarán y generará configuración solo para esas herramientas.
- **RF-INI-05:** EL SISTEMA preguntará el prefijo de ID de specs para cada repo (por ejemplo `API`, `WEB`) y propondrá uno derivado del nombre del componente.
- **RF-INI-06:** EL SISTEMA preguntará la fuente de diseño (`none`, `tokens-in-code`, `penpot`, `figma`) cuando exista un componente de frontend.
- **RF-INI-07:** EL SISTEMA preguntará si se activa un tracker y cuál (`linear`, `notion`, `github`, `jira`), con la opción "ninguno" como valor por defecto.
- **RF-INI-08:** EL SISTEMA preguntará la granularidad del gate de prueba manual (`task`, `story`, `spec`), con `task` como valor por defecto.
- **RF-INI-09:** EL SISTEMA preguntará el modo de instalación (`local` o `team`), con `local` como valor por defecto.
- **RF-INI-10:** EL SISTEMA preguntará si los artefactos (specs, contratos, ADRs, docs) se versionan o se mantienen locales.
- **RF-INI-11:** EL SISTEMA detectará los comandos de verificación de cada componente (lint, typecheck, tests, e2e) a partir de los scripts del proyecto y los propondrá para confirmación.
- **RF-INI-12:** EL SISTEMA propondrá una lista de zonas protegidas según el stack detectado y permitirá editarla antes de confirmar.
- **RF-INI-13:** CUANDO el usuario confirme la entrevista, EL SISTEMA mostrará un resumen de todos los archivos a crear o modificar y pedirá una confirmación final antes de escribir nada.
- **RF-INI-14:** CUANDO se confirme la instalación, EL SISTEMA creará `harness.config.yaml` con todas las respuestas.
- **RF-INI-15:** CUANDO se ejecute `harness init --config <archivo> --yes`, EL SISTEMA se configurará sin entrevista usando ese archivo.
- **RF-INI-16:** SI el proyecto ya está activado, ENTONCES EL SISTEMA no reinstalará e indicará que se usen `harness sync` o `harness upgrade`.
- **RF-INI-17:** SI el usuario cancela la entrevista en cualquier punto, ENTONCES EL SISTEMA terminará sin haber escrito ningún archivo.
- **RF-INI-18:** SI la escritura falla a mitad de la instalación, ENTONCES EL SISTEMA revertirá los archivos creados o modificados en esa ejecución y dejará el proyecto como estaba.

### 5.3 Convenciones e idioma (CNV)

- **RF-CNV-01:** EL SISTEMA leerá las convenciones que el proyecto ya declara en `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `CONTRIBUTING.md`, `.editorconfig` y la configuración de linters y formateadores.
- **RF-CNV-02:** EL SISTEMA mostrará las convenciones detectadas (idioma del código, specs, docs, commits e interfaz; estilo; convención de commits) y pedirá confirmación antes de usarlas.
- **RF-CNV-03:** SI no se detecta una convención de idioma, ENTONCES EL SISTEMA preguntará por separado el idioma de código, specs, docs, commits e interfaz.
- **RF-CNV-04:** EL SISTEMA generará las plantillas (constitución, spec, plan, tareas, progreso, ADR) en el idioma configurado para specs y docs, en español o inglés.
- **RF-CNV-05:** EL SISTEMA aplicará este orden de precedencia en las instrucciones generadas: constitución, convenciones del proyecto, skills del harness y skills de terceros.
- **RF-CNV-06:** DONDE el proyecto declare una convención de commits propia, EL SISTEMA la usará en las propuestas de mensajes de commit en lugar de Conventional Commits.

### 5.4 Generación y sincronización (GEN)

- **RF-GEN-01:** EL SISTEMA generará un `AGENTS.md` como fuente de contexto común para todas las herramientas activadas.
- **RF-GEN-02:** DONDE esté activada `claude-code`, EL SISTEMA hará que `CLAUDE.md` importe `AGENTS.md`.
- **RF-GEN-03:** EL SISTEMA generará un `AGENTS.md` por componente, con las convenciones de su stack.
- **RF-GEN-04:** EL SISTEMA generará solo los roles que el proyecto necesita. Si no hay un componente de backend, no generará `backend-dev`.
- **RF-GEN-05:** EL SISTEMA colocará las skills en `.agents/skills/` como ubicación canónica.
- **RF-GEN-06:** DONDE una herramienta activada requiera las skills en otra ruta, EL SISTEMA las copiará allí (sin symlinks) y registrará su hash.
- **RF-GEN-07:** EL SISTEMA marcará cada archivo generado que admita comentarios con una cabecera que indique que lo generó el harness y que no debe editarse a mano.
- **RF-GEN-08:** EL SISTEMA registrará cada archivo generado en `.harness/manifest.lock`, con su ruta, su hash y el componente del sistema que lo generó.
- **RF-GEN-09:** CUANDO el usuario ejecute `harness sync`, EL SISTEMA regenerará la configuración a partir de `harness.config.yaml` y mostrará el diff antes de aplicarlo.
- **RF-GEN-10:** CUANDO se ejecute `harness sync --dry-run`, EL SISTEMA mostrará el diff sin escribir ningún archivo.
- **RF-GEN-11:** SI un archivo generado fue modificado manualmente, ENTONCES EL SISTEMA no lo sobrescribirá sin preguntar y ofrecerá tres opciones: conservar, sobrescribir o ver el diff.
- **RF-GEN-12:** SI `harness.config.yaml` no cumple el esquema, ENTONCES EL SISTEMA terminará con código 1 indicando cada campo inválido y su ubicación.
- **RF-GEN-13:** EL SISTEMA producirá la misma salida al ejecutar `harness sync` dos veces seguidas sin cambios en la configuración.
- **RF-GEN-14:** EL SISTEMA mantendrá el `AGENTS.md` raíz por debajo del límite de caracteres más restrictivo de las herramientas activadas y moverá el detalle a skills o docs.

### 5.5 Coexistencia con archivos existentes (MRG)

- **RF-MRG-01:** SI ya existe un archivo markdown de contexto (`AGENTS.md`, `CLAUDE.md` u otro), ENTONCES EL SISTEMA insertará su contenido en un bloque gestionado sin alterar el resto del archivo.
- **RF-MRG-02:** SI ya existe un archivo de configuración JSON o TOML de una herramienta, ENTONCES EL SISTEMA fusionará solo sus propias claves y conservará las demás.
- **RF-MRG-03:** SI un archivo JSON, TOML o YAML existente no se puede analizar, ENTONCES EL SISTEMA no lo modificará e informará del error y de la ruta.
- **RF-MRG-04:** SI una clave que el harness necesita ya existe con otro valor, ENTONCES EL SISTEMA mostrará el conflicto y preguntará qué valor conservar.
- **RF-MRG-05:** EL SISTEMA registrará en `.harness/manifest.lock` cada bloque gestionado y cada clave fusionada, para poder revertirlos.

### 5.6 Modos de instalación (MOD)

- **RF-MOD-01:** MIENTRAS el modo sea `local`, EL SISTEMA excluirá los archivos generados de git mediante `.git/info/exclude` y no modificará `.gitignore`.
- **RF-MOD-02:** MIENTRAS el modo sea `local`, EL SISTEMA no modificará ningún archivo ya versionado en git.
- **RF-MOD-03:** MIENTRAS el modo sea `local`, EL SISTEMA usará los archivos de configuración locales de cada herramienta cuando existan (por ejemplo `CLAUDE.local.md` o `settings.local.json`).
- **RF-MOD-04:** SI en modo `local` una herramienta solo puede configurarse modificando un archivo versionado, ENTONCES EL SISTEMA no la configurará, lo explicará y sugerirá el modo `team` para esa herramienta.
- **RF-MOD-05:** MIENTRAS el modo sea `team`, EL SISTEMA dejará los archivos generados como candidatos a versionar y usará bloques gestionados en los archivos existentes.
- **RF-MOD-06:** CUANDO el usuario cambie el modo en la configuración y ejecute `harness sync`, EL SISTEMA migrará los archivos al nuevo modo mostrando el diff.

### 5.7 Desinstalación (REM)

- **RF-REM-01:** CUANDO el usuario ejecute `harness remove`, EL SISTEMA mostrará la lista de cambios a revertir y pedirá confirmación.
- **RF-REM-02:** EL SISTEMA eliminará los archivos generados cuyo hash coincida con el de `.harness/manifest.lock`.
- **RF-REM-03:** SI un archivo generado fue modificado, ENTONCES EL SISTEMA preguntará si eliminarlo o conservarlo.
- **RF-REM-04:** EL SISTEMA eliminará los bloques gestionados y revertirá las claves fusionadas, conservando el resto del contenido de esos archivos.
- **RF-REM-05:** EL SISTEMA no eliminará ni modificará artefactos: `specs/` y `docs/`.
- **RF-REM-06:** EL SISTEMA eliminará sus entradas de `.git/info/exclude`.
- **RF-REM-07:** EL SISTEMA restaurará el valor anterior de `core.hooksPath`, o lo eliminará si lo había establecido el propio harness.
- **RF-REM-08:** SI `.harness/manifest.lock` no existe o está corrupto, ENTONCES EL SISTEMA no borrará nada automáticamente y listará los archivos candidatos para que el usuario decida.

### 5.8 Actualización (UPG)

- **RF-UPG-01:** EL SISTEMA registrará en `harness.config.yaml` la versión del harness con la que se activó el proyecto.
- **RF-UPG-02:** SI la versión de la CLI instalada difiere de la versión del proyecto, ENTONCES EL SISTEMA lo avisará sin actualizar nada automáticamente.
- **RF-UPG-03:** CUANDO el usuario ejecute `harness upgrade`, EL SISTEMA mostrará las novedades entre ambas versiones y el diff de archivos, y pedirá confirmación antes de aplicarlos.
- **RF-UPG-04:** SI una versión nueva cambia el esquema de configuración, ENTONCES EL SISTEMA migrará `harness.config.yaml` y mostrará el diff de la migración.

### 5.9 Diagnóstico (DOC)

- **RF-DOC-01:** CUANDO el usuario ejecute `harness doctor`, EL SISTEMA verificará la validez de la configuración, la integridad de los archivos generados, la de `skills.lock`, la configuración de git hooks y la vigencia de los snapshots de contratos.
- **RF-DOC-02:** EL SISTEMA mostrará, por cada herramienta activada, el nivel de enforcement real y qué reglas se aplican de forma determinista y cuáles solo por instrucción.
- **RF-DOC-03:** EL SISTEMA mostrará la sintaxis de invocación de los comandos del flujo en cada herramienta activada.
- **RF-DOC-04:** SI se detecta un problema, ENTONCES EL SISTEMA indicará su causa y la acción para corregirlo.
- **RF-DOC-05:** EL SISTEMA terminará con código 0 cuando no haya errores y con código 1 cuando haya al menos uno. Las advertencias no cambian el código de salida.
- **RF-DOC-06:** CUANDO se ejecute `harness doctor --json`, EL SISTEMA emitirá el resultado en JSON.

### 5.10 Flujo SDD (SDD)

- **RF-SDD-01:** CUANDO el usuario invoque `/sdd:constitution`, EL SISTEMA propondrá entre 6 y 10 principios cortos y verificables en `docs/constitution.md` y esperará aprobación.
- **RF-SDD-02:** EL SISTEMA incluirá siempre en la constitución estos principios: "el agente nunca hace commit", "toda decisión de stack o arquitectura requiere un ADR aprobado" y "ninguna tarea termina con la verificación en rojo".
- **RF-SDD-03:** CUANDO el usuario invoque `/sdd:spec`, EL SISTEMA entrevistará al usuario con preguntas de una en una (máximo 6) y generará `specs/<PREFIJO>-<NNN>-<nombre>/spec.md`.
- **RF-SDD-04:** EL SISTEMA asignará a cada spec nueva el siguiente número libre con tres dígitos dentro del prefijo del repo.
- **RF-SDD-05:** EL SISTEMA redactará los requisitos de la spec en notación EARS, numerados y verificables.
- **RF-SDD-06:** EL SISTEMA marcará cada hueco de información como `[NECESITA ACLARACIÓN: <pregunta>]` en lugar de inventar una respuesta.
- **RF-SDD-07:** EL SISTEMA no incluirá en la spec decisiones de stack, archivos, esquemas ni algoritmos.
- **RF-SDD-08:** CUANDO el usuario invoque `/sdd:clarify`, EL SISTEMA listará ambigüedades, contradicciones, casos límite ausentes y conflictos con la constitución, sin resolverlos.
- **RF-SDD-09:** CUANDO el usuario invoque `/sdd:plan`, EL SISTEMA generará `plan.md` con módulos, modelo de datos, decisiones justificadas (con la alternativa descartada) y estrategia de tests, indicando qué requisitos cubre cada parte.
- **RF-SDD-10:** DONDE la spec afecte a más de un componente, EL SISTEMA generará el contrato entre componentes en `contracts/` dentro de la spec del proveedor.
- **RF-SDD-11:** CUANDO el plan contenga una decisión de stack o de arquitectura, EL SISTEMA propondrá un ADR en `docs/decisions/ADR-<NNNN>-<nombre>.md` y esperará aprobación.
- **RF-SDD-12:** CUANDO el usuario invoque `/sdd:tasks`, EL SISTEMA generará `tasks.md` con tareas ordenadas por dependencia. Cada una incluirá los requisitos que cubre, el componente, el alcance de archivos y una línea "Hecho cuando:" verificable.
- **RF-SDD-13:** EL SISTEMA no pasará de una fase a la siguiente sin la aprobación explícita del usuario.
- **RF-SDD-14:** CUANDO el usuario invoque `/sdd:validate`, EL SISTEMA recorrerá la spec requisito por requisito, indicará qué test cubre cada uno y su resultado, y dará un veredicto final.
- **RF-SDD-15:** SI un requisito no tiene test asociado, ENTONCES EL SISTEMA lo marcará como no cubierto en la validación.
- **RF-SDD-16:** CUANDO el usuario invoque `/sdd:change` con un requisito nuevo, EL SISTEMA actualizará primero la spec, mostrará el diff y no tocará código hasta tener aprobación.
- **RF-SDD-17:** CUANDO el usuario invoque `/sdd:status`, EL SISTEMA mostrará la spec activa, la tarea actual, los bloqueos, las decisiones pendientes y el costo acumulado.
- **RF-SDD-18:** EL SISTEMA no modificará una spec aprobada salvo a través de `/sdd:change`.

### 5.11 Orquestación y roles (ORQ)

- **RF-ORQ-01:** CUANDO el usuario invoque `/sdd:next`, EL SISTEMA seleccionará la primera tarea pendiente cuyas dependencias estén completadas.
- **RF-ORQ-02:** EL SISTEMA ejecutará una sola tarea por invocación de `/sdd:next`.
- **RF-ORQ-03:** EL SISTEMA delegará la implementación al rol que corresponde al componente de la tarea.
- **RF-ORQ-04:** EL SISTEMA hará que el rol implementador escriba los tests de la tarea antes que el código.
- **RF-ORQ-05:** CUANDO la implementación termine, EL SISTEMA ejecutará los comandos de verificación del componente.
- **RF-ORQ-06:** CUANDO la verificación pase, EL SISTEMA delegará al rol `reviewer`, que revisará primero el cumplimiento de la spec y después la calidad y la seguridad.
- **RF-ORQ-07:** SI el revisor encuentra incumplimientos, ENTONCES EL SISTEMA los mostrará al usuario y esperará su decisión antes de corregir.
- **RF-ORQ-08:** EL SISTEMA registrará en `progress.md` la tarea actual, su estado, sus bloqueos y las decisiones tomadas.
- **RF-ORQ-09:** CUANDO se abra una sesión nueva en un proyecto con una spec en curso, EL SISTEMA retomará el trabajo a partir de `progress.md` y del estado en `.harness/state/`.
- **RF-ORQ-10:** EL SISTEMA asignará a cada rol un nivel de modelo (`high`, `mid`, `low`) configurable, que cada adaptador traducirá a un modelo concreto de su herramienta.
- **RF-ORQ-11:** DONDE la herramienta no ofrezca subagentes equivalentes, EL SISTEMA ejecutará los roles en modo degradado sin omitir ningún gate.
- **RF-ORQ-12:** SI dos sesiones intentan ejecutar tareas en el mismo proyecto a la vez, ENTONCES EL SISTEMA bloqueará la segunda e indicará qué sesión tiene la tarea en curso.

### 5.12 Gates humanos (GAT)

- **RF-GAT-01:** SI un agente intenta ejecutar un comando que crea commits o modifica el historial o el remoto (`git commit`, `push`, `reset --hard`, `rebase`, `merge`, `cherry-pick`, `revert`, `tag`, `stash drop`, `branch -D`), ENTONCES EL SISTEMA lo bloqueará e informará al agente de que el commit es tarea del usuario.
- **RF-GAT-02:** EL SISTEMA detectará los comandos bloqueados aunque estén encadenados (`&&`, `;`, `|`), envueltos en otra shell (`bash -c`, `cmd /c`, `powershell -Command`) o invocados mediante alias de git.
- **RF-GAT-03:** CUANDO el usuario invoque `/sdd:commit`, EL SISTEMA propondrá un mensaje de commit por cada repo con cambios, referenciando las specs y tareas, sin ejecutar el commit.
- **RF-GAT-04:** EL SISTEMA no incluirá en una misma propuesta de commit cambios de repos distintos.
- **RF-GAT-05:** SI un agente intenta ejecutar un comando de instalación de dependencias de cualquier gestor de paquetes soportado, ENTONCES EL SISTEMA pedirá aprobación al usuario antes de ejecutarlo.
- **RF-GAT-06:** SI un agente intenta modificar la sección de dependencias de un manifiesto o un lockfile, ENTONCES EL SISTEMA pedirá aprobación al usuario.
- **RF-GAT-07:** SI un agente intenta modificar una zona protegida, ENTONCES EL SISTEMA detendrá la acción y presentará qué quiere cambiar, por qué, las alternativas y un borrador de ADR.
- **RF-GAT-08:** CUANDO el usuario apruebe un cambio en zona protegida, EL SISTEMA registrará el ADR aprobado y permitirá solo el cambio aprobado.
- **RF-GAT-09:** EL SISTEMA tratará `harness.config.yaml`, `.harness/` y los archivos generados como zona protegida frente a los agentes.
- **RF-GAT-10:** CUANDO una tarea supere verificación y revisión, EL SISTEMA presentará instrucciones de prueba manual: cómo arrancar la app, la URL o el comando, los pasos, los datos de prueba y el resultado esperado por requisito.
- **RF-GAT-11:** MIENTRAS esté pendiente la prueba manual de una tarea, EL SISTEMA no la marcará como hecha ni iniciará otra.
- **RF-GAT-12:** CUANDO el usuario responda OK a la prueba manual, EL SISTEMA marcará la tarea como hecha en `tasks.md` y actualizará `progress.md`.
- **RF-GAT-13:** CUANDO el usuario responda KO con una descripción, EL SISTEMA iniciará el triage (RF-RET-04) sin modificar código.
- **RF-GAT-14:** DONDE la granularidad del gate manual sea `story` o `spec`, EL SISTEMA agrupará la prueba manual al completar todas las tareas de esa historia o de esa spec.

### 5.13 Reintentos y triage (RET)

- **RF-RET-01:** SI la verificación de una tarea falla y el arreglo necesario es en alcance, ENTONCES EL SISTEMA permitirá hasta 2 intentos automáticos de corrección por tarea.
- **RF-RET-02:** SI el arreglo necesario requiere modificar archivos fuera del alcance de la tarea o una zona protegida, ENTONCES EL SISTEMA no hará ningún intento automático e iniciará el triage.
- **RF-RET-03:** SI se agotan los intentos automáticos o el mismo error se repite en dos intentos consecutivos, ENTONCES EL SISTEMA detendrá la corrección e iniciará el triage.
- **RF-RET-04:** CUANDO se inicie el triage, EL SISTEMA delegará al rol `debugger`, que entregará un informe con: error, pasos de reproducción, hipótesis de causa ordenadas por probabilidad, entre 2 y 3 opciones con ventajas e inconvenientes, y una recomendación.
- **RF-RET-05:** EL SISTEMA no modificará código durante el triage.
- **RF-RET-06:** CUANDO el usuario elija una opción del informe, EL SISTEMA aplicará solo esa opción y reiniciará el contador de intentos de la tarea.
- **RF-RET-07:** EL SISTEMA aplicará el contador de intentos mediante un script determinista, independiente de las instrucciones al modelo, en las herramientas que lo permitan.

### 5.14 Orden de archivos y documentos (MD)

- **RF-MD-01:** SI un agente intenta crear un archivo de documentación (`.md` o `.mdx`) fuera de la lista blanca configurada, ENTONCES EL SISTEMA bloqueará la escritura e indicará las ubicaciones permitidas.
- **RF-MD-02:** EL SISTEMA incluirá en la lista blanca por defecto: `README.md`, `CHANGELOG.md`, `AGENTS.md`, los archivos de spec con nombre fijo (`spec`, `plan`, `tasks`, `progress`), `docs/constitution.md`, `docs/decisions/ADR-*.md`, `docs/architecture/*.md` y `docs/lessons.md`.
- **RF-MD-03:** DONDE el usuario pida explícitamente un documento fuera de la lista blanca, EL SISTEMA solicitará confirmación y lo añadirá a la lista blanca del proyecto.
- **RF-MD-04:** EL SISTEMA hará que el rol `doc-writer` modifique solo documentos de la lista blanca.

### 5.15 Dominio de rutas por rol (DOM)

- **RF-DOM-01:** EL SISTEMA asignará a cada rol implementador las rutas donde puede escribir, según los componentes configurados.
- **RF-DOM-02:** EL SISTEMA configurará los roles `spec-reviewer`, `reviewer` y `debugger` como solo lectura sobre el código.
- **RF-DOM-03:** CUANDO un rol termine su trabajo, EL SISTEMA comprobará con el diff de git que no modificó archivos fuera de sus rutas.
- **RF-DOM-04:** SI un rol modificó archivos fuera de sus rutas, ENTONCES EL SISTEMA detendrá el flujo, listará esos archivos y preguntará al usuario si conservarlos o descartarlos, sin revertir nada automáticamente.

### 5.16 Verificación (VER)

- **RF-VER-01:** SI un agente intenta dar por terminada una tarea con la verificación fallando, ENTONCES EL SISTEMA bloqueará el cierre e indicará qué comando falla.
- **RF-VER-02:** SI un componente no tiene comandos de verificación configurados, ENTONCES EL SISTEMA pedirá al usuario que los defina antes de ejecutar su primera tarea.
- **RF-VER-03:** DONDE el usuario lo acepte en `init`, EL SISTEMA configurará los git hooks del proyecto mediante `core.hooksPath` sin añadir dependencias al proyecto.
- **RF-VER-04:** EL SISTEMA ejecutará en pre-commit la lista blanca de documentos, la detección de secretos y los comandos de verificación rápidos de los componentes con cambios.
- **RF-VER-05:** SI el proyecto ya tiene `core.hooksPath` configurado o usa un gestor de git hooks, ENTONCES EL SISTEMA no lo reemplazará y ofrecerá encadenar sus checks o saltar este paso.
- **RF-VER-06:** DONDE el usuario lo solicite, EL SISTEMA generará una plantilla de CI que ejecute los mismos checks que los git hooks, además de la suite completa.

### 5.17 Topologías y contratos (TOP)

- **RF-TOP-01:** MIENTRAS la topología sea `single` o `monorepo`, EL SISTEMA ubicará las specs en `specs/` en la raíz.
- **RF-TOP-02:** MIENTRAS la topología sea `multi-repo` o `workspace`, EL SISTEMA ubicará las specs de cada repo dentro de ese repo.
- **RF-TOP-03:** MIENTRAS la topología sea `workspace`, EL SISTEMA guardará la lista de repos en `harness.workspace.yaml` en la raíz y lo mantendrá fuera de cualquier repo.
- **RF-TOP-04:** EL SISTEMA permitirá declarar dependencias entre specs mediante IDs estables (`depends_on: api#API-004`).
- **RF-TOP-05:** SI una spec depende de otra inexistente, ENTONCES EL SISTEMA lo advertirá en `doctor` y en `/sdd:status`.
- **RF-TOP-06:** EL SISTEMA guardará en el repo consumidor un snapshot del contrato del proveedor, con metadatos de repo, spec, commit y hash de origen.
- **RF-TOP-07:** CUANDO el usuario ejecute `harness contracts sync`, EL SISTEMA actualizará los snapshots desde sus proveedores mostrando el diff y pidiendo confirmación.
- **RF-TOP-08:** SI el hash del contrato del proveedor difiere del snapshot, ENTONCES EL SISTEMA marcará el snapshot como desactualizado en `doctor`.
- **RF-TOP-09:** SI el repo proveedor no está disponible localmente, ENTONCES EL SISTEMA mantendrá el snapshot actual e informará de que no pudo verificarlo.
- **RF-TOP-10:** CUANDO se detecte que un contrato cambió, EL SISTEMA tratará la adaptación del consumidor como un cambio que requiere aprobación.
- **RF-TOP-11:** EL SISTEMA etiquetará cada tarea con su componente, y cada propuesta de commit incluirá solo los cambios de un repo.

### 5.18 Skills (SKL)

- **RF-SKL-01:** EL SISTEMA incluirá sus propias skills: `sdd-orchestrator`, `spec-generator`, `clean-code`, `design-system`, `backend-architecture`, `api-design`, `secure-coding`, `db-migrations`, `testing-strategy`, `triage-report`, `adr` y `docs-writer`.
- **RF-SKL-02:** EL SISTEMA mantendrá un registro de skills curadas de terceros. Cada entrada tendrá repo de origen, ruta, SHA de commit, hash del contenido, licencia y condiciones de instalación.
- **RF-SKL-03:** CUANDO se active o sincronice un proyecto, EL SISTEMA determinará qué skills curadas requiere según sus componentes y su stack.
- **RF-SKL-04:** SI una skill requerida no está instalada en el proyecto, ENTONCES EL SISTEMA la listará con su origen y licencia y pedirá confirmación antes de instalarla.
- **RF-SKL-05:** EL SISTEMA instalará las skills de terceros solo desde el registro curado, descargándolas del SHA fijado y verificando su hash.
- **RF-SKL-06:** SI el hash descargado no coincide con el registrado, ENTONCES EL SISTEMA abortará esa instalación e informará del problema.
- **RF-SKL-07:** EL SISTEMA no ejecutará ningún script incluido en una skill durante su instalación.
- **RF-SKL-08:** SI una skill de terceros contiene scripts o hooks, ENTONCES EL SISTEMA lo indicará al usuario antes de instalarla.
- **RF-SKL-09:** EL SISTEMA registrará las skills instaladas en `.harness/skills.lock`.
- **RF-SKL-10:** CUANDO el usuario ejecute `harness skills verify`, EL SISTEMA comprobará que el contenido instalado coincide con `skills.lock`.
- **RF-SKL-11:** CUANDO el usuario ejecute `harness skills update`, EL SISTEMA mostrará el diff entre la versión instalada y la del registro, y pedirá confirmación.
- **RF-SKL-12:** EL SISTEMA asignará a cada rol solo las skills pertinentes a su función y al stack detectado.
- **RF-SKL-13:** DONDE `design.source` sea `penpot` o `figma`, EL SISTEMA configurará el servidor MCP correspondiente en las herramientas activadas, con aprobación del usuario.
- **RF-SKL-14:** EL SISTEMA conservará los avisos de licencia y atribución de las skills adaptadas de terceros.
- **RF-SKL-15:** SI la licencia de una skill no está en la lista de licencias permitidas del registro, ENTONCES EL SISTEMA no la instalará.

### 5.19 Tracker (TRK)

- **RF-TRK-01:** DONDE haya un tracker activado, EL SISTEMA vinculará cada tarea de `tasks.md` con su elemento en el tracker mediante un comentario invisible (`<!-- linear:ABC-123 -->` o equivalente).
- **RF-TRK-02:** CUANDO el usuario ejecute `harness tracker connect`, EL SISTEMA verificará la conexión usando un token leído de una variable de entorno.
- **RF-TRK-03:** EL SISTEMA no guardará tokens del tracker en ningún archivo del proyecto.
- **RF-TRK-04:** CUANDO el usuario ejecute `harness tracker sync`, EL SISTEMA sincronizará en ambos sentidos solo el estado, el título y la creación de tareas.
- **RF-TRK-05:** EL SISTEMA no modificará la spec a partir de datos del tracker.
- **RF-TRK-06:** CUANDO el tracker tenga una tarea nueva de la spec activa, EL SISTEMA la presentará como propuesta y no la añadirá a `tasks.md` sin aprobación.
- **RF-TRK-07:** SI una tarea cambió en ambos lados desde la última sincronización, ENTONCES EL SISTEMA mostrará ambas versiones y preguntará cuál conservar.
- **RF-TRK-08:** EL SISTEMA pedirá confirmación antes de crear o modificar elementos en el tracker.
- **RF-TRK-09:** CUANDO se ejecute `harness tracker sync --dry-run`, EL SISTEMA mostrará los cambios en ambos sentidos sin aplicarlos.
- **RF-TRK-10:** SI el tracker no responde o el token es inválido, ENTONCES EL SISTEMA informará del error sin modificar `tasks.md`.

### 5.20 Observabilidad (OBS)

- **RF-OBS-01:** EL SISTEMA registrará en `.harness/logs/events.jsonl` cada evento del flujo: fase, tarea, rol, resultado, intentos, gate y duración.
- **RF-OBS-02:** EL SISTEMA no registrará secretos, tokens ni el contenido de archivos `.env`.
- **RF-OBS-03:** DONDE la herramienta exponga datos de costo o tokens, EL SISTEMA los asociará a la tarea y a la spec en curso.
- **RF-OBS-04:** SI la herramienta no expone datos de costo, ENTONCES EL SISTEMA mostrará "no disponible" en lugar de estimarlos.
- **RF-OBS-05:** EL SISTEMA mantendrá `.harness/state/` y `.harness/logs/` fuera del control de versiones en todos los modos.

### 5.21 Adaptadores (ADP)

- **RF-ADP-01:** EL SISTEMA generará, para cada herramienta activada, los roles, los comandos del flujo, los permisos y los hooks en el formato nativo de esa herramienta.
- **RF-ADP-02:** EL SISTEMA conectará los mismos scripts guardianes al mecanismo de bloqueo de cada herramienta que lo soporte.
- **RF-ADP-03:** DONDE una herramienta no soporte el bloqueo determinista de una regla, EL SISTEMA aplicará esa regla por instrucción y la informará como tal en `doctor`.
- **RF-ADP-04:** DONDE esté activada `antigravity`, EL SISTEMA indicará en `doctor` qué comandos deben estar fuera de su allowlist de terminal para conservar los gates.
- **RF-ADP-05:** EL SISTEMA permitirá configurar el modelo concreto de cada nivel (`high`, `mid`, `low`) por herramienta en `harness.config.yaml`.
- **RF-ADP-06:** EL SISTEMA definirá una interfaz documentada de adaptador que permita añadir herramientas nuevas sin modificar el núcleo.

---

## 6. Requisitos no funcionales

| ID | Requisito |
|---|---|
| RNF-01 | **Plataformas.** Todos los comandos funcionan en Windows 10+, macOS y Linux sin bash, WSL ni symlinks |
| RNF-02 | **Runtime.** Requiere solo Node.js en versión LTS vigente y Git. Versión mínima: ver dudas abiertas |
| RNF-03 | **Cero dependencias en el proyecto.** Activar el harness no añade dependencias a los manifiestos del proyecto |
| RNF-04 | **Rutas.** Soporta rutas con espacios, caracteres no ASCII (por ejemplo, usuarios con tildes) y rutas largas en Windows |
| RNF-05 | **Saltos de línea.** Los archivos generados usan LF, y la lectura tolera CRLF |
| RNF-06 | **Idempotencia.** `init --config`, `sync` y `remove` producen el mismo resultado si se repiten |
| RNF-07 | **Atomicidad.** Ningún comando deja el proyecto a medio escribir si falla o se interrumpe |
| RNF-08 | **Rendimiento.** `doctor` y `sync --dry-run` responden en menos de 5 s en un repo de 10 000 archivos. Cada guardián responde en menos de 300 ms por acción |
| RNF-09 | **Red.** El sistema solo accede a la red para descargar skills del registro y sincronizar el tracker, y siempre informa antes de hacerlo |
| RNF-10 | **Sin red.** Todos los comandos, salvo instalar skills y sincronizar el tracker, funcionan sin conexión |
| RNF-11 | **Seguridad.** Los secretos no se escriben en logs, estado ni archivos generados |
| RNF-12 | **Idioma de la CLI.** Mensajes en español e inglés, seleccionables |
| RNF-13 | **Accesibilidad de la terminal.** Respeta `NO_COLOR`, no depende solo del color para transmitir información y ofrece salida `--json` en `doctor` y `status` |
| RNF-14 | **Uso en CI.** Los comandos aceptan un modo no interactivo con opciones explícitas y códigos de salida documentados |
| RNF-15 | **Calidad.** Cada requisito funcional tiene al menos un test automatizado. Los guardianes tienen tests de evasión (RF-GAT-02) |
| RNF-16 | **CI del harness.** La suite completa pasa en Windows, macOS y Linux |
| RNF-17 | **Licencia.** Apache-2.0, con un archivo NOTICE para las obras de terceros adaptadas |
| RNF-18 | **Documentación.** README y guías en inglés y español, además de una guía para escribir adaptadores y otra para proponer skills al registro |

## 7. Casos límite

1. **Directorio sin git.** `init` solo lo acepta con topología `workspace` (con repos hijos). En otro caso, informa y termina.
2. **Repo sin commits.** Se permite activar el harness. Las comparaciones con diff usan el árbol de trabajo.
3. **Raíz del workspace que también es un repo git.** Se pregunta si tratarla como monorepo o como workspace.
4. **Submódulos o repos anidados en un monorepo.** Se detectan y se pregunta si cada uno es un componente o se ignora.
5. **Dos componentes con la misma ruta o rutas solapadas.** `init` y `sync` lo rechazan como error de configuración.
6. **`AGENTS.md` existente que ya supera el límite de caracteres de alguna herramienta.** Se advierte y se propone mover contenido, sin recortarlo automáticamente.
7. **Bloque gestionado dañado a mano** (falta el marcador de fin). `sync` y `remove` no lo tocan y piden corrección manual.
8. **`manifest.lock` borrado o corrupto.** Se aplica RF-REM-08. `sync` ofrece reconstruirlo comparando con la salida esperada.
9. **Proyecto con husky, lefthook u otro `core.hooksPath`.** Se aplica RF-VER-05.
10. **Evasión del bloqueo de commits** mediante alias (`git ci`), variables, `bash -c`, `cmd /c`, PowerShell, scripts intermedios o `npx`. Los guardianes deben bloquearla y tener tests para cada caso.
11. **Commits del usuario desde un IDE o GUI.** No se bloquean; solo pasan por el pre-commit si está configurado.
12. **Un agente intenta editar `.harness/`, `harness.config.yaml` o los guardianes.** Se bloquea como zona protegida (RF-GAT-09).
13. **Borrado de `.harness/state/` a mitad de una spec.** El orquestador reconstruye el estado desde `tasks.md` y `progress.md` y avisa.
14. **Tarea sin alcance de archivos definido.** No se puede ejecutar con `/sdd:next` hasta completar su alcance.
15. **Error intermitente** (un test que a veces falla). Cuenta como fallo, y el informe de triage lo identifica como posible inestabilidad.
16. **Descarga de skill sin red.** Se informa, y el resto de la instalación continúa sin esa skill, marcada como pendiente en `doctor`.
17. **Skill eliminada o SHA inexistente en el repo de origen.** Se informa como no disponible y no se busca otra versión automáticamente.
18. **Licencia de skill desconocida o no permitida.** No se instala (RF-SKL-15).
19. **Token del tracker ausente o expirado.** Se aplica RF-TRK-10.
20. **Tarea borrada en el tracker pero existente en `tasks.md`.** Se presenta como conflicto y nunca se borra automáticamente.
21. **Repo proveedor de contrato no clonado localmente.** Se aplica RF-TOP-09.
22. **Gestor de paquetes no reconocido.** Las zonas protegidas de dependencias se configuran manualmente en `init`.
23. **Herramienta activada que no está instalada en el equipo.** `doctor` lo advierte, pero se generan sus archivos igualmente.
24. **Cambio de `install_mode` con archivos modificados a mano.** Se aplica RF-GEN-11 a cada uno.
25. **Proyecto activado con una versión del harness más nueva que la CLI instalada.** Se advierte y se sugiere actualizar la CLI, sin degradar la configuración.
26. **Ejecución concurrente de `sync` y de una sesión de agente.** `sync` espera a que se libere el bloqueo de sesión o se cancela a petición del usuario.

## 8. Fuera de alcance (v1.0)

- Interfaz gráfica, extensión de IDE o servicio web.
- Publicación en el registro público de npm; la distribución de v1.0 es desde GitHub.
- Herramientas distintas de Claude Code, opencode, Codex y Antigravity (por ejemplo, Cursor, Copilot o Gemini CLI). Quedan cubiertas por la interfaz de adaptadores (RF-ADP-06) para versiones futuras.
- Cambiar de herramienta a mitad de una spec, con garantía de traspaso.
- Resolución automática de conflictos con el tracker.
- Sincronizar desde el tracker contenido de la spec, comentarios, asignaciones o estimaciones.
- Crear diseños en Penpot o Figma. En v1.0 solo se configura el acceso para leer tokens y componentes.
- Ejecutar commits, merges o pull requests, incluso con aprobación.
- Instalar skills que no estén en el registro curado.
- Estimar costos cuando la herramienta no los expone.
- Traducción automática de artefactos existentes entre idiomas.

## 9. Criterios de finalización

1. Todos los requisitos `RF-*` tienen al menos un test automatizado en verde.
2. La matriz de CI (Windows, macOS, Linux) está en verde.
3. Existen fixtures de proyecto y pasan `init`, `sync`, `doctor` y `remove` en cada uno: solo frontend, monorepo fullstack, workspace con dos repos, varios repos y proyecto con configuración previa de agentes y git hooks.
4. Demo manual del flujo completo (`/sdd:constitution` hasta `/sdd:commit`) con Claude Code en el fixture de workspace, incluyendo un fallo en alcance, un fallo en zona protegida con su triage y una prueba manual con KO.
5. `harness doctor` muestra el nivel de enforcement correcto en las cuatro herramientas.
6. `harness remove` deja cada fixture idéntico a su estado previo a `init`, salvo los artefactos.
7. README (en inglés y español), guía de adaptadores, guía de contribución al registro y NOTICE publicados.
8. Recorrido de validación RF por RF documentado, con veredicto "spec cumplida".

## 10. Orden de entrega

Los hitos originales (v0.1–v1.0) se unificaron en un **MVP** centrado en Claude Code, con mensajes en español. Lo que no entra en el MVP queda como pendiente. `tasks.md` sigue este orden.

| Entrega | Contenido (grupos de RF) | Estado |
|---|---|---|
| **MVP (v0.4)** | INS, INI, CNV, GEN, MRG (JSON), MOD, REM, UPG, DOC, SDD, ORQ (salvo ORQ-11), GAT, RET, MD, DOM, VER, ADP para Claude Code, OBS-01/02/04/05, skills propias del flujo (`sdd-orchestrator`, `spec-generator`, `triage-report`, `adr`) | Implementado |
| **v0.5** | TOP (varios repos, workspace, dependencias entre specs, snapshots de contratos), SKL (registro curado, instalador verificado, asignación por rol, MCP de Figma/Penpot), TRK con GitHub Issues | Implementado |
| Pendiente | ADP para opencode, Codex y Antigravity; modo degradado (ORQ-11); RF-ADP-04 completo; RF-MRG-02 para TOML | Pendiente |
| Pendiente | Resto de skills propias de SKL-01 (`clean-code`, `design-system`, `backend-architecture`, `api-design`, `secure-coding`, `db-migrations`, `testing-strategy`, `docs-writer`) y skill `penpot-mcp` (ya no existe en su origen) | Pendiente |
| Pendiente | TRK: Linear, Notion y Jira (GitHub Issues ya está); git hooks por repo en workspace | Pendiente |
| Pendiente | OBS-03: costo y tokens por tarea desde la herramienta | Pendiente |
| Pendiente | RNF-12 (mensajes en inglés para lo añadido en el MVP), RNF-16 (matriz de CI ejecutada), RNF-18 (guías completas) y criterio de finalización 4 (demo con Claude Code real) | Pendiente |

## 11. Dudas abiertas

- [NECESITA ACLARACIÓN: nombre definitivo del proyecto, del paquete y del comando (`sdd-harness` / `harness` son provisionales)]
- [NECESITA ACLARACIÓN: versión mínima de Node.js (propuesta: la LTS activa más antigua a la fecha de v1.0)]
- [NECESITA ACLARACIÓN: primer tracker a implementar en v0.8 (Linear, Notion, GitHub Issues o Jira)]
- [NECESITA ACLARACIÓN: lista de licencias permitidas en el registro de skills (propuesta: MIT, Apache-2.0, BSD-2/3, ISC)]
- [NECESITA ACLARACIÓN: lista inicial de gestores de paquetes soportados en RF-GAT-05 (propuesta: npm, pnpm, yarn, bun, pip, uv, poetry, cargo, go, composer, dotnet, gem)]
- [NECESITA ACLARACIÓN: ¿la plantilla de CI de v1.0 cubre solo GitHub Actions o también GitLab CI?]
- [NECESITA ACLARACIÓN: capacidades actuales de subagentes y hooks en Antigravity y de los hooks de Codex (en beta), a verificar contra la documentación oficial al iniciar v0.5 y v0.6]
