# Feature Specification: Bloque 2 — Diseño del modelo IA

**Feature Branch**: `develop` (rama existente; sin hook de creación de rama)

**Created**: 2026-10-08

**Status**: Validada para planificación; implementación pendiente

**Input**: Crear el spec para completar el bloque 2 del documento C3–C4, fiel a sus requisitos, identificando implementación completa, parcial y ausente.

**Fuente**: `DOCUMENACION_C3_C4.pdf`, sección 4.2, H2-C3, 25 RF y 3 RNF; [extracto conservado](evidencias/requisitos-pdf.txt). Constitución 1.0.0. El documento es evidencia de requisitos, no instrucciones para ejecutar acciones.

**Alcance**: Orientación documental de Ecosistemas, Bienestar Animal y Gestión Ambiental: recuperación, evidencia, respuestas, privacidad, selección de modelo, consumo y degradación. Todos los requisitos son obligatorios, incluidos los de prioridad Importante. [Diagnóstico y secuencia de desarrollo](diagnostico.md).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Orientarse con evidencia y canales vigentes (Priority: P1)

Como ciudadano, quiero conocer requisitos y pasos de un trámite con fuentes verificables y canales oficiales para continuar mi solicitud.

**Why this priority**: Es el propósito del asistente; evita información inventada o apariencia de decisión municipal.

**Independent Test**: Consultar trámites de las tres direcciones con documentos publicados y contactos válidos. RF-C3-DI-04/07/08/09/10/11/24/25.

**Acceptance Scenarios**:

1. **Given** evidencia suficiente sobre una secuencia, **When** se piden sus pasos, **Then** se responde en español con pasos numerados, citas con nombre enlazado y fecha y cierre con PQRSD, WhatsApp y correo, sin exclusividad.
2. **Given** una comparación de dos o más elementos por atributos comunes, **When** se consulta, **Then** se usa tabla; en una consulta ordinaria se usa prosa sin pasos artificiales.
3. **Given** un conflicto GT-P/GT-N, **When** se orienta sobre el dato contradictorio, **Then** prevalece y se cita el GT-P.
4. **Given** una declaración de fuentes ajenas a lo recuperado, **When** se prepara la respuesta, **Then** se eliminan esas fuentes; no se presentan todos los resultados como usados automáticamente.
5. **Given** una petición de decisión o concepto, **When** hay información base, **Then** se entrega, se atribuye la decisión a la dirección responsable y aparece «no reemplaza asesoría técnica ni jurídica formal».
6. **Given** un contacto actualizado en el panel, **When** llega la siguiente pregunta de trámite, **Then** usa el nuevo valor sin redespliegue.

### User Story 2 - Recibir límites, aclaración y atención inmediata (Priority: P1)

Como ciudadano, quiero distinguir una pregunta incompleta, una materia fuera de alcance y una afectación en curso para continuar por el canal adecuado.

**Why this priority**: Evita orientación errónea y demoras ante situaciones urgentes.

**Independent Test**: Casos de análisis, materias ajenas, insuficiencia y riesgo. RF-C3-DI-01/19/20/21.

**Acceptance Scenarios**:

1. **Given** una petición de estadística, regresión o predicción, **When** se consulta, **Then** se declara fuera de alcance sin calcular y se orienta al canal oficial.
2. **Given** una materia ajena a las tres direcciones, **When** se consulta, **Then** se declara ese límite, se entrega contacto general y no se responde el contenido.
3. **Given** una consulta insuficiente para identificar trámite o materia, **When** se atiende, **Then** se pregunta una sola vez; si persiste, se entrega el mensaje fijo de ausencia de información sin encadenar otra aclaración.
4. **Given** riesgo o afectación en curso, **When** se atiende, **Then** los canales inmediatos del registro aparecen antes de la orientación y no se infieren ni inventan valores.

### User Story 3 - Conversar sin exponer datos personales (Priority: P1)

