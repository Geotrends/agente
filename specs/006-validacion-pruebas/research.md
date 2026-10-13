# Research — SPEC006 Validación y pruebas

**Fecha**: 2026-10-10. Requisitos: RF-C3-VA-01..06, RF-C4-PR-01..04; RNF-C4-UI-02/RNF-C3-IN-03 heredados. Investigación de código y artefactos existentes con dos agentes de revisión solo lectura, según `speckit-plan`; sin evaluación AWS ni pruebas del producto. Todas las decisiones de diseño quedan resueltas; accesos, revisión humana y firmas son prerrequisitos de ejecución.

## R1 — Formato y congelamiento de matrices

**Decision**: JSON versionado como fuente de verdad de casos, expectativas y aprobaciones; vistas Markdown para revisión. Matriz C3 y matriz C4 independientes, con esquema validado por herramientas offline TypeScript. Recibo de congelamiento separado, vinculado al hash de toda la matriz aprobada y a la identidad de la base. No nuevas tablas de producto ni panel de matrices.

**Rationale**: Las matrices DI/UI actuales son catálogos de criterios, no casos VA/PR completos. JSON permite probar cobertura, fechas, campos, referencias y denominadores antes de consumir recursos; Markdown facilita revisión. La constitución exige PostgreSQL para datos operativos, no para estos entregables offline (VA-01, PR-01).

**Alternatives considered**: Aceptar 28 filas DI o 22 filas UI por conteo (no cumplen cobertura); Excel como fuente editable única (dificulta validación reproducible); sistema de administración nuevo (Bloque 7 fuera de alcance). Una exportación futura no cambia la fuente de verdad.

## R2 — Cobertura sin alterar contratos previos

**Decision**: ≥30 casos ordinarios C3 y ≥9 adicionales de manipulación, ≥39 con seis GT-P. La familia manipulación se separa del tipo público esperado. Un diseño mínimo ordinario viable usa 8 Ecosistemas, 8 Gestión Ambiental y 14 Bienestar Animal: 3 respondidos por cada GT-P (3/3/12), más 12 casos de otros tipos repartidos 5/5/2, con cuatro por cada tipo. La asignación final exige verificación humana y puede crecer. C4 tendrá ≥20 casos por ocho flujos; mínimo propuesto 4 apertura (ambas decisiones en ambos entornos), 6 preguntas frecuentes (tres direcciones × dos entornos) y 2 de cada uno de los otros seis flujos: 22 totales, umbral 20 aprobados.

**Rationale**: Satisface simultáneamente los mínimos de VA-01/06 y PR-01, sin contar una verificación UI como flujo ni convertir un ataque en quinto tipo de respuesta. El ejemplo de 22 casos C4 es una distribución de casos PR, distinta de las 22 verificaciones UI anteriores.

**Alternatives considered**: Distribuir diez ordinarios por dirección (insuficiente para doce respondidos de cuatro GT-P de Bienestar Animal); rellenar expectativas sin documentos; usar consultas fuera de alcance como «sin información» (confunde tipos y debe corregirse en la candidata).

## R3 — Política privada independiente de llamada

**Decision**: Ampliar el puerto interno `ChatDeps` con política opcional de llamada al modelo, cuyo valor por defecto conserva `callWithRouting`. La evaluación independiente suministra una función privada que llama una sola vez al modelo permitido, con deadline/señal y cliente AWS `maxAttempts:1`, sin clasificar, circuitos de routing ni fallback. Reutiliza saneamiento/orquestación/citas/registro de `handleChat`. La corrida integrada usa el cableado normal y HTTP del servicio; los ataques de fragmento se ejecutan en instalación de aceptación aislada equivalente.

**Rationale**: `diAcceptance.forcing()` actual cambia el ID dentro del adaptador, pero `handleChat` sigue llamando al router, que clasifica, consulta circuitos y puede intentar de nuevo. Además asigna `modeloEfectivo=forced` incluso a respuestas sin generación. Esto no demuestra VA-03.

**Alternatives considered**: Cambiar variables globales de modelo (puede afectar producción y conservar fallback); copiar el orquestador al evaluador (divergencia); publicar selector de modelo (prohibido); un adaptador que solo reemplaza ID (brecha actual).

## R4 — Acreditación del modelo y respuestas locales

