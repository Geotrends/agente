# Feature Specification: SPEC008 — Corrección de hallazgos de la auditoría de seguridad

**Feature Branch**: `develop` (rama vigente; directorio de feature independiente; flujo develop → prod_test → main).

**Created**: 2026-10-13

**Status**: Draft — especificación pendiente de planificación e implementación.

**Input**: User description: "en base a los hallazgos de la security audit, genera un spec enfocado a corregir cualquier vulnerabilidad encontrada."

**Feature Directory**: `specs/008-correccion-hallazgos-auditoria`.

**Fuente y alcance**: Auditoría de seguridad de solo lectura sobre el commit `b5f6cca`, perfil *standard*, ejecutada fuera del repositorio en `~/security-audit-skill/agente/run-1` (REPORT.md, NEEDS-VALIDATION.md, findings.json, coverage-ledger.json). Resultado: 0 hallazgos confirmados y 12 pistas *needs_validation* (NV-01..NV-12), todas trazadas en el código fuente pero sin ejecución, más una lista de endurecimientos. Este spec convierte cada pista en un comportamiento exigible y verificable; **la validación dinámica de cada pista es el primer paso de su corrección**: si una prueba demuestra que la pista no es explotable, se registra y se cierra sin cambio de código.

**Justificación (decisión del usuario, 2026-10-13)**: este trabajo se justifica como **endurecimiento** de seguridad sobre requisitos ya aprobados; no se añaden IDs RF/RNF nuevos ni se modifica el documento C3–C4. Los comportamientos nuevos de apariencia funcional (vigencia absoluta de sesión, estado «requiere atención» con reanudación, aplazamiento de cargas) son mecanismos de defensa de los requisitos citados abajo.

**Trazabilidad (constitución, principio IX)**: no añade comportamiento funcional nuevo. Es corrección de defectos y endurecimiento que sostienen requisitos ya aprobados: RF-C3-AD-20/21/26/27, RF-C3-AD-22..25, RF-C3-AD-28..30, RF-C3-AD-38/39, RNF-C3-IV-02, RNF-C3-IN-04..06, RF-C3-IN-04, RF-C3-DI-06 y RF-C4-DC-02, además de los principios III, IV, V, VI y VII de la constitución. Los IDs concretos de cada historia se confirman en el plan contra el documento C3–C4.

## Clarifications

### Session 2026-10-13

- Sin marcadores abiertos: las decisiones de alcance se tomaron con valores por defecto documentados en *Assumptions*.
- Q: Si el contador del tope diario no está disponible, ¿el chat rechaza, responde sin tope o usa un tope temporal? → A: Sigue con un tope temporal en memoria por proceso, más estricto, y notifica al administrador técnico.
- Q: ¿Qué pasa con una publicación en curso si llega otra versión del mismo documento durante la preparación? → A: Se aplaza: la nueva versión queda pendiente y se registra al terminar la publicación; la operación en curso no cambia.
- Q: Cuando un retiro agota sus reintentos rápidos, ¿quién lo reanuda? → A: El sistema sigue con espera larga indefinida, más botón manual para reanudar de inmediato y notificación al agotar los reintentos rápidos.
- Q: Si el scraper descarta una página por host no permitido, ¿solo se avisa en el informe? → A: Aviso en el informe y notificación al administrador técnico en el panel, agrupando repeticiones.
- Q: ¿Cuál es la vigencia absoluta de una sesión del panel aunque haya actividad? → A: 8 horas (una jornada laboral), además de los 30 minutos de inactividad.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - El gasto del chat público tiene un tope diario efectivo (Priority: P1)

El Municipio necesita que un anónimo no pueda generar gasto ilimitado del proveedor de inferencia. Hoy el tope diario por IP, el tope global y el bloqueo por mensajes largos existen como lógica pero **ningún flujo real los consulta** (NV-01); solo rige el límite por minuto y la cola de admisión.

**Why this priority**: Es el único vector alcanzable sin autenticación y con costo económico directo; contradice principios V y VII.

**Independent Test**: Con límites configurados bajos y un cliente anónimo, enviar consultas hasta superar el tope y verificar rechazo sin invocar al proveedor; repetir con mensajes largos.

**Acceptance Scenarios**:

1. **Given** una IP que alcanzó su tope diario configurado, **When** envía otra consulta, **Then** recibe un rechazo genérico con código y sin que se invoque al LLM ni se registre la interacción.
2. **Given** el tope global diario agotado, **When** cualquier IP envía una consulta, **Then** se rechaza igual y el chat muestra los canales oficiales del registro de contacto.
3. **Given** una IP que envía mensajes que superan el largo permitido de forma repetida, **When** alcanza el umbral configurado, **Then** queda bloqueada por el periodo definido y el bloqueo se registra sin contenido del ciudadano.
4. **Given** el día siguiente en America/Bogotá, **When** se reinician los contadores, **Then** las consultas vuelven a aceptarse sin intervención manual.
5. **Given** un reinicio del servicio, **When** se consulta el contador diario, **Then** el consumo del día no se reinicia.

---

### User Story 2 - Publicar solo la versión que el administrador aprobó (Priority: P1)

El administrador técnico aprueba una versión concreta de un documento. La publicación debe promover exactamente esa versión, completa e indexada, y nunca otra que aparezca durante la preparación (NV-02, NV-03, NV-10).

**Why this priority**: Un contenido no aprobado o sin procesar sería recuperable por los ciudadanos o el documento vigente desaparecería del índice; contradice el principio III.

**Independent Test**: Con un documento publicado y un candidato aprobado, iniciar la publicación y, durante la preparación, subir otra versión manualmente o forzar una detección del scraper; verificar que se publica la aprobada o la operación se rechaza sin tocar lo vigente.

**Acceptance Scenarios**:

1. **Given** una publicación en curso para la versión A, **When** durante la preparación llega la versión B (carga manual o scraper), **Then** se publica A o la operación falla de forma segura; B queda pendiente y nunca se publica sin nueva aprobación.
2. **Given** un candidato aún no procesado (en cola), **When** se confirma una publicación, **Then** no se promueve, la versión vigente permanece publicada e indexada y se notifica al administrador técnico.
3. **Given** un candidato limpiado durante la operación (misma huella que la vigente), **When** termina la operación, **Then** el archivo original y los registros de la versión vigente se conservan.
4. **Given** una carga manual o detección del scraper sobre un elemento con operación activa, **When** se registra, **Then** la operación activa no cambia de objetivo y el cambio entra como nuevo pendiente tras ella.
5. **Given** cualquier resultado de publicación, **When** se consulta el chat, **Then** responde siempre con una versión completa e indexada (RF-C3-AD-26/27).

---

### User Story 3 - Retiro, rechazo y limpieza que no se atascan ni borran lo vigente (Priority: P1)

Las operaciones de retiro, rechazo y limpieza deben terminar o reintentarse, sin dejar contenido retirado recuperable (NV-07), sin bloquear la cola de otras operaciones (NV-08) y sin eliminar la versión publicada (NV-09).

**Why this priority**: Un retiro fallido deja contenido retirado en uso; una operación atascada frena todas las publicaciones; un borrado indebido deja un documento publicado sin versión.

**Independent Test**: Inyectar fallos transitorios del almacén vectorial y de la base durante un retiro; forzar una limpieza que no verifica ausencia; reactivar un derogado con huella igual y rechazarlo.

**Acceptance Scenarios**:

1. **Given** un retiro que falla después de marcar el documento como retirado, **When** el error es transitorio, **Then** la operación se reintenta con espera creciente hasta limpiar vectores, filas y archivos, y el administrador ve su estado.
2. **Given** un retiro que agota sus reintentos rápidos, **When** sigue fallando, **Then** se notifica, queda visible como «requiere atención», continúa reintentándose con espera larga y puede reanudarse de inmediato desde el panel; el contenido no es recuperable por el ciudadano en ningún momento.
3. **Given** una operación en limpieza que no puede verificar ausencia, **When** agota los reintentos rápidos, **Then** queda en espera (con reintento cada hora), se notifica y las demás operaciones continúan.
4. **Given** un derogado reactivado cuyo pendiente es el mismo registro que el publicado, **When** el administrador rechaza o el scraper detecta cambio, **Then** la versión publicada y su archivo no se eliminan; solo se limpia lo que no es la versión vigente.
5. **Given** una operación que falla, **When** se revisa la auditoría, **Then** consta la causa genérica sin rutas ni trazas.

---

### User Story 4 - Cargas y OCR con límites reales de recursos (Priority: P2)

Un administrador autenticado no puede agotar memoria, disco o tiempo del procesador documental con un archivo malicioso o malformado (NV-05, NV-06).

**Why this priority**: Requiere cuenta administrativa, pero un solo archivo puede detener todas las operaciones del Observatorio.

**Independent Test**: Cargar, en un entorno aislado, un DOCX/XLSX que declare tamaños pequeños pero se expanda más allá del límite, y un PDF escaneado con muchas páginas o páginas enormes.