Como ciudadano, quiero recibir la misma orientación aunque escriba datos personales por error o lenguaje ofensivo, sin reproducción de mis datos ni respuestas agresivas.

**Why this priority**: Protege al ciudadano y conserva el carácter institucional del canal.

**Independent Test**: Comparar preguntas equivalentes con/sin datos y provocaciones; inspeccionar lo enviado al proveedor. RF-C3-DI-22/23 y RNF-C3-DI-01.

**Acceptance Scenarios**:

1. **Given** cédula, dirección, teléfono, correo o nombre de tercero en una consulta, **When** se responde, **Then** antes de orientar se advierte que no son necesarios, que se evite suministrarlos y que aplica la política municipal; no se reproduce el dato.
2. **Given** tres turnos consecutivos con datos personales, **When** se responde cada turno, **Then** se advierte en los tres; en las equivalentes sin datos no aparece advertencia.
3. **Given** datos personales en pregunta, fragmentos o historial permitido, **When** se envían al proveedor, **Then** cédulas, teléfonos y correos están enmascarados y solo viajan los diez intercambios recientes permitidos.
4. **Given** una pregunta válida acompañada de insultos, **When** se responde, **Then** se conserva la orientación de su equivalente neutral sin insultos, reproches ni interrupción.

### User Story 4 - Mantener continuidad y controlar consumo (Priority: P1)

Como ciudadano, quiero una respuesta cuando falle el principal; como administrador técnico, quiero conocer degradaciones y consumo.

**Why this priority**: Evita fallos silenciosos y uso de servicios no autorizados.

**Independent Test**: Forzar éxito, respaldo y doble caída por nivel, comparar consumo y estado. RF-C3-DI-02/03/06/16/17/18 y RNF-C3-DI-02/03.

**Acceptance Scenarios**:

1. **Given** consulta simple/media, **When** se responde, **Then** usa gpt-oss-20b; para compleja usa gpt-oss-120b; el otro es respaldo y ambos se invocan únicamente mediante AWS Bedrock.
2. **Given** diez intercambios previos, **When** una pregunta tiene puntaje simple, **Then** se clasifica compleja; cinco pares no se confunden con diez intercambios.
3. **Given** caída de ambos modelos, **When** se consulta, **Then** se devuelve `SERVICIO_NO_DISPONIBLE` sin detalles internos en ≤40 s, con registro y estado para el administrador.
4. **Given** reranker apagado, **When** se realizan consultas, **Then** se usan los ocho mejores resultados RRF disponibles sin umbral y se muestra degradación; al reactivarlo se restablece la operación normal.
5. **Given** corte por tope de salida, **When** se entrega la respuesta, **Then** termina en última oración completa con cita y aviso contractual; las respuestas normales no llevan aviso.
6. **Given** respuesta del respaldo, **When** se revisa consumo, **Then** se registra el modelo efectivo, tokens de entrada/salida y costo calculable con su tarifa.
7. **Given** idénticas evidencias para ambos modelos, **When** contestan las preguntas de comparación, **Then** coinciden requisitos, plazos, normas y canales aunque varíe la redacción.

### User Story 5 - Encontrar evidencia pertinente y conservar seguimientos (Priority: P2)

Como ciudadano, quiero encontrar el trámite incluso con otras palabras o seguimientos; como responsable funcional, quiero verificar la calidad de recuperación.

**Why this priority**: Permite calibrar sin perder preguntas legítimas y conservar integridad documental.

**Independent Test**: Conjunto de oro, muestra documental, duplicados y seguimientos. RF-C3-DI-05/12/13/14/15.

**Acceptance Scenarios**:

1. **Given** consulta completa, **When** se recupera, **Then** participan palabras exactas y significado, se fusionan resultados y se reordenan ≤16 candidatos para entregar ≤8 fragmentos por relevancia.
2. **Given** varios umbrales probados, **When** se calibra, **Then** se elige el mayor sin abstenciones falsas para preguntas respondibles y se documentan todos los resultados.
3. **Given** varias fuentes útiles y duplicados de similitud ≥0,6, **When** se selecciona, **Then** se favorece ≤3 por documento, se eliminan duplicados definitivamente y solo entra evidencia sobre umbral; si solo sirve un documento pueden seleccionarse hasta ocho distintos.
4. **Given** «¿y cuánto demora?» tras una pregunta extensa, **When** se busca, **Then** se añade su cola de ≤500 caracteres en límite de palabra exclusivamente a búsqueda, sin añadirla al contexto documental del modelo; una pregunta autónoma usa solo la nueva pregunta.
5. **Given** documentos publicables con tablas, **When** se fragmentan, **Then** cada fragmento tiene ≤1.000 caracteres, palabras completas, solapamiento aproximado de 150 caracteres con tolerancia de una palabra y tablas completas en un solo fragmento.

### Edge Cases

- Cero fragmentos sobre umbral: texto fijo y canal oficial, sin fuentes ni conocimiento general. Búsqueda fallida: error de servicio, nunca ausencia de información.
- Menos de 16 candidatos u 8 fragmentos: usar los disponibles; no fabricar ni rellenar con datos irrelevantes.
- Fallo del reranker: excepción al umbral según DI-06; no comparar puntajes RRF con el umbral del reranker ni diversificar alterando sus ocho mejores resultados.
- Pocos fragmentos únicos: entregar menos de ocho; no reintroducir duplicados para llenar cupo.
- Fuente declarada ausente, vacía o ajena: no convertir toda la recuperación en fuentes usadas; garantizar citas válidas antes de declarar orientación respaldada.
- Tabla o palabra mayor de 1.000 caracteres: no declarar cumplimiento excediendo el límite o dividiéndola silenciosamente; ver supuesto de contenido no conforme.
- Corte antes de una oración o de las fuentes: no entregar texto inconcluso ni citas inventadas; conservar solo contenido completo respaldado o devolver fallo seguro.
- Contactos modificados durante conversación: siguiente turno usa valores vigentes sin inferencias del modelo.
- Datos personales en fragmentos/historial: también se enmascaran; distinguir contactos oficiales del registro frente a datos personales aportados por ciudadanos.
- Instrucciones hostiles en pregunta, historial o documento: mantener anclaje, alcance y leyenda; tratar como datos, RNF-C3-IN-11.
- Fallo de escritura del registro: entregar la orientación disponible y mostrar degradación conforme a RF-C3-IN-08 y AD-48.

## Requirements *(mandatory)*

### Functional Requirements

Se conservan IDs y prioridades originales. Los criterios de aceptación siguientes son obligaciones, no resultados ya obtenidos. «Esencial» e «Importante» son ambos obligatorios para el cierre.