**Decision**: Registrar intentos observados en el límite del SDK/adaptador: modelo solicitado, ID enviado, éxito/fallo, identificador de petición seguro cuando disponible, uso oficial y resultado. `modeloEfectivo` solo proviene de la llamada realmente completada, nunca de la variable de forzado. Respuestas locales admiten cero invocaciones y `modeloEfectivo:null`, con motivo local; la suite se atribuye al modelo objetivo y exige al menos casos respondidos con llamadas verificadas a ese modelo. Cada respuesta generada independiente tiene exactamente un intento al objetivo; cualquier intento ajeno o segundo intento invalida independencia.

**Rationale**: Las políticas institucionales pueden resolver ausencia/alcance sin generar. Forzar invocación para esos casos alteraría el producto. La API [Converse de AWS](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html) selecciona modelo en la petición y requiere `bedrock:InvokeModel`; la evidencia debe observar esa llamada, no inventar un campo de respuesta.

**Alternatives considered**: Exigir invocación en todas las filas; copiar el modelo objetivo al resultado; registrar cuerpos SDK completos (riesgo de datos/secretos innecesario).

## R5 — Extensión del evaluador DI y separación de veredictos

**Decision**: Extender `eval-di.ts`, `diAcceptance.ts` y `diRunner.ts` con selección explícita de suite `di|va`, lectura real de casos/expectativas VA y ejecución `integrated|independent`. Mantener comportamiento DI existente sin presentar sus criterios como matriz VA. Incorporar módulo de validación/reporte compartido, pruebas y recibos manuales; no sustituir el evaluador ni ejecutar comandos incluidos en una matriz.

**Rationale**: El CLI actual lee del manifiesto solo cantidad y responsable; corre `MATRIX` codificada, permite `--only`, agrega ambos modelos y termina con exit 0 cuando no hay fallos automáticos aunque existan pendientes. Hash de matriz omite expectativas y hash Git omite untracked. Los resultados actuales necesitan corrección para acreditar VA-01..05.

**Alternatives considered**: Runner paralelo que copie DI; usar `--only` para aceptación; considerar exit 0 como firma; hash solo de preguntas. Las ejecuciones parciales siguen siendo ensayos, nunca cierre.

## R6 — Documento de ataque y base aislada

**Decision**: Instancia de aceptación con copia identificada de base oficial publicada, PostgreSQL/Qdrant y alias propios sin consumidores ciudadanos. Documento sintético validado solo allí, hash/IDs identificados en fixture del ataque y registro de instalación/retiro. Normalización/fragmentación/recuperación conservan reglas del sistema. El caso debe acreditar que el fragmento atacado entró al contexto evaluado; se ejecuta limpieza en salida normal/fallo/cancelación y reconciliación al reiniciar tras corte abrupto. Retiro exige ausencia del documento y sus puntos recuperables, no solo borrar archivo.

**Rationale**: VA-06 requiere ataque dentro de fragmento y retiro. Inyectar sin recuperación ni comprobar exposición puede dar falso positivo; publicar un documento de prueba a ciudadanos viola base cerrada. La base oficial nunca se modifica para ataque.

**Alternatives considered**: Usar solo doble de respuesta; modificar prompt; publicar y borrar después en producción; cambiar umbral para recuperar el ataque. Si no se recupera, el caso queda inválido/pendiente de preparación, no aprobado.

## R7 — Flujos C4 con evidencia por caso

**Decision**: Reutilizar suites Playwright y componentes; agregar un ejecutor PR que lee la matriz, relaciona casos con funciones de prueba permitidas y produce resultados JSON/evidencia por caso. Configuración de aceptación independiente con host real, C3 real y sin `stubApi`. Mantener configuración actual local para CI. El reporte UI permanece inventario; el nuevo expediente consume resultados ejecutados. Móvil físico y revisiones manuales se incorporan mediante recibos humanos ligados a caso/run/hash.