**Acceptance Scenarios**:

1. **Given** un contenedor que declara tamaños falsos, **When** se procesa, **Then** la expansión real se corta al superar el límite configurado y la carga se rechaza con motivo, sin afectar al resto del procesador.
2. **Given** un PDF sin texto nativo, **When** supera el máximo de páginas, de píxeles por página o el plazo total de OCR, **Then** se descarta con motivo y las operaciones documentales continúan sin retraso material.
3. **Given** un documento válido dentro de los límites, **When** se procesa, **Then** el resultado es el mismo que antes.

---

### User Story 5 - El scraper solo ingiere contenido de hosts permitidos (Priority: P2)

El contenido guardado bajo una URL permitida debe provenir de esa página y host (NV-04). Una redirección por meta-refresh, JavaScript o una respuesta distinta no puede introducir contenido ajeno al corpus.

**Why this priority**: Rompe el principio III (lista de hosts permitida) y alimenta al modelo con contenido no validado, aunque pase por pendiente y publicación humana.

**Independent Test**: Con un sitio local de prueba que redirige por JavaScript a otro host o a una dirección interna, ejecutar el scraper y verificar que no se guarda ni reporta esa página.

**Acceptance Scenarios**:

1. **Given** una fuente con renderizado, **When** el navegador termina en un host no permitido o interno, **Then** la página se descarta, queda un aviso en el informe de ejecución y se notifica al administrador técnico agrupando repeticiones.
2. **Given** una solicitud de subrecurso a un host no permitido, **When** se renderiza, **Then** se bloquea.
3. **Given** una fuente legítima, **When** se renderiza, **Then** el contenido guardado es el de la URL validada.

---

### User Story 6 - Privacidad: sin restos de texto ciudadano o personal en disco (Priority: P2)

Los textos extraídos de cargas descartadas y las exportaciones temporales no deben persistir (NV-11, NV-12), conforme al principio IV.

**Why this priority**: Pueden contener datos personales; hoy permanecen indefinidamente en un volumen persistente.

**Independent Test**: Cargar y descartar un formato diligenciado; iniciar una exportación y cortar la conexión del cliente; verificar el disco y la memoria.

**Acceptance Scenarios**:

1. **Given** una carga descartada (formato diligenciado, OCR rechazado o extracción fallida), **When** termina, **Then** su texto extraído no queda en disco ni en memoria del procesador.
2. **Given** el procesador en operación continua, **When** pasa el tiempo, **Then** la memoria de la caché de extracción no crece sin límite.
3. **Given** una exportación cuyo cliente se desconecta durante su preparación, **When** termina o expira, **Then** el archivo temporal se elimina.
4. **Given** archivos de exportación huérfanos de ejecuciones anteriores, **When** corre la limpieza periódica, **Then** se eliminan pasado el plazo definido.

---

### User Story 7 - Endurecimiento del perímetro y de los secretos (Priority: P3)

Reducir el daño si otra defensa falla, sin cambiar funcionalidad visible. Cubre los endurecimientos de la auditoría que no son hallazgos.

**Why this priority**: Sin explotación demostrada, pero reducen el radio de impacto de cualquier compromiso.

**Independent Test**: Inspección de configuración y pruebas automatizadas de cabeceras, límites y arranque.

**Acceptance Scenarios**:

1. **Given** cada servicio del despliegue, **When** se inspecciona su entorno, **Then** recibe solo las variables que necesita; ningún servicio recibe credenciales administrativas de base de datos ni llaves de proveedores deshabilitados.
2. **Given** el `.env` con llaves de Gemini, Groq, DeepSeek u OpenAI con valor, **When** se arranca, **Then** el arranque falla con instrucción clara (ya ocurre con `make up`; debe ocurrir también en el arranque directo) y esas llaves se retiran del archivo vigente y se rotan.
3. **Given** cualquier página estática del panel o del chat, **When** se solicita, **Then** responde con CSP, `frame-ancestors`, `nosniff`, `Referrer-Policy` y `Permissions-Policy` coherentes con el Observatorio.
4. **Given** intentos de acceso desde direcciones IPv6 de un mismo /64, **When** se aplican bloqueos por IP, **Then** cuentan como un solo origen.
5. **Given** una sesión administrativa activa, **When** cumple su vigencia absoluta de 8 horas, **Then** vence aunque tenga actividad, y el cambio de contraseña aplica limitación por intentos.
6. **Given** el secreto de HMAC de IP del panel sin definir en producción, **When** arranca, **Then** falla en lugar de reutilizar otro secreto.
7. **Given** peticiones anónimas a `/api/retrieval/status` y `/ready`, **When** se responden, **Then** no exponen versiones, nombres de modelo, estado de dependencias ni configuración.
8. **Given** texto de fragmentos o del ciudadano con marcadores del prompt, **When** se arma el prompt, **Then** los delimitadores se neutralizan y no alteran la estructura (principio II).
9. **Given** el pipeline de CI, **When** corre, **Then** instala solo con bloqueo de dependencias (sin fallback a instalación libre) y fija acciones por commit.