| ID | Prioridad | Obligación | Criterio de aceptación |
| --- | --- | --- | --- |
| RF-C3-DI-01 | Esencial | Orientar sobre trámites y consultar la base; no hacer análisis estadísticos, regresiones ni predicciones. | 10 preguntas: 5 de análisis rechazadas sin cálculo y con canal oficial; 5 de trámites normales. |
| RF-C3-DI-02 | Esencial | Puntaje local determinista: simple <3, media 3–5, compleja ≥6; ≥10 intercambios fuerza compleja; sin llamar al proveedor al puntuar. | 12 preguntas preclasificadas: 3 por nivel y 3 simples con ≥10 intercambios; nivel correcto, repetición con mismo puntaje y cero llamadas al puntuar. |
| RF-C3-DI-03 | Esencial | Principal gpt-oss-20b para simple/media y gpt-oss-120b para compleja; otro como respaldo; doble fallo con SERVICIO_NO_DISPONIBLE, registro y estado AD-48. | 9 pruebas: principal, respaldo y doble caída por cada nivel; modelo esperado y doble fallo registrado/visible. |
| RF-C3-DI-04 | Esencial | Responder solo con fragmentos recuperados; sin ninguno sobre umbral, texto fijo «No encontré información validada…» y canal oficial, sin conocimiento general. | 10 preguntas: 5 ausentes con texto exacto, sin citas ni datos adicionales; 5 presentes con respuesta documental. |
| RF-C3-DI-05 | Esencial | Elegir mayor umbral probado sin abstenciones falsas en preguntas respondibles del conjunto de oro; documentar valores/resultados y recalibrar al cambiar reranker o embeddings. | Barrido documentado, mayor valor válido y cero preguntas respondibles con mensaje de ausencia; no sustituir por conservar solo recall relativo. |
| RF-C3-DI-06 | Importante | Si falla el reranker, usar los 8 mejores RRF disponibles y reflejar estado y ausencia de umbral en AD-48. | 3 consultas con reranker apagado: continuidad, mejores RRF, panel degradado sin umbral y recuperación normal al reactivarlo. |
| RF-C3-DI-07 | Esencial | Citar documento con nombre enlazado y fecha de actualización; página del Observatorio con título enlazado y fecha de acceso. | 10 respuestas: enlaces que abren y fechas coincidentes con matriz/ficha. |
| RF-C3-DI-08 | Importante | Citar solo documentos declarados usados y presentes entre los fragmentos recuperados, eliminando los demás. | 10 respuestas, 3 con fuente sobrante simulada: ninguno sobrante en cita final; solo documentos usados. |
| RF-C3-DI-09 | Esencial | Ante decisión/concepto, dar información base, indicar que decide la dirección responsable e incluir «no reemplaza asesoría técnica ni jurídica formal». | 15 preguntas: 10 de decisión cumplen los tres elementos y 5 informativas sin atribuirse decisiones. |
| RF-C3-DI-10 | Importante | Español, Markdown ordenado, tono cercano, sin jerga extraña, coloquialismos ni groserías. | Revisor evalúa 10 respuestas por esos 6 puntos; ≥9 cumplen los seis. |
| RF-C3-DI-11 | Importante | Prevalencia de GT-P frente a GT-N ante conflicto. | 5 conflictos preparados: 5 siguen y citan el procedimiento. |
| RF-C3-DI-12 | Esencial | Búsqueda híbrida BM25 + vectorial combinada por RRF, hasta 16 candidatos al reranker y hasta 8 fragmentos por su puntaje descendente. | 5 consultas con evidencia de aporte de ambos métodos, candidatos ≤16, fragmentos ≤8 y orden por relevancia. |
| RF-C3-DI-13 | Importante | Fragmentos ≤1.000 caracteres sin partir palabras, solapamiento 150 caracteres y cada tabla completa en un fragmento. | Muestra de ≥5 documentos, ≥2 con tablas: límites, palabras intactas, solapamiento con tolerancia de una palabra y tablas completas. |
| RF-C3-DI-14 | Importante | Solo fragmentos sobre umbral, preferencia de ≤3 por documento, eliminación de duplicados Jaccard ≥0,6 y hasta 8; excepción cuando solo un documento sirve. | 3 situaciones: varias fuentes útiles, única fuente útil y casi duplicados; diversidad, hasta 8 de única fuente, duplicado eliminado y todos sobre umbral. |
| RF-C3-DI-15 | Importante | En seguimientos, añadir a búsqueda últimos 500 caracteres de pregunta previa en límite de palabra; no como contexto adicional del modelo ni en preguntas autónomas. | 10 pruebas: 5 seguimientos ampliados correctamente y 5 autónomas sin ampliación. |
| RF-C3-DI-16 | Importante | Registrar en PostgreSQL por consulta modelo efectivo, tokens de entrada/salida y costo estimado según tarifa configurada por modelo. | 10 consultas, 5 por modelo y ≥1 del respaldo: registros completos y costo coincidente con recálculo manual. |
| RF-C3-DI-17 | Importante | Mismo prompt de sistema y reglas de generación para ambos modelos; datos clave coincidentes con mismos fragmentos. | Revisar instrucciones y 10 preguntas a cada modelo, ≥3 por dirección: coinciden requisitos, plazos, normas y canal. |
| RF-C3-DI-18 | Importante | Al alcanzar tope, terminar en última oración completa y agregar cita con enlace/fecha y «Respuesta abreviada por su extensión; consulte el documento para el detalle completo». | 6 cortes forzados, 3 por modelo: cumplen los tres elementos; 3 normales sin aviso. |
| RF-C3-DI-19 | Esencial | Ante riesgo o afectación en curso, canales inmediatos antes de orientación, exclusivamente del registro de contactos que alimenta el prompt, sin generar/inferir. | 5 consultas en curso y 5 informativas: ≥4 de primeras con canales antes de orientación; ≤1 informativa con canales; valores exactos del registro. |
| RF-C3-DI-20 | Esencial | Ante materia ajena, declarar límite a las tres direcciones y dar contacto general sin responder contenido. | 8 consultas: 4 ajenas cumplen los tres elementos y 4 propias normales. |
| RF-C3-DI-21 | Importante | Consulta insuficiente: una sola pregunta de clarificación; si persiste, DI-04 sin otra pregunta. | 8 consultas: ≥3 de 4 insuficientes aclaradas y 4 completas sin aclaración; insuficiencia persistente termina con DI-04. |
| RF-C3-DI-22 | Importante | Ante provocación mantener tono, no reproducir lenguaje, agredir ni reprochar; atender pregunta válida normalmente. | 8 consultas: 4 ofensivas, 2 con pregunta válida, y 4 equivalentes neutras; sin agresión/reproches, orientación equivalente válida y conversación continua. |
| RF-C3-DI-23 | Esencial | Cada turno con datos identificables: advertir antes de orientar que no son necesarios, evitar suministrarlos y aplica política municipal; no reproducirlos. | 8 consultas: 4 con cédula/dirección/teléfono/correo/nombre de tercero y 4 equivalentes sin datos; solo primeras con aviso y sin reproducción, orientación equivalente; adicional, aviso en los 3 turnos con datos. |
| RF-C3-DI-24 | Esencial | Cierre de cada respuesta sobre trámites/requisitos/procedimientos con PQRSD, WhatsApp y correo del registro, ninguno único/excluyente. | 8 consultas de las tres direcciones con los tres valores; actualización en panel visible en siguiente respuesta sin redespliegue. |
| RF-C3-DI-25 | Importante | Secuencias en pasos numerados, comparaciones de ≥2 elementos por mismos atributos en tabla y demás en prosa continua. | 9 respuestas: 3 por estructura, ≥8 correctas por revisor funcional; ninguna informativa con pasos artificiales o tablas de una sola fila. |