**Rationale**: `report-ui.mjs` verifica existencia de archivos, no ejecuta. Playwright actual usa fixture/stub y dispositivos emulados. La [documentación de emulación de Playwright](https://playwright.dev/docs/emulation) describe configuración de viewport, agente y capacidades; esto no acredita por sí solo un dispositivo físico exigido por SPEC004.

**Alternatives considered**: Cambiar silenciosamente la config CI a portal; declarar emulación como Safari iOS real; ejecutar pasos arbitrarios desde JSON. Ninguna matriz contiene shell/JavaScript ejecutable.

## R8 — Accesibilidad y carga compartidas

**Decision**: UI-02 sigue a cargo de SPEC004 (N02/T080): axe en host e iframe/estados, manual firmado, lectores escritorio/móvil, zoom/contraste. IN-03 sigue SPEC005 (N303/T078): runner load corregido y conciliación real 3×25 en dos fechas. 006 importa evidencia con releaseId/digests/hashes y valida criterios completos. No copia loadRunner ni altera cuota. Si el runner actual aún no implementa mezcla autorizada/anónima, no se puede aceptar.

**Rationale**: El load runner revisado cuenta status 200, usa oleadas anónimas y no identifica versión ni concilia filas; SPEC005 ya asigna correcciones T063/T064. [WCAG 2.1, requisitos de conformidad](https://www.w3.org/TR/WCAG21/#conformance-reqs) incluyen páginas completas y procesos completos; el alcance de revisión debe cubrir todo el flujo, no solo la pantalla inicial.

**Alternatives considered**: Nuevo medidor 006 paralelo; importar solo «PASS» o nombre de archivo; reusar accesibilidad de bundle distinto; aprobar por p95 promedio entre oleadas. Ninguna reduce la obligación PR-04.

## R9 — Identidad y vigencia

**Decision**: Manifiesto de release con commit, hash de archivos relevantes incluidos untracked permitidos, lockfiles, digests C3/C4/launcher, prompt/parámetros/modelos, corpus/calibración, contactos/política/tarifas públicos, matrices y entorno. Hash SHA-256 del contenido completo validado de matriz y de cada artefacto. Lista de archivos permitidos excluye secretos, datos de ciudadanos y directorios de ejecución. Registro de eventos de ajuste/invalidez y corridas append-only; no escoger última corrida favorable si hubo después cambio/interrupción.

**Rationale**: Necesario para últimas ejecuciones y coincidencia de versiones VA-02/03/05, PR-02/04. Cambios locales frecuentes y artefactos no versionados hacen insuficiente `git diff HEAD`.

**Alternatives considered**: Hash del directorio completo (secretos/cache/autorreferencia); solo commit (omite cambios); timestamp como versión; combinar resultados verdes de distintas corridas.

## R10 — Hallazgos, revisión y firmas

**Decision**: Registro offline JSON con eventos y vistas Markdown, reutilizando hallazgos DI/UI/IN por ID/referencia; campos y estados VA-04/PR-03, severidad por origen, prioridad máxima si hay varias reglas, causa REAL. Revisión semántica humana ligada al hash del resultado completo, sin sobreescribir respuesta observada; transición Validada/Cerrada enlaza corrida completa posterior. Expedientes C3/C4 separados; recibo de acta identifica archivo firmado, hash, ambas partes y fechas, verificado por persona. El generador solo prepara borradores y comprueba coherencia, no firma ni autentica firmas por detección de un nombre.

**Rationale**: La existencia de un documento no prueba recepción. Responsable/revisor y firma no pueden ser inventados; pendiente humana impide contar un caso aprobado. El 90 % no rebaja requisitos previos.

**Alternatives considered**: Nueva UI de hallazgos (Bloque 7); edición destructiva de resultados; automatizar juicio de citas/tono con otro LLM; firmas simuladas; exigir 100 % global distinto de la fuente.

## R11 — Verificación y comandos

**Decision**: Unitarias de esquemas/cobertura/hash/vigencia/denominadores/hallazgos/reportes; integración de política privada y limpieza con PostgreSQL/Qdrant reales y AWS doble; regresiones DI/UI/IN/KB y gates CI existentes. Nuevos comandos offline `validation:check`, `validation:freeze`, `validation:review`, `validation:report`, `validation:acta` y suite `test:validation` son propuestas de implementación, documentadas como tales. `eval:di --suite=va` y `test:pr:e2e` también requieren ampliación. Ningún comando nuevo se ejecuta al planificar.

**Rationale**: Pruebas significativas deben rechazar falsos positivos encontrados, no limitarse a replicar campos. Entorno AWS/dispositivos y firma se prueban fuera de CI con evidencia.

**Alternatives considered**: Ejecutar carga en CI pública; pruebas vacías con éxito; docs que afirman comandos ya disponibles. No se agrega una dependencia general de validación; validadores TypeScript explícitos y crypto existentes bastan.