### Edge Cases

- Dos publicaciones solicitadas a la vez sobre el mismo elemento.
- Reintento de retiro mientras otro proceso retira el mismo documento.
- Reinicio del servicio a mitad de una publicación o de una limpieza.
- Cambio de día (America/Bogotá) mientras hay consultas en curso.
- Cliente que se desconecta justo al terminar la exportación.
- Archivo con expansión legítima grande dentro del tope (debe aceptarse).
- Falla del almacén de contadores del tope diario: se aplica el tope temporal en memoria y se notifica (FR-002a).
- Pista que la prueba demuestra no explotable: se documenta y se cierra sin cambio.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE aplicar un tope diario por IP y uno global a las consultas del chat, y un bloqueo por mensajes largos repetidos, rechazando el exceso antes de invocar al proveedor y sin registrar la interacción (NV-01).
- **FR-002**: Los contadores del tope diario DEBEN sobrevivir al reinicio del servicio y reiniciarse al cambio de día en America/Bogotá.
- **FR-002a**: Si el almacén de contadores no está disponible, el sistema DEBE continuar con un tope temporal en memoria por proceso, más estricto que el configurado, y notificar al administrador técnico; NO DEBE rechazar todo el chat ni quedar sin tope.
- **FR-003**: Cada tope y umbral DEBE ser configurable y estar documentado, con valor por defecto seguro.
- **FR-004**: La publicación DEBE promover únicamente la versión aprobada que originó la operación; si el candidato pendiente cambió, la operación DEBE fallar de forma segura y conservar lo vigente (NV-02).
- **FR-005**: La publicación NO DEBE promover un candidato sin procesar ni eliminar la versión vigente si la nueva generación del índice no contiene el elemento (NV-03).
- **FR-006**: Una carga manual o detección del scraper NO DEBE cambiar el objetivo de una operación activa sobre el mismo elemento; la nueva versión DEBE aplazarse, quedar como pendiente al terminar la operación y requerir nueva aprobación, sin rechazar la carga ni cancelar la operación (NV-02, NV-03, NV-10).
- **FR-007**: La limpieza posterior a la publicación NO DEBE eliminar archivos ni registros de la versión que sigue vigente (NV-10).
- **FR-008**: Una operación de retiro DEBE reintentarse ante fallos transitorios con espera creciente y tope de reintentos rápidos; al agotarlos DEBE notificar al administrador técnico, seguir reintentando con espera larga indefinida y ofrecer un botón para reanudarla de inmediato; NUNCA DEBE quedar en un estado terminal silencioso (NV-07).
- **FR-009**: Una operación atascada en limpieza DEBE reintentarse con la misma agenda de FR-008 (espera creciente y después espera larga indefinida), notificar al agotar los reintentos rápidos y NO DEBE bloquear las demás operaciones de la cola (NV-08).
- **FR-010**: Rechazar o reemplazar un pendiente NO DEBE eliminar la versión publicada cuando ambas son el mismo registro (NV-09).
- **FR-011**: La inspección de contenedores DOCX/XLSX DEBE limitar la expansión real durante la lectura, no solo los tamaños declarados, con tope de memoria y de salida (NV-05).
- **FR-012**: El OCR DEBE tener tope de páginas, de píxeles por página y de tiempo agregado por documento, descartando con motivo al superarlos (NV-06).
- **FR-013**: El scraper con renderizado DEBE validar el host de cada navegación y subrecurso, y el destino final antes de guardar contenido; al descartar una página DEBE dejar aviso en el informe de ejecución y notificar al administrador técnico en el panel, agrupando repeticiones (NV-04).
- **FR-014**: El texto extraído de una carga descartada DEBE eliminarse de disco y memoria, y la caché de extracción DEBE tener tope y expiración (NV-11).
- **FR-015**: Las exportaciones temporales DEBEN eliminarse si el cliente se desconecta y barrerse periódicamente (NV-12).
- **FR-016**: Cada servicio DEBE recibir únicamente las variables de entorno que usa; las credenciales de proveedores deshabilitados NO DEBEN existir en el `.env` de despliegue (principio V) ni llegar a ningún servicio.
- **FR-017**: Todas las páginas servidas DEBEN llevar cabeceras de seguridad coherentes con el principio VII.
- **FR-018**: El panel DEBE normalizar IPv6 a /64 para bloqueos, imponer una vigencia absoluta de sesión de 8 horas (además de los 30 minutos de inactividad), limitar intentos de cambio de contraseña y exigir su propio secreto de HMAC de IP.
- **FR-019**: Los endpoints públicos de estado NO DEBEN exponer configuración, versiones ni nombres de modelo.
- **FR-020**: El armado del prompt DEBE neutralizar delimitadores presentes en fragmentos y texto del ciudadano.
- **FR-021**: La integración continua DEBE instalar dependencias de forma reproducible y fijar acciones de terceros.
- **FR-022**: Todo fallo de las operaciones anteriores DEBE devolver errores genéricos con código, sin rutas, trazas ni nombres de proveedor (principio VI), y toda acción de panel afectada DEBE quedar en la auditoría.
- **FR-023**: Cada corrección DEBE ir acompañada de una prueba automatizada que falle antes del cambio y pase después; las pistas no explotables DEBEN registrarse con su evidencia.