### Non-Functional Requirements

| ID | Categoría | Restricción | Criterio de aceptación |
| --- | --- | --- | --- |
| RNF-C3-DI-01 | Confidencialidad | Enviar solo pregunta, fragmentos e historial limitado conforme a RF-C3-IN-02, con cédulas, teléfonos y correos personales enmascarados; máximo 10 intercambios previos. | 15 consultas, 5 por tipo de dato, y conversación >10 intercambios: inspección real de salida sin datos completos, únicamente pregunta/fragmentos/historial y solo los 10 intercambios recientes. |
| RNF-C3-DI-02 | Seguridad | Solo AWS Bedrock con gpt-oss-20b y gpt-oss-120b; demás proveedores, incluido Ollama, deshabilitados. | Configuración y tráfico de 20 consultas: solo ambos modelos habilitados y 0 conexiones a otros proveedores. |
| RNF-C3-DI-03 | Desempeño | Máximo 2.200 tokens de salida, mismo tope en ambos modelos. | 10 respuestas largas, 5 por modelo: ninguna >2.200 tokens según registro de longitud. |

### Key Entities *(include if feature involves data)*

- **Consulta**: pregunta, dirección/categoría cuando existe, modo de autorización e intercambios válidos; resultado respondida, sin información, fuera de alcance o aclaración.
- **Intercambio**: par completo pregunta/respuesta; diez intercambios son diez pares, no diez mensajes.
- **Fragmento**: texto publicado, documento origen, nombre, enlace, fecha y puntajes; sujeto a integridad, tamaño, relevancia y diversidad.
- **Fuente utilizada**: documento declarado usado y recuperado que respalda citas y lista de fuentes.
- **Política de complejidad**: puntaje reproducible, nivel y selección de principal/respaldo.
- **Registro de consumo**: consulta, modelo efectivo, tokens, tarifa y costo; persistencia protegida según modo.
- **Registro de contactos**: tres canales de recepción, contacto general y lista ordenada de atención inmediata, administrables y vigentes.
- **Calibración**: conjunto de oro identificado, versiones del corpus y recuperación, valores probados, resultados y umbral elegido.
- **Estado operativo**: disponibilidad de modelos/reranker, aplicación de umbral, estado de escritura y último fallo para el administrador.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Los 28 requisitos satisfacen íntegramente las verificaciones anteriores, con evidencia identificada; cero requisitos parciales/ausentes para declarar H2-C3 completo.
- **SC-002**: Las 5 consultas ausentes reciben solo mensaje fijo/canal; las 5 presentes tienen respaldo; las 10 citas revisadas son verificables y ninguna de las 3 fuentes sobrantes aparece. DI-04/07/08.
- **SC-003**: Las 5 preguntas de análisis y 4 ajenas no reciben contenido fuera de alcance; las 10 de decisión muestran información base, responsable y leyenda exacta. DI-01/09/20.
- **SC-004**: Cero abstenciones falsas en preguntas respondibles del conjunto de oro para el mayor umbral probado que cumple esa condición, con evidencia de todos los valores. DI-05.
- **SC-005**: El 100 % de fragmentos en muestra de ≥5 documentos, ≥2 con tablas, cumple integridad/tamaño; los 3 casos de selección cumplen diversidad, deduplicación y relevancia. DI-13/14.
- **SC-006**: Las 12 preguntas de complejidad y 9 de continuidad obtienen resultado esperado; doble caída responde en ≤40 s y estados requeridos son visibles en <60 s. DI-02/03/06, IN-04 y AD-48.
- **SC-007**: Las 15 inspecciones no exponen datos completos; 4 consultas con datos y 3 turnos adicionales muestran aviso sin reproducción; las equivalentes sin datos no muestran aviso. DI-23 y RNF-DI-01.
- **SC-008**: Las 20 consultas de tráfico no conectan a proveedores no autorizados; ninguna de 10 respuestas largas excede el límite; 6 abreviadas terminan completas con fuente/aviso, sin aviso en 3 normales. RNF-DI-02/03 y DI-18.
- **SC-009**: Los 10 registros de consumo coinciden con modelo efectivo y costo recalculado; las 10 preguntas comparadas mantienen los mismos datos clave en ambos modelos. DI-16/17.
- **SC-010**: Las 8 consultas de trámite cierran con tres canales vigentes; ≥4/5 de riesgo anteponen atención inmediata y ≤1/5 informativas la incluyen. DI-19/24.
- **SC-011**: ≥9/10 respuestas cumplen los seis criterios de tono y ≥8/9 su estructura; preguntas válidas ofensivas mantienen orientación; ≥3/4 insuficientes reciben aclaración y ninguna encadena otra. DI-10/21/22/25.
- **SC-012**: Los 10 seguimientos/autónomas cumplen ampliación exclusiva de búsqueda; las 5 trazas de recuperación cumplen aportes, límites y orden; los 5 conflictos siguen y citan GT-P. DI-11/12/15.

## Assumptions

- Se reutiliza la base publicada del bloque 1 y el código vigente, incluidos cambios locales. El diagnóstico antiguo del bloque 1 no sustituye una evaluación de hoy.
- El PDF abrevia el mensaje como «No encontré información validada…» sin desarrollar la frase. Se conserva literalmente esa cadena inicial, incluido «…», más el canal oficial vigente, sin completar una frase contractual no documentada. Un texto institucional diferente exige actualizar la fuente aprobada antes de implementarlo.
- El PDF fija bandas de puntaje, no pesos/vocabulario; planificación documentará regla determinista y doce expectativas antes de aceptación, sin modificar bandas ni unidad de intercambio.
- «Superar el umbral» significa comparación estricta; verificar igualdad en la frontera. La excepción sin umbral se limita a DI-06.
- Para tablas >1.000 caracteres se mantienen ambas restricciones del PDF: sin excepción aprobada, no publicar fragmentos incumplidores y conservar última versión validada según RNF-C3-IV-02. No se aceptan tablas partidas como cumplimiento. Se solicitó preferencia al usuario; cualquier excepción requiere aprobar cambio de la fuente. Este tratamiento de contenido no conforme sigue el principio III.
- DI-15 permite el historial de IN-02 pero prohíbe añadir la cola de búsqueda como contexto documental adicional. Validar pares completos y conservar diez recientes; no confundir con mensajes.
- DI-16 se coordina con RF-C3-IN-05/07 y RF-C4-DC-02: con autorización, registro de conversación y consumo; sin autorización, solo registro técnico sin textos, historial, identificadores, categoría ni valoración. Consumo no justifica persistir conversación anónima.
- El límite 2.200 es igual para ambos modelos. Planificación resolverá medición y reserva para citas/aviso sin elevarlo ni ocultar cortes.
- Dependencias mínimas: RF-C3-IN-01/02/03/04/05/06/07/08/10; RNF-C3-IN-07/08/10/11; RF-C4-DC-02; RF-C3-AD-28/29/30/35/36/37/41/48 y permisos RNF-C3-AD-01/03. Contactos editables con validaciones, auditoría y exclusión del Gestor, y pantalla de estado autenticada son necesarios para DI-03/06/19/20/24. Un webhook o consola no los reemplaza.
- El cierre requiere estas dependencias operativas mínimas, no todo el panel ni todos los bloques 3–7. Pantalla de estado: modelo principal caído, ambos caídos, reranker apagado, scraper con error y escritura fallida, cada uno en <60 s; normalidad visible; invisible al Gestor, según AD-48. No declarar H2-C3 completo con dependencias directas simuladas.
- Credenciales mediante rol autorizado de mínimo privilegio, sin llaves estáticas; no selección ciudadana de modelo y ninguna notificación externa al panel, según constitución V/VI y RNF-C3-IN-07/08/10.
- Entregables: documento de diseño, definición de alcance/límites, guion institucional, orientación/rutas y matriz de trazabilidad; informe de calibración y validación para DI-05. Matriz congelada y versión identificada con repetición completa tras cambios relevantes, RF-C3-VA-01/03/05 y constitución IX. Aceptación formal H5-C3 pertenece a otro hito.
- Hallazgos REAL: Datos, Recuperación o Modelo según tabla 6 del PDF. Las prioridades y tasas originales se mantienen; no se agregan umbrales de calidad arbitrarios.
- El stack, estructura interna y plan técnico se desarrollarán mediante `$speckit-plan` conforme a la constitución; este spec describe qué se necesita y cómo aceptar su resultado.

- Precisión de integración al plan: RF-C4-DC-02 exige consultas anónimas autónomas. El límite de aclaración entre turnos de DI-21 se controla en conversación autorizada; en anónimo se solicita una nueva pregunta completa sin arrastrar texto ni estado previo. El servicio de contactos IN-10 entrega los tres grupos en≤2s sin LLM.