### Key Entities

- **Contador diario de consumo**: consumo por IP y global por día de Bogotá; persistente, sin contenido ciudadano.
- **Operación documental**: publicación, retiro, rechazo o reindexación con versión objetivo, fase, intentos, siguiente intento y estado reanudable.
- **Versión candidata aprobada**: versión concreta que el administrador aprobó; se compara con el pendiente al confirmar.
- **Límites de procesamiento**: topes de expansión, páginas, píxeles y tiempo por documento.
- **Registro de pistas de auditoría**: estado por NV (corregida, no explotable con evidencia, pendiente) con enlace a su prueba.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Con el tope configurado en N consultas, la consulta N+1 de una IP en el día se rechaza el 100 % de las veces sin llegar al proveedor, también tras reiniciar el servicio.
- **SC-002**: En 100 ejecuciones con una carga o detección concurrente durante la publicación, ninguna promueve una versión distinta de la aprobada ni deja al documento vigente sin versión recuperable.
- **SC-003**: Tras un fallo transitorio inducido durante un retiro que se resuelve en menos de 2 minutos, la limpieza termina en menos de 10 minutos sin intervención; el contenido retirado no es recuperable en ningún momento.
- **SC-004**: Una operación atascada no retrasa a las demás más de 1 minuto.
- **SC-005**: Un archivo malicioso de expansión o de OCR se rechaza en menos de 2 minutos sin degradar el procesador ni las demás operaciones.
- **SC-006**: El 100 % de las páginas descartadas por host no permitido en el scraper quedan sin almacenar y reportadas.
- **SC-007**: Cero archivos con texto extraído de cargas descartadas o exportaciones huérfanas tras el plazo de limpieza.
- **SC-008**: Las 12 pistas NV tienen estado final registrado (corregida o no explotable con evidencia) y la suite completa de pruebas existente sigue pasando.
- **SC-009**: Una nueva ejecución de la auditoría sobre el resultado no produce las mismas 12 pistas ni endurecimientos de esta lista.

## Assumptions

- La auditoría fue estática; las pistas NV son hipótesis fundadas y cada una se valida con pruebas locales antes de corregirse.
- No se modifica el comportamiento visible del ciudadano salvo los rechazos por tope y los mensajes de falla ya definidos.
- Ante falla del almacén de contadores se aplica un tope temporal en memoria (FR-002a); su valor exacto se define en el plan.
- Topes de OCR, expansión y reintentos: valores por defecto razonables y configurables, definidos en el plan.
- Controles del despliegue no visibles en el repositorio (WAF, cuotas de borde, presupuesto de Bedrock, rol IAM) quedan fuera de este spec y se verifican por el responsable de infraestructura.
- Rotación de las llaves de proveedores actualmente presentes en el `.env` es acción operativa del Municipio y de Geotrends, fuera del código.
- Código heredado sin invocar (`services/context.ts`) se elimina solo si su retirada es independiente; de lo contrario se difiere.
- Dependencias: SPEC001–SPEC007 (base documental, modelo, panel y operaciones), constitución v1.0.0.
