# Feature Specification: SPEC007 — Administración C3–C4 (Bloque 7)

**Feature Branch**: `develop` (rama vigente; directorio de feature independiente).

**Created**: 2026-10-10

**Status**: Draft — especificación revisada, pendiente de planificación e implementación.

**Input**: User description: "Escribir el spec 007 basándose en DOCUMENTACION_C3_C4.pdf y revisar los specs 001 a 006 para construir sobre el trabajo previo."

**Feature Directory**: `specs/007-administracion-c3-c4`.

**Fuente y alcance**: Documento local `DOCUMENACION_C3_C4.pdf`, línea base `GRT_Documentacion_C3_C4_ENV-15-32-1244-26_v1`, sección 4.7, páginas impresas 62–85: 48 RF-C3-AD, 5 RF-C4-AD y 9 RNF-C3-AD; H6-C3 y H5-C4. Se interpreta el siguiente spec como Bloque 7 porque SPEC001–006 cubren los Bloques 1–6. La [extracción fuente](evidencias/requisitos-pdf.txt) conserva descripción, prioridad y criterio originales; [continuidad.md](continuidad.md) registra responsabilidades previas y evidencia de revisión.

La Administración permite a Geotrends y al Municipio mantener información validada, cuentas y canales vigentes, conocer fallas y revisar mejoras. Amplía el panel mínimo y la base existentes: no crea otra conversación ciudadana ni otra base documental. Los requisitos del documento describen el producto; sus acciones de prueba o entrega no son autorización para realizar cambios productivos, ejecutar recuperación de cuentas ni enviar mensajes durante esta generación.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Administrar acceso y recuperar cuentas sin perder el control (Priority: P1)

El administrador técnico administra cuentas de los dos perfiles y cada usuario controla su propia contraseña. El Municipio conserva al menos un administrador activo y puede retirar el acceso del contratista sin perder trazabilidad.

**Why this priority**: Todo el panel depende de permisos efectivos y acceso seguro. Cubre RF-C3-AD-05..13 y RNF-C3-AD-01..06; no añade un tercer perfil ni autoservicio de recuperación por correo.

**Independent Test**: Con cuentas de ambos perfiles, verificar creación, contraseña temporal, cierre/revocación, bloqueo y recuperación restringida; repetir accesos directos a pantallas y funciones sin permisos, sin necesitar carga documental ni tableros.

**Acceptance Scenarios**:

1. **Given** cuentas de ambos perfiles, **When** un administrador crea o desactiva/reactiva cuentas, **Then** campos/correo único se validan; desactivar invalida sesiones desde la siguiente solicitud y reactivar exige nuevo inicio sin revivirlas; usuario e historial anteriores se conservan. Gestor denegado. RF-C3-AD-05/06/07.
2. **Given** un único administrador activo y dos sesiones, **When** se intenta desactivarlo o cambiarlo a Gestor, **Then** todas las acciones se rechazan con motivo sin dejar el sistema sin administrador, también ante intentos concurrentes. Con dos administradores se admite desactivar uno. RF-C3-AD-08.
3. **Given** cuenta nueva o contraseña temporal, **When** inicia sesión, **Then** solo puede cambiar contraseña; otra pantalla o función se rechaza hasta reemplazarla por una distinta de al menos 12 caracteres; no se exige composición. Cada perfil puede cambiar la propia verificando la actual; el Gestor no asigna temporales. RF-C3-AD-09/10/11; RNF-C3-AD-02.
4. **Given** entrega al Municipio, **When** se verifica la cuenta Geotrends y la recuperación reservada al contratista, **Then** Geotrends es administrador técnico desactivable bajo la salvaguarda del último administrador; la recuperación afecta exclusivamente el correo existente recibido, exige contraseña temporal ya protegida y fuerza cambio, deja auditoría y es inaccesible al usuario ordinario de la aplicación. RF-C3-AD-12/13/41.
5. **Given** acceso inválido, cuenta bloqueada o sesión inactiva, **When** se repiten solicitudes, **Then** no se devuelve información; a los cinco fallos consecutivos la cuenta se bloquea 15 minutos y genera aviso; a los veinte fallos por IP en quince minutos se bloquea quince minutos sin comprobar credenciales; sesión sin solicitudes durante treinta minutos vence. Se verifican los reinicios tras éxito y la IP confiable con los recorridos de la fuente. RNF-C3-AD-01/04/05/06.
6. **Given** tres cuentas con igual contraseña, **When** se inspecciona su protección y ocho operaciones, **Then** los valores protegidos son distintos y no aparece contraseña legible en ningún registro, notificación o respuesta. RNF-C3-AD-03.

---

### User Story 2 - Cargar, validar y mantener documentos sin publicar información incompleta (Priority: P1)

Gestores y administradores cargan documentos trazables; únicamente el administrador publica, rechaza, retira o edita. El ciudadano recibe la última versión validada completa y deja de usar contenido retirado, vencido o derogado.

**Why this priority**: Evita respuestas con información no aprobada y pérdida de la última versión válida. Cubre RF-C3-AD-01..04, 20..27, 32, 38/39 y obligaciones de SPEC001/002.

**Independent Test**: Con documentos sintéticos de dato único, tablas y fechas controladas, verificar los dos perfiles y el ciclo pendiente/publicado/reemplazado/rechazado/retirado/vencido; comprobar matriz, recuperación, citas y eliminación sin depender de analítica o propuestas.

**Acceptance Scenarios**:

1. **Given** ambos perfiles, **When** cargan PDF, DOCX y XLSX con datos completos o sin enlace/dirección/título, **Then** válidos quedan pendientes con origen manual, usuario, fecha y opcionales ausentes en «N/A»; inválidos señalan campo y dejan cero archivos y filas. La matriz completa es de solo lectura para Gestor con filtro propio; cuatro acciones directas privilegiadas se deniegan. RF-C3-AD-01/02/32.
2. **Given** documento pendiente con dato único, **When** se hacen cinco consultas antes y cinco después de publicarlo, **Then** antes no se usa ni recupera y después sí se recupera y cita; tres publicaciones, incluida una con tablas, mantienen consultas cada treinta segundos sin errores durante la preparación. Se retira el documento de prueba y consta el retiro. RF-C3-AD-03/04; RNF-C3-IV-02.
3. **Given** nuevo contenido detectado automáticamente, **When** cambia su huella o termina una nueva publicación, **Then** lo nuevo/modificado queda pendiente mientras responde lo validado; solo al terminar correctamente el reemplazo se elimina todo contenido/vectores anteriores y se actualiza la matriz sin duplicar el documento vigente. Si falla, un único reintento automático; dos fallos dejan pendiente, eliminan parciales y preservan la versión anterior. RF-C3-AD-20/21/26/27.
4. **Given** pendiente o publicado, **When** administrador rechaza o confirma retiro con motivo, **Then** se elimina contenido y, si corresponde, vectores/recuperación; solo queda registro con documento, origen, huella, motivo, usuario, fecha y hora. Cancelar retiro no cambia nada. Mismo origen/huella no reaparece tras dos ejecuciones; una huella distinta vuelve a pendiente. RF-C3-AD-22..25.
5. **Given** validez ayer/hoy/mañana/ausente, **When** termina el día de validez en America/Bogotá, **Then** solo vence lo vencido, no se recupera y genera un único aviso; hoy sigue disponible hasta 23:59:59. Una edición válida que fija fecha futura de un vencido lo devuelve a publicado, actualiza matriz/cita desde la siguiente consulta y conserva contenido/huella. RF-C3-AD-38/39.

---

### User Story 3 - Controlar fuentes y propuestas de actualización (Priority: P1)

El Gestor propone cambios de enlaces y sigue únicamente sus propuestas. El administrador decide con responsabilidad y puede cambiar enlaces directamente dentro de las fuentes permitidas.

**Why this priority**: Mantiene el perímetro documental y evita perder documentos publicados al dejar de vigilar una fuente. Cubre RF-C3-AD-14..19, 33/34.

**Independent Test**: Con dos Gestores, administrador y enlaces de prueba permitidos/no permitidos, verificar decisiones, propiedad, retiro de propuestas y siguiente verificación automática; no necesita llamadas a modelos.

**Acceptance Scenarios**:

1. **Given** Gestores A/B, **When** crean propuestas con tipo, URL, dirección y justificación, **Then** válidas quedan «Pendiente de validación» sin cambiar enlaces, inválidas señalan campo; cada Gestor ve solo las propias, incluido motivo de rechazo, y solo puede retirar pendientes propias. RF-C3-AD-14/33/34.
2. **Given** host permitido, **When** administrador aprueba/rechaza o agrega/quita directamente, **Then** decide con usuario/fecha/hora, rechazo exige motivo, cambio directo exige justificación/dirección y surte efecto en la siguiente ejecución; Gestor no decide. RF-C3-AD-16/17.
3. **Given** catorce enlaces del criterio, **When** ambos perfiles intentan registrarlos, **Then** solo seis HTTPS permitidos se aceptan; no hay función del panel que cambie la lista de hosts autorizados ni se amplía el corpus por permitir un host. RF-C3-AD-15; RF-C3-IV-01.
4. **Given** enlace quitado con documentos publicados, **When** corre de nuevo el scraper, **Then** documentos siguen publicados/recuperables pero sin verificación/actualización, el administrador recibe aviso con enlace, fecha, hora, usuario y documentos; quedan marcados «Sin actualización automática». Revisar el aviso no quita la marca; reagregar, retirar o reemplazar sí. Manuales nunca llevan esa marca. RF-C3-AD-18/19.

---

### User Story 4 - Mantener canales oficiales vigentes sin interrumpir la orientación (Priority: P1)

El administrador actualiza recepción, contacto general y atención inmediata; el ciudadano recibe valores válidos vigentes mediante las capacidades previas sin redespliegue.

**Why this priority**: Canales incompletos o erróneos dejan al ciudadano sin atención. Cubre RF-C3-AD-35..37 y preserva DI-19/20/24, DC-04, C3-IN-10 y C4-IN-06.

**Independent Test**: Editar cada grupo desde el panel, provocar formatos inválidos y leer los canales en las salidas ciudadanas existentes; Gestor denegado, sin otra configuración de contactos.

**Acceptance Scenarios**:

1. **Given** PQRSD/WhatsApp/correo, **When** se guarda un valor válido, **Then** siguiente respuesta usa el nuevo sin redespliegue; vacío, enlace no HTTPS, teléfono con letras o correo sin dominio se rechazan y ningún canal se puede quitar. RF-C3-AD-35.
2. **Given** teléfono/correo/enlace general, **When** se actualizan, **Then** lectura y orientación fuera de las tres direcciones muestran valores nuevos; vacíos/formatos errados no alteran el registro. RF-C3-AD-36.
3. **Given** lista de atención inmediata, **When** se agregan/modifican/reordenan/quitan canales, **Then** nombre, descripción de máximo 120 caracteres y valor válido son obligatorios; se conserva al menos uno, orden y valores aparecen en emergencia y riesgo. Descripción de 121 o quitar el último se rechaza. RF-C3-AD-37.

---

### User Story 5 - Revisar pendientes, notificaciones, auditoría y estado operativo (Priority: P1)

El administrador detecta problemas, resuelve pendientes y atribuye cambios; cada Gestor ve las notificaciones de sus cargas y puede revisarlas sin acceder a las del sistema ni de otros.

**Why this priority**: Impide fallas silenciosas y acciones sin responsable. Cubre RF-C3-AD-28..31, 40/41, 47/48; RNF-C3-AD-08/09 para todas las pantallas.

**Independent Test**: Con ocho tipos de aviso, cargas de dos Gestores, pendientes, cambios auditados y estados inducidos, verificar contadores, agrupación, acceso y recuperación operativa independientemente de métricas ciudadanas.

**Acceptance Scenarios**:

1. **Given** ocho avisos del sistema, **When** administrador revisa uno, **Then** orden reciente→antiguo, tipo/fecha/hora/descripción/estado y contador visible en todas las pantallas se conservan; contador ocho→siete; usuario/fecha/hora de revisión registrados, cero envíos externos. RF-C3-AD-28/29.
2. **Given** cuatro fallas mismo tipo/objeto y otra de objeto distinto, **When** se agrupan, **Then** primera notificación cuenta cuatro y última ocurrencia actualiza fecha; distinto objeto separa; tras revisar, nueva falla crea otro aviso con contador uno. Gestores A/B solo ven/revisan avisos de sus cargas, incluido motivo de rechazo/OCR/indexación. RF-C3-AD-30/31.
3. **Given** tres documentos y dos propuestas pendientes, **When** se abre bandeja, **Then** cinco elementos más antiguo→reciente con tipo/nombre o URL/origen/fecha/días y contador cinco visible en tres pantallas; publicar uno baja a cuatro, Gestor no ve bandeja. RF-C3-AD-40.
4. **Given** doce acciones de modificación y una recuperación reservada, **When** se consulta auditoría, **Then** trece registros con actor/acción/objeto/fecha-hora/resultado, filtros usuario/acción/fechas, ningún contenido documental/contraseña ni edición/borrado. Gestor denegado. RF-C3-AD-41.
5. **Given** reindexación en curso o fallida, **When** llegan consultas cada treinta segundos o se pide segunda ejecución, **Then** primera conserva servicio con base completa anterior, falla notifica y no expone parciales; segunda se rechaza mientras esté en curso; estado/inicio/fin se muestran. RF-C3-AD-47; RNF-C3-IV-02.
6. **Given** cinco degradaciones del criterio, **When** se observan, **Then** pantalla autenticada muestra modelos y último fallo, reranker/umbral, última ejecución automática y escritura del registro en menos de sesenta segundos; estado normal explícito, Gestor denegado. RF-C3-AD-48.
7. **Given** volúmenes contractuales y todas las pantallas, **When** se miden cargas en dos días y se revisa accesibilidad, **Then** cada pantalla cumple p95≤3 segundos; cero incumplimientos A/AA y cien por ciento de revisión manual con teclado y lector. RNF-C3-AD-08/09.

---

### User Story 6 - Revisar interacciones autorizadas y gestionar mejoras (Priority: P1)

El administrador revisa preguntas/respuestas permitidas, exporta el filtro y acompaña casos de mejora hasta cierre. El modo anónimo sigue sin texto ni caso de mejora.

**Why this priority**: Da seguimiento a respuestas sin información o no útiles y evita exposición ciudadana. Cubre RF-C4-AD-01..05; reutiliza el registro y la valoración de SPEC004/005 y clasificación REAL de SPEC006.

**Independent Test**: Con treinta interacciones y los ocho casos de origen del criterio, comprobar lista, filtros, exportación y estados; se puede demostrar con datos sintéticos autorizados sin administrar documentos.

**Acceptance Scenarios**:

1. **Given** veinte interacciones autorizadas y diez anónimas, **When** se consulta con filtros fecha/categoría/tipo/valoración, **Then** solo veinte muestran los nueve datos enmascarados con paginación, sin editar/borrar; exportar doce filtradas genera .xlsx legible con las mismas columnas, cero IDs de conversación/respuesta. Gestor no consulta/exporta. RF-C4-AD-01/02.
2. **Given** ocho interacciones del criterio, **When** hay «sin información» o valoración «No útil», **Then** exactamente cinco casos, uno por interacción elegible, estado «Registrada» y datos requeridos; interacción con ambos conserva dos orígenes en un solo caso, anónima no crea ninguno. RF-C4-AD-03.
3. **Given** caso registrado, **When** administrador avanza su gestión, **Then** solo Registrada→En análisis→En ajuste→Ajustada→Validada→Cerrada, sin saltos ni retrocesos; REAL exigido antes de En ajuste y nota antes de Cerrada; usuario/fecha/hora de cada cambio. Se rechazan seis intentos inválidos del criterio. RF-C4-AD-04.
4. **Given** seis casos, dos cerrados y uno de cuarenta y cinco días, **When** se filtra, **Then** fecha/categoría/origen/tipo/estado/antigüedad correctos, tres filtros y contador cuatro en tres pantallas; cerrar uno baja a tres; Gestor no ve sección. RF-C4-AD-05.
5. **Given** caso vinculado a defecto de validación, **When** se propone Validada/Cerrada, **Then** las evidencias de corrección/validación se conservan según SPEC006 y constitución IX; cambiar estado administrativo no cierra automáticamente hallazgos ni actas. Ningún estado recupera texto ya depurado por SPEC005. RF-C4-AD-04; RF-C3-VA-04, RF-C4-PR-03; RNF-C3-IN-01.

---

### User Story 7 - Conocer uso, documentos citados, utilidad y costo (Priority: P2)

El administrador consulta cifras agregadas para un rango de fechas, por defecto treinta días, y mantiene las tarifas de los dos modelos habilitados sin reescribir costos históricos.

**Why this priority**: Requisitos Importantes que completan operación y entrega; P2 ordena implementación, no los hace opcionales. Cubre RF-C3-AD-42..46 y RNF-C3-AD-07.

**Independent Test**: Con muestras del documento y tarifas verificadas, comparar cada tablero contra conteos y costos esperados, sin cargar o revisar textos individuales.

**Acceptance Scenarios**:

1. **Given** tarifas por modelo/entrada/salida, **When** administrador guarda un valor positivo con hasta cuatro decimales, **Then** solo consultas posteriores usan la nueva tarifa; cero/negativo/texto/más de cuatro decimales rechazados, costo anterior intacto y Gestor denegado. RF-C3-AD-42.
2. **Given** cuarenta consultas, veinticinco autorizadas y quince anónimas, **When** se abre uso, **Then** total cuarenta, por día correcto, categoría/tipo solo autorizadas suman veinticinco y anónimas quince aparte; etiqueta explica procedencia. RF-C3-AD-43.
3. **Given** veinte respuestas con doce documentos y empate, **When** se consulta ranking, **Then** diez documentos con nombre/dirección/citas, orden por citas descendente y desempate por nombre; cobertura anónima se señala sin inventar documentos citados anónimos. RF-C3-AD-44.
4. **Given** diez valoraciones, cinco útiles/cinco no útiles una por motivo, **When** se consulta utilidad, **Then** cinco/cinco y cincuenta por ciento cada grupo, un caso por cada motivo y sin aportes anónimos. RF-C3-AD-45.
5. **Given** veinte consultas, diez por modelo con cinco autorizadas/cinco anónimas por modelo, **When** se consulta consumo, **Then** consultas/tokens entrada-salida/costos por modelo y total coinciden con registros y cálculo manual, incluidos anónimos; los cuatro tableros no entregan texto ni identificadores. RF-C3-AD-46; RNF-C3-AD-07.

### Edge Cases

- Acciones concurrentes de desactivación/cambio de perfil no pueden evadir el último administrador. Cuenta reactivada conserva identidad e historial, no revive sesiones. RF-C3-AD-06..08.
- Autoactualización del panel no debe mantener artificialmente una sesión sin actividad del usuario; el plan debe verificar coherencia con «ninguna solicitud suya» y pruebas de 29/31 minutos. RNF-C3-AD-05.
- Contraseña correcta durante bloqueo sigue rechazada; error de contraseña/cuenta bloqueada/correo inexistente presentan el mismo mensaje; bloqueo por IP precede verificación y encabezado falsificado no cambia identidad confiable. RNF-C3-AD-04/06.
- Documento pendiente nuevo y versión vigente pueden coexistir mientras se decide; no son duplicación del documento vigente. Rechazar actualización conserva publicado anterior; solo reemplazo correcto elimina contenido anterior. RF-C3-AD-20..22/27.
- Huella igual con origen distinto no se omite por rechazo/retiro ajeno; origen igual y huella nueva vuelve a pendiente. RF-C3-AD-23/25.
- Retirar enlace no retira documentos; vencer/derogar sí excluye recuperación aunque enlace permanezca retirado. Notificación revisada no vuelve a habilitar contenido ni elimina la marca. RF-C3-AD-03/18/19/38.
- Archivo de formato diligenciado, OCR≤80 % o documento ajeno al corpus no elude salvaguardas de SPEC001 por carga manual. Enlace de acceso público obligatorio no sustituye prueba de origen/alcance. RF-C3-IV-01/07/10; RF-C3-AD-01..03.
- Rechazo de carga por campo faltante no almacena archivo/filas; descarte de extracción/OCR conserva únicamente evidencia segura prevista y notifica al responsable. RF-C3-AD-01/02/31.
- Descripción inmediata de 120 aceptada y 121 rechazada; tarifa de cuatro decimales admitida y cinco rechazada. No se elimina último canal ni canal de recepción obligatorio. RF-C3-AD-35/37/42.
- Dos orígenes de mejora crean un caso; actualización de valoración no crea duplicado. Sin valoraciones el tablero muestra cero conteos y porcentajes cero, sin división inválida. RF-C4-AD-03; RF-C3-AD-45.
- Texto ya depurado a doce meses no se reconstruye desde casos, exportación, auditoría o caché; filas históricas autorizadas indican texto no disponible y conservan únicamente campos permitidos por SPEC005. RNF-C3-IN-01/12; RNF-C3-AD-07.
- Administrador que ve estado de una dependencia caída sigue autenticado: degradación no habilita acceso público ni expone rutas, trazas, proveedor o secretos. RF-C3-AD-26/48; RNF-C3-AD-01/03.
- Cancelar confirmación no altera datos. Acceso por enlace directo o llamada directa respeta perfil/propiedad aunque el control no sea visible. RF-C3-AD-24/31..34; RNF-C3-AD-01.

## Requirements *(mandatory)*

### Functional Requirements

Se conservan IDs y prioridades del documento; no se emiten RF nuevos. Toda capacidad y su criterio de verificación son obligatorios, también los Importantes. Se reproducen los criterios con las cantidades originales; las salvedades de integración al final resuelven diferencias de contexto sin reducirlos. La política de permisos se verifica tanto en pantalla como en todo acceso a datos/acciones.

#### Carga y publicación inicial

- **RF-C3-AD-01** — Esencial; H6-C3; US2. El sistema deberá permitir al Gestor documental y al administrador técnico cargar manualmente un documento desde el panel de administración, exigiendo como campos obligatorios el tipo de documento, el título, la dirección responsable, el enlace de acceso público y el procedimiento asociado (código o 'ninguno'), y aceptando como campos opcionales el código, la versión, la fecha de última actualización y la fecha de validez, y deberá rechazar la carga, indicando el campo faltante, cuando falte algún campo obligatorio.

  **Verificación**: 6 cargas: 3 válidas (PDF, DOCX, XLSX) y 3 inválidas (sin enlace, dirección y título). Las válidas se aceptan; las inválidas se rechazan indicando el campo faltante y sin almacenar el archivo; igual resultado con ambos perfiles.

- **RF-C3-AD-02** — Esencial; H6-C3; US2. El sistema deberá registrar en la matriz documental cada documento cargado manualmente y aceptado, con estado 'Pendiente de aprobación', origen 'manual', usuario que lo cargó, fecha y hora de carga y los campos de RF-C3-AD-01, y deberá mostrar como 'N/A' los campos opcionales no diligenciados.

  **Verificación**: Con las 3 cargas válidas: 3 filas con esos datos, opcionales vacíos en 'N/A'. Las 3 rechazadas dejan 0 filas. Filas de la matriz = documentos cargados.

- **RF-C3-AD-03** — Esencial; H6-C3; US2. El sistema deberá excluir de la recuperación, en todas las consultas, los fragmentos de todo documento cuyo estado sea 'Pendiente de aprobación', derogado (RF-C3-IV-03) o 'Vencido' (RF-C3-AD-38); un documento pendiente solo será recuperable cuando el administrador técnico lo publique.

  **Verificación**: Documento de prueba pendiente con dato único: 5 consultas con 0 fragmentos recuperados y sin usar el dato. Tras publicarlo, 5 consultas lo recuperan y citan. El documento de prueba se retira al final y consta el retiro.

- **RF-C3-AD-04** — Esencial; H6-C3; US2. El sistema deberá permitir al administrador técnico publicar un documento en estado 'Pendiente de aprobación' desde el panel, cambiando su estado a 'Publicado' y haciéndolo disponible para la recuperación una vez finalizada su indexación en el índice documental.

  **Verificación**: 3 documentos pendientes (uno con tablas) publicados: estado 'Publicado', indexación completada y 5 consultas por documento lo recuperan y citan. Durante la indexación, una consulta cada 30 s sin error con la versión anterior (RNF-C3-IV-02).

#### Cuentas y contraseñas

- **RF-C3-AD-05** — Esencial; H6-C3; US1. El sistema deberá permitir al administrador técnico crear, desde el panel, una cuenta de usuario con nombre, correo electrónico, perfil asignado (administrador técnico o Gestor documental) y contraseña inicial, y deberá rechazar la creación, indicando el campo en falta o repetido, cuando falte alguno de esos datos o el correo ya exista.

  **Verificación**: 7 intentos: 2 creaciones válidas (una por perfil) con inicio de sesión posible; 5 rechazos, uno por cada campo ausente (nombre, correo, perfil, contraseña) y uno por correo repetido, sin crear cuenta. Gestor documental denegado.

- **RF-C3-AD-06** — Esencial; H6-C3; US1. El sistema deberá permitir al administrador técnico desactivar una cuenta de usuario desde el panel, y deberá, desde ese momento, cerrar las sesiones activas de esa cuenta y rechazar todo nuevo inicio de sesión con ella, conservando la cuenta y su historial de acciones.

  **Verificación**: 3 cuentas con sesión abierta (2 Gestores, 1 administrador técnico) desactivadas: siguiente solicitud 401, inicio de sesión rechazado sin revelar si la cuenta existe, estado 'Desactivada' en la lista, cargas anteriores con su usuario. Gestor denegado.

- **RF-C3-AD-07** — Importante; H6-C3; US1. El sistema deberá permitir al administrador técnico reactivar una cuenta de usuario desactivada desde el panel, restituyendo su perfil anterior y exigiendo un nuevo inicio de sesión, sin restablecer las sesiones cerradas al desactivarla.

  **Verificación**: 3 cuentas reactivadas: estado 'Activa' con el mismo perfil, inicio de sesión con la contraseña vigente, sesión cerrada sigue en 401, acciones anteriores conservan su usuario. Gestor denegado.

- **RF-C3-AD-08** — Esencial; H6-C3; US1. El sistema deberá impedir la desactivación de una cuenta, o el cambio de su perfil a Gestor documental, cuando esa acción deje al sistema sin ninguna cuenta activa con perfil de administrador técnico, y deberá informar al usuario que realiza la acción el motivo del rechazo.

  **Verificación**: Con 1 administrador técnico activo: desactivarse, cambiarse el perfil y repetirlo desde otra sesión se rechazan con motivo y sin cambios. Con 2 activos, desactivar uno funciona; al volver a 1 se rechaza otra vez.

- **RF-C3-AD-09** — Esencial; H6-C3; US1. El sistema deberá permitir a todo usuario autenticado cambiar su propia contraseña desde el panel, solicitando la contraseña actual y la nueva, y deberá rechazar el cambio, sin modificar la contraseña vigente, cuando la contraseña actual sea incorrecta o la nueva incumpla la longitud mínima de RNF- C3-AD-02.

  **Verificación**: 6 intentos (3 por perfil): 2 válidos (entra con la nueva, la anterior se rechaza) y 4 inválidos (actual incorrecta, actual vacía, nueva de 11 caracteres, nueva vacía) con motivo y contraseña vigente intacta.

- **RF-C3-AD-10** — Esencial; H6-C3; US1. El sistema deberá exigir al usuario que cambie su contraseña en el primer inicio de sesión posterior a la creación de su cuenta o a la asignación de una contraseña temporal por el administrador técnico, y deberá rechazar, hasta que la cambie, cualquier acceso a otra pantalla o servicio del panel, aceptando solo una contraseña nueva que cumpla RNF-C3-AD-02 y sea distinta de la temporal.

  **Verificación**: 4 recorridos (2 cuentas nuevas, 2 con temporal): solo se ve la pantalla de cambio, 4 URL directas y 4 servicios rechazados, nueva de 11 caracteres o igual a la temporal rechazada, con válida acceso normal, segundo inicio sin pedir cambio.

- **RF-C3-AD-11** — Esencial; H6-C3; US1. El sistema deberá permitir al administrador técnico asignar, desde el panel, una contraseña temporal a la cuenta de otro usuario, y deberá rechazar la asignación, indicando el motivo, cuando la contraseña temporal incumpla la longitud mínima de RNF-C3-AD-02, y deberá marcar la cuenta para el cambio obligatorio de RF-C3-AD-10.

  **Verificación**: 2 asignaciones válidas (a un Gestor y a otro administrador técnico, temporal de 12 caracteres): inicio con la temporal y cambio obligatorio. 2 rechazos (11 caracteres, vacía). 2 con Gestor denegados. Contraseña vigente intacta en los 4 restantes.

- **RF-C3-AD-12** — Esencial; H6-C3; US1. El sistema deberá entregarse con una cuenta de perfil administrador técnico asignada al contratista (Geotrends), que permita asignar contraseñas temporales a cualquier otra cuenta conforme a RF-C3-AD-11, y que pueda ser desactivada por un administrador técnico del Municipio conforme a RF-C3-AD-06 y RF-C3-AD-08.

  **Verificación**: En producción: (1) la cuenta de Geotrends existe con perfil administrador técnico; (2) asigna temporal a un administrador del Municipio, que queda obligado a cambiarla; (3) el administrador del Municipio la desactiva y recibe 401; se rechaza si fuera el último administrador activo.

- **RF-C3-AD-13** — Importante; H6-C3; US1. El sistema deberá incluir un procedimiento almacenado en la base de datos que, al recibir como únicos parámetros el correo de una cuenta y una contraseña temporal ya cifrada, actualice la contraseña solo de esa cuenta y active su indicador de cambio obligatorio de RF-C3-AD-10, y que termine con error, sin modificar ninguna cuenta, cuando el correo no exista, y deberá poder ser ejecutado únicamente por un rol de base de datos reservado al contratista, no por el usuario de la aplicación.

  **Verificación**: En producción con 3 cuentas: (1) con el rol del contratista, login con temporal y cambio obligatorio, otras 2 cuentas sin cambios; (2) correo inexistente: error y 0 filas modificadas; (3) usuario de la aplicación: denegado; (4) columna de contraseña con valor cifrado.

#### Enlaces y propuestas

- **RF-C3-AD-14** — Importante; H6-C3; US3. El sistema deberá permitir al Gestor documental registrar desde el panel una propuesta para agregar o quitar un enlace del scraper, exigiendo el tipo de solicitud, la URL completa con protocolo https, la dirección responsable y una justificación de texto, y deberá guardar la propuesta con estado 'Pendiente de validación' sin modificar la lista de enlaces vigente, rechazándola, con indicación del campo, si falta alguno de esos datos o la URL no es válida.

  **Verificación**: 8 propuestas: 3 válidas guardadas 'Pendiente de validación' con la lista de enlaces idéntica; 5 inválidas (sin justificación, sin dirección, sin tipo, URL http, URL sin dominio) rechazadas con campo y sin guardar.

- **RF-C3-AD-15** — Esencial; H6-C3; US3. El sistema deberá rechazar, indicando el motivo, el registro de toda propuesta de enlace y todo enlace configurado para el scraper que no use el protocolo https o cuyo host no coincida con una entrada de la lista de entradas permitidas definida en la configuración del scraper, donde una entrada de tipo 'dominio con subdominios' acepta el dominio y todo host que termine en un punto seguido del dominio, y una de tipo 'host exacto' acepta solo ese host, con las entradas iniciales envigado.gov.co (dominio con subdominios) y www.concejoenvigado.gov.co, observatorioenvigado.geotrends.co y ambientometroenvigado.com (hosts exactos), y no deberá existir ninguna función del panel que agregue, modifique o elimine entradas de esa lista.

  **Verificación**: 14 enlaces con cuentas de Gestor (propuesta) y administrador técnico (directo): 6 permitidos aceptados (gmas2.envigado.gov.co, envigado.gov.co, www.envigado.gov.co, www.concejoenvigado.gov.co, observatorioenvigado.geotrends.co, ambientometroenvigado.com); 8 no permitidos rechazados con motivo; ninguna función del panel edita la lista; una entrada nueva en el código solo se acepta tras desplegar versión.

- **RF-C3-AD-16** — Importante; H6-C3; US3. El sistema deberá permitir al administrador técnico aprobar o rechazar desde el panel cada propuesta de enlace en estado 'Pendiente de validación', exigiendo un motivo de texto para rechazarla, registrando usuario, fecha y hora de la decisión, y modificando la lista de enlaces del scraper solo al aprobarla, de modo que la siguiente ejecución del scraper incluya el enlace agregado o excluya el enlace quitado. Los estados de la propuesta son 'Pendiente de validación', 'Aprobada', 'Rechazada' y 'Retirada'.

  **Verificación**: 6 propuestas y 6 decisiones: lista sin cambios hasta aprobar; tras aprobar, la siguiente ejecución incluye o excluye el enlace; 2 rechazos con motivo visible al Gestor y lista intacta; rechazo sin motivo no se acepta; decisión del Gestor denegada; usuario, fecha y hora en cada decisión.

- **RF-C3-AD-17** — Esencial; H6-C3; US3. El sistema deberá permitir al administrador técnico agregar o quitar directamente un enlace de la lista del scraper desde el panel, sin propuesta previa, exigiendo la URL completa con protocolo https, la dirección responsable y una justificación de texto, y deberá rechazar la acción, indicando el motivo, cuando falte alguno de esos datos o la URL incumpla RF-C3-AD-15, registrando usuario, fecha y hora de cada cambio aceptado y aplicándolo desde la siguiente ejecución del scraper.

  **Verificación**: 8 acciones: 2 válidas con usuario, fecha y hora y efecto en la siguiente ejecución; 4 rechazadas (sin justificación, sin dirección, host no permitido, URL http); 2 con Gestor denegadas; lista intacta en las 6.

- **RF-C3-AD-18** — Esencial; H6-C3; US3. El sistema deberá, cuando se quite un enlace de la lista del scraper por RF-C3-AD-16 o RF-C3-AD-17 y existan documentos publicados cuyo enlace de origen sea ese, mantenerlos publicados y generar una notificación para el administrador técnico en el panel que indique el enlace quitado, la fecha y hora, el usuario que lo quitó y la lista de esos documentos, y deberá dejar de verificarlos y actualizarlos desde la siguiente ejecución del scraper.

  **Verificación**: 4 casos: enlace con 3 documentos quitado por el administrador; con 2 por aprobación de propuesta; enlace sin documentos; registro del scraper tras la siguiente ejecución. Documentos siguen publicados y recuperables, notificación con los 5 datos, sin notificación en el caso sin documentos, 0 verificaciones de enlaces quitados, invisible al Gestor.

- **RF-C3-AD-19** — Importante; H6-C3; US3. El sistema deberá mostrar en la matriz documental la indicación 'Sin actualización automática' en todo documento publicado cuyo enlace de origen haya sido quitado de la lista del scraper, y deberá retirar esa indicación cuando el enlace vuelva a agregarse, cuando el documento se retire o cuando se reemplace por una versión nueva.

  **Verificación**: 5 documentos de RF-C3-AD-18 con la marca y 3 de enlaces no tocados sin ella; la marca sigue tras revisar la notificación; desaparece al reagregar el enlace, retirar o reemplazar; un documento manual nunca la muestra.

#### Versiones, rechazo, retiro y fallas

- **RF-C3-AD-20** — Esencial; H6-C3; US2. El sistema deberá, al publicar un documento pendiente que corresponda a una versión nueva de un documento ya publicado (mismo código o mismo enlace de origen), eliminar de la base de conocimiento y de el índice documental el contenido y los vectores de la versión anterior una vez que la indexación de la versión nueva haya terminado correctamente, y no deberá conservar copia del contenido anterior.

  **Verificación**: 3 reemplazos (scraper, manual, con tablas) con un dato único por versión: 5 consultas por documento recuperan solo el dato nuevo; 0 coincidencias del dato anterior en base y el índice documental; una fila por documento con versión y fecha nuevas; durante la indexación responde la versión anterior.

- **RF-C3-AD-21** — Esencial; H6-C3; US2. El sistema deberá registrar en la matriz documental, con estado 'Pendiente de aprobación' y origen 'scraper', todo documento o página nuevos o con contenido modificado que detecte el scraper en un enlace configurado, y deberá mantener en uso, mientras tanto, la última versión validada de ese documento, con la misma regla de RF-C3-IV-04.

  **Verificación**: 3 enlaces de prueba (nuevo, modificado, sin cambios): tras una ejecución, nuevo y modificado quedan 'Pendiente de aprobación' con origen 'scraper'; el sin cambios no genera fila; 5 consultas recuperan solo la versión publicada; la fila pendiente conserva el hash.

- **RF-C3-AD-22** — Esencial; H6-C3; US2. El sistema deberá permitir al administrador técnico rechazar desde el panel un documento en estado 'Pendiente de aprobación', exigiendo un motivo de texto, y deberá eliminar su contenido de la base de conocimiento y conservar únicamente un registro del rechazo con documento, origen, hash del contenido rechazado, motivo, usuario, fecha y hora.

  **Verificación**: 6 intentos: 4 rechazos válidos (2 manuales, 2 del scraper) con documento fuera de matriz y base, 0 coincidencias y registro con los 7 datos; sin motivo rechazado; Gestor denegado. Si era versión nueva, la publicada sigue respondiendo.

- **RF-C3-AD-23** — Importante; H6-C3; US2. El sistema deberá omitir, en las ejecuciones posteriores del scraper, el registro como 'Pendiente de aprobación' de todo contenido cuyo enlace de origen y hash coincidan con los de un rechazo registrado conforme a RF-C3-AD-22, y deberá registrar como pendiente el contenido de ese mismo enlace cuyo hash sea distinto.

  **Verificación**: 3 documentos rechazados y 2 ejecuciones sin cambios: 0 filas pendientes nuevas y registro 'omitido por rechazo previo'. Modificado uno de los enlaces, su contenido aparece pendiente y los otros 2 siguen omitidos.

- **RF-C3-AD-24** — Esencial; H6-C3; US2. El sistema deberá permitir al administrador técnico retirar desde el panel un documento publicado, mostrando antes un diálogo de confirmación con el nombre del documento y exigiendo un motivo de texto, y deberá, tras la confirmación, eliminar su contenido y sus vectores de la base de conocimiento y de el índice documental, excluirlo de la recuperación y conservar únicamente un registro del retiro con documento, origen, hash del contenido, motivo, usuario, fecha y hora.

  **Verificación**: 6 intentos: 4 retiros válidos (2 manuales, 2 del scraper, uno con tablas) con diálogo y motivo obligatorio; desaparece de matriz y base, 0 coincidencias en base y el índice documental, 5 consultas ya no lo recuperan, registro con 7 datos; diálogo cancelado sin cambios; Gestor denegado.

- **RF-C3-AD-25** — Importante; H6-C3; US2. El sistema deberá omitir, en las ejecuciones posteriores del scraper, el registro como 'Pendiente de aprobación' de todo contenido cuyo enlace de origen y hash coincidan con los de un retiro registrado conforme a RF-C3-AD-24, y deberá registrar como pendiente el contenido de ese mismo enlace cuyo hash sea distinto.

  **Verificación**: 3 documentos retirados con enlaces aún en la lista y 2 ejecuciones sin cambios: 0 pendientes nuevos y registro 'omitido por retiro previo'. Modificado uno, aparece pendiente; los otros 2 siguen omitidos.

- **RF-C3-AD-26** — Esencial; H6-C3; US2. El sistema deberá, cuando falle la indexación de un documento al publicarlo conforme a RF-C3-AD-04, reintentar la indexación una vez de forma automática y, si el reintento también falla, mantener el documento en estado 'Pendiente de aprobación', eliminar los fragmentos parciales generados en el índice documental y generar una notificación para el administrador técnico con el documento, la fecha y hora y el tipo de error, sin rutas, trazas ni detalles técnicos.

  **Verificación**: 4 pruebas con fallo forzado: reintento exitoso queda 'Publicado' sin notificación; fallan ambos: queda pendiente, 0 fragmentos en el índice documental, 5 consultas no lo recuperan, notificación con los 3 datos; republicar tras corregir; notificación sin rutas ni mensajes del proveedor.

- **RF-C3-AD-27** — Esencial; H6-C3; US2. El sistema deberá, cuando falle la indexación de una versión nueva de un documento ya publicado tras el reintento de RF-C3-AD-26, mantener en uso la versión anterior conforme a RF-C3-IV-04, sin eliminar su contenido ni sus vectores, y mantener la versión nueva en 'Pendiente de aprobación' sin que sus fragmentos parciales sean recuperables.

  **Verificación**: 3 reemplazos con fallo en ambos intentos: 5 consultas recuperan solo el dato anterior, el índice documental conserva los vectores anteriores y la nueva tiene 0 fragmentos, matriz con fila publicada intacta y fila pendiente; tras corregir y republicar, la anterior se elimina (RF-C3-AD-20).

#### Notificaciones

- **RF-C3-AD-28** — Esencial; H6-C3; US5. El sistema deberá mostrar al administrador técnico, en una sección del panel, la lista de las notificaciones del sistema ordenadas de la más reciente a la más antigua, con tipo, fecha y hora, descripción y estado ('No revisada' o 'Revisada'), y un contador de las 'No revisadas' en todas las pantallas, sin enviarlas por correo ni por ningún canal externo al panel.

  **Verificación**: 8 notificaciones de 8 tipos: lista ordenada con los 4 datos; contador 8 en 3 pantallas; baja a 7 al revisar una; 0 envíos de correo; invisible al Gestor.

- **RF-C3-AD-29** — Esencial; H6-C3; US5. El sistema deberá permitir al administrador técnico marcar como 'Revisada' una notificación del sistema desde la sección de notificaciones, registrando su usuario, fecha y hora, y deberá conservarla en la lista con ese estado y descontarla del contador de 'No revisadas'.

  **Verificación**: 5 notificaciones del sistema: el administrador marca 4 (una por vez) con usuario, fecha y hora, contador de 5 a 1, siguen en la lista; Gestor denegado para las del sistema (puede marcar las suyas, RF-C3-AD-31).

- **RF-C3-AD-30** — Importante; H6-C3; US5. El sistema deberá agrupar en una sola notificación 'No revisada' las repetidas del mismo tipo y objeto (enlace, documento o cuenta), incrementando un contador de repeticiones y actualizando la fecha y hora de la última ocurrencia, y deberá crear una notificación nueva con contador en 1 cuando el mismo evento ocurra después de que la anterior haya sido marcada 'Revisada'.

  **Verificación**: 4 fallas del scraper sobre un enlace: 1 notificación con contador 4; segundo enlace: notificación aparte; tras revisar la primera y nueva falla: nueva con contador 1; el contador de 'No revisadas' cuenta cada agrupada una vez.

- **RF-C3-AD-31** — Importante; H6-C3; US5. El sistema deberá mostrar al Gestor documental, en una sección del panel, únicamente las notificaciones generadas por sus propias cargas (rechazo del documento con su motivo, descarte por OCR bajo el umbral y falla de indexación), con tipo, fecha y hora, documento, descripción y estado, junto con un contador de las 'No revisadas', y deberá permitirle marcarlas 'Revisada' conforme a RF-C3-AD-29 y RF-C3-AD-30, sin mostrarle las demás notificaciones del sistema ni las de otros usuarios.

  **Verificación**: Gestores A y B con 3 eventos de A, 1 de B y 2 del sistema: A ve sus 3 con contador 3; B solo la suya; ninguno ve las del sistema; A marca una y baja a 2; marcar ajena o del sistema denegado; rechazo muestra el motivo; segundo descarte por OCR se agrupa con contador 2.

#### Vistas y propuestas del Gestor

- **RF-C3-AD-32** — Importante; H6-C3; US2/US3. El sistema deberá mostrar al Gestor documental, en el panel, la matriz documental completa en solo lectura, con un filtro que limite la lista a los documentos cargados por su propio usuario, y no deberá ofrecerle en esa vista ninguna acción de publicar, rechazar, retirar ni editar documentos.

  **Verificación**: Matriz de 10 documentos (4 propios, 3 de otro Gestor, 3 del scraper): ve las 10 filas; el filtro deja 4 con su estado; sin controles de publicar, rechazar, retirar ni editar; 4 llamadas directas denegadas; el administrador técnico sí tiene esas acciones.

- **RF-C3-AD-33** — Importante; H6-C3; US2/US3. El sistema deberá mostrar al Gestor documental, en el panel, la lista de sus propias propuestas de enlace con tipo de solicitud, URL, fecha y hora y estado ('Pendiente de validación', 'Aprobada', 'Rechazada' o 'Retirada'), y deberá mostrar el motivo escrito por el administrador técnico en las rechazadas, sin mostrarle las de otros usuarios.

  **Verificación**: A registra 3 propuestas y B 1; el administrador aprueba 1, rechaza 1 con motivo y deja 1 pendiente: A ve sus 3 con los 5 datos y estados correctos, el motivo coincide, B solo la suya, llamada directa a las de B denegada.

- **RF-C3-AD-34** — Importante; H6-C3; US2/US3. El sistema deberá permitir al Gestor documental retirar desde el panel una propuesta de enlace propia en estado 'Pendiente de validación', cambiando su estado a 'Retirada' y excluyéndola de las propuestas por validar del administrador técnico, y deberá rechazar el retiro de una propuesta que no esté pendiente o que sea de otro usuario.

  **Verificación**: A con 4 propuestas (pendiente, aprobada, rechazada, pendiente) y B con 1: A retira su pendiente y pasa a 'Retirada'; el administrador ya no la ve; lista de enlaces sin cambios; retirar aprobada, rechazada o ajena se rechaza; la otra pendiente sigue pendiente.

#### Contactos oficiales

- **RF-C3-AD-35** — Esencial; H6-C3; US4. El sistema deberá permitir al administrador técnico modificar desde el panel el valor de cada uno de los canales oficiales de recepción (PQRSD, WhatsApp y correo electrónico), validando que PQRSD sea una URL https, WhatsApp un número con solo dígitos y símbolos permitidos y el correo una dirección válida, y deberá rechazar el guardado, indicando el campo y el motivo, cuando el valor esté vacío o incumpla ese formato, sin permitir quitar ninguno de los tres canales.

  **Verificación**: 8 intentos: 3 válidos (uno por canal) con valor nuevo en la siguiente respuesta sin redespliegue (RF-C3-DI-24); 4 inválidos (PQRSD con http, WhatsApp con letras, correo sin dominio, campo vacío) rechazados; sin función para quitar un canal; Gestor denegado.

- **RF-C3-AD-36** — Esencial; H6-C3; US4. El sistema deberá permitir al administrador técnico modificar desde el panel los tres datos del contacto general (teléfono, correo electrónico y enlace a la página oficial de contacto), validando que el teléfono contenga solo dígitos y símbolos permitidos, que el correo sea válido y que el enlace use https, y deberá rechazar el guardado, indicando el campo y el motivo, cuando algún valor esté vacío o incumpla ese formato.

  **Verificación**: 7 intentos: 3 válidos con valor nuevo en el servicio de RF-C3-IN-10 y en una consulta ajena a las 3 Direcciones (RF-C3-DI-20) sin redespliegue; 4 inválidos (teléfono con letras, correo sin dominio, enlace http, campo vacío) rechazados; Gestor denegado.

- **RF-C3-AD-37** — Esencial; H6-C3; US4. El sistema deberá permitir al administrador técnico agregar, modificar, quitar y reordenar desde el panel los canales de atención inmediata, cada uno con nombre, descripción de máximo 120 caracteres y valor (teléfono, correo o URL https) validado por formato, y deberá rechazar el guardado, indicando el campo y el motivo, cuando falte un dato, el valor incumpla el formato o la acción deje la lista sin ningún canal.

  **Verificación**: 10 acciones: 6 válidas (3 altas, 1 modificación, 1 reorden, 1 baja que deja al menos un canal) con la opción 'Emergencia' y RF-C3-DI-19 reflejando orden y valores sin redespliegue; 4 inválidas (descripción de 121 caracteres, formato errado, campo vacío, quitar el último canal) rechazadas; Gestor denegado.

#### Vigencia y metadatos

- **RF-C3-AD-38** — Esencial; H6-C3; US2. El sistema deberá cambiar a estado 'Vencido' en la matriz, al fin del día de su fecha de validez (zona horaria America/Bogotá), todo documento publicado con fecha de validez diligenciada, excluyéndolo de la recuperación conforme a RF-C3-AD-03, y generar una notificación única para el administrador técnico con el documento y la fecha de vencimiento.

  **Verificación**: Reloj simulado y 4 documentos con validez ayer, hoy, mañana y sin fecha: el de ayer no se recupera, queda 'Vencido' y genera 1 notificación; el de hoy se recupera hasta las 23:59:59; mañana y sin fecha se recuperan.

- **RF-C3-AD-39** — Importante; H6-C3; US2. El sistema deberá permitir al administrador técnico editar desde el panel el título, tipo, dirección, enlace, procedimiento asociado, versión, fecha de última actualización y fecha de validez de un documento publicado, pendiente o vencido, sin cargar un archivo nuevo, aplicando las validaciones de RF-C3-AD-01, y deberá reflejar el cambio en la matriz y en las citas desde la siguiente consulta, sin modificar el contenido del documento.

  **Verificación**: 6 ediciones: 3 válidas (título, enlace, fecha de validez futura en un 'Vencido') y 3 inválidas (título vacío, enlace http, dirección fuera de lista). Matriz y cita reflejan el cambio, el 'Vencido' vuelve a 'Publicado', hash sin cambio, inválidas rechazadas, Gestor denegado.

#### Pendientes y auditoría

- **RF-C3-AD-40** — Esencial; H6-C3; US5. El sistema deberá mostrar al administrador técnico, en una sección del panel, la bandeja de elementos pendientes (documentos 'Pendiente de aprobación' y propuestas 'Pendiente de validación') con tipo, nombre o URL, origen, fecha y días transcurridos, ordenada del más antiguo al más reciente, y un contador de pendientes visible en todas las pantallas.

  **Verificación**: 3 documentos pendientes (uno de 40 días) y 2 propuestas: bandeja con 5 ordenados del más antiguo y días correctos; contador 5 en 3 pantallas; baja a 4 al publicar uno; invisible al Gestor.

- **RF-C3-AD-41** — Esencial; H6-C3; US5. El sistema deberá registrar, por cada acción del panel que modifique datos (cargas, publicaciones, rechazos, retiros, ediciones, cambios de enlaces, gestión de cuentas, cambios de contacto) y por cada ejecución del procedimiento de RF-C3-AD-13, el usuario o rol de base de datos, la acción, el objeto afectado, la fecha y hora y el resultado, sin registrar contraseñas ni contenido de documentos, y deberá permitir al administrador técnico consultarlo filtrado por usuario, acción y rango de fechas, sin función para editarlo o borrarlo.

  **Verificación**: 12 acciones de tipos distintos y 1 ejecución del procedimiento: 13 filas con los 5 datos; 0 coincidencias de contraseñas y contenido; 3 filtros correctos; sin edición ni borrado; invisible al Gestor.

#### Tarifas y tableros

- **RF-C3-AD-42** — Importante; H6-C3; US7. El sistema deberá permitir al administrador técnico modificar desde el panel la tarifa en USD por millón de tokens de entrada y de salida de cada uno de los dos modelos habilitados, validando que sea un número positivo con hasta 4 decimales, aplicándola solo a las consultas posteriores al guardado, sin recalcular registros anteriores.

  **Verificación**: 4 cambios válidos y 3 inválidos (cero, negativo, texto); 4 consultas (2 por modelo): costo coincide con el cálculo a mano; registros anteriores sin cambio; inválidos rechazados; Gestor denegado.

- **RF-C3-AD-43** — Importante; H6-C3; US7. El sistema deberá mostrar al administrador técnico, en un tablero y para un rango de fechas (por defecto 30 días), el total de consultas, las de cada día, las de cada categoría enviada y las de cada tipo de resultado, indicando que las dos últimas cifras provienen solo de conversaciones con 'Autorizo' y mostrando aparte las consultas anónimas.

  **Verificación**: 40 consultas (25 en conversación, 15 anónimas): total 40; por categoría y por tipo suman 25; anónimas aparte con 15; coinciden con conteo en los registros institucionales; filtro de fechas correcto; invisible al Gestor.

- **RF-C3-AD-44** — Importante; H6-C3; US7. El sistema deberá mostrar al administrador técnico, para el mismo rango de fechas, el ranking de los 10 documentos más citados en las respuestas, con nombre, dirección responsable y número de citas, de mayor a menor y, en empate, por nombre.

  **Verificación**: 20 respuestas con 12 documentos y un empate: ranking de 10 con citas correctas, empate por nombre, coincide con conteo directo; el modo anónimo lo indica.

- **RF-C3-AD-45** — Importante; H6-C3; US7. El sistema deberá mostrar al administrador técnico, para el mismo rango de fechas, el número de valoraciones 'Útil' y 'No útil', el porcentaje de cada una y el número de 'No útil' por cada uno de los 5 motivos.

  **Verificación**: 10 valoraciones (5 'Útil', 5 'No útil', una por motivo): 5 y 5, 50 % y 50 % , 1 por motivo; coincide con conteo directo; el modo anónimo no aporta.

- **RF-C3-AD-46** — Importante; H6-C3; US7. El sistema deberá mostrar al administrador técnico, para el mismo rango de fechas, por cada modelo habilitado, el número de consultas atendidas, los tokens de entrada y de salida y el costo estimado, y el costo estimado total, a partir de los registros de RF-C3-DI-16.

  **Verificación**: 20 consultas (10 por modelo; 5 en conversación y 5 anónimas por modelo): cifras por modelo y total coinciden con los registros y con el recálculo a mano; incluyen las anónimas.

#### Reindexación y estado

- **RF-C3-AD-47** — Importante; H6-C3; US5. El sistema deberá permitir al administrador técnico iniciar desde el panel una reindexación completa de los documentos publicados, mostrar su estado ('En curso', 'Terminada' o 'Fallida') con hora de inicio y de fin, rechazar el inicio de otra mientras haya una en curso, y mantener las consultas conforme a RNF-C3-IV-02.

  **Verificación**: 3 pruebas: reindexación con consulta cada 30 s, 0 errores y 'Terminada' con las dos horas; fallo a mitad: 'Fallida', notificación y la base anterior responde; segundo inicio durante una en curso rechazado; Gestor denegado.

- **RF-C3-AD-48** — Importante; H6-C3; US5. El sistema deberá mostrar al administrador técnico, en una pantalla de estado del panel, la disponibilidad de cada uno de los dos modelos habilitados con fecha y hora de su último fallo, el estado del reranker y si se aplica el umbral de relevancia, la fecha, hora y resultado de la última ejecución del scraper, y el estado de escritura del registro de interacciones.

  **Verificación**: 5 estados forzados (modelo principal caído, ambos caídos, reranker apagado, scraper con error, escritura del registro fallando): cada uno visible en menos de 60 s; con todo normal lo indica; invisible al Gestor.

#### Interacciones y casos de mejora — H5-C4

- **RF-C4-AD-01** — Esencial; H5-C4; US6. El sistema deberá permitir al administrador técnico consultar en el panel las interacciones registradas en modo conversación, con fecha y hora, categoría, texto de la pregunta, texto de la respuesta, tipo de resultado, documentos citados, modelo y valoración, filtradas por rango de fechas, categoría, tipo de resultado y valoración, con paginación, mostrando los datos personales como están enmascarados en el registro (RF-C3-IN-06) y sin función para editar o borrar interacciones.

  **Verificación**: 30 interacciones (20 en conversación, con cédula, teléfono y correo en 5; 10 anónimas): lista solo las 20 con los 9 datos y datos personales enmascarados; 4 filtros correctos; sin edición ni borrado; el Gestor no ve la sección.

- **RF-C4-AD-02** — Importante; H5-C4; US6. El sistema deberá permitir al administrador técnico exportar en formato .xlsx las interacciones que resulten del filtro aplicado en RF-C4-AD-01, con las mismas columnas y sin identificadores de conversación ni de respuesta.

  **Verificación**: Filtro de 12 de las 20: .xlsx abre en Excel o LibreOffice con 12 filas y columnas de RF-C4-AD-01, sin identificadores y con datos personales enmascarados; el Gestor no puede exportar.

- **RF-C4-AD-03** — Esencial; H5-C4; US6. El sistema deberá crear automáticamente un caso de mejora, en estado 'Registrada', por cada interacción en modo conversación cuyo tipo de resultado sea 'sin información' o cuya valoración sea 'No útil', registrando fecha y hora, categoría, texto de la pregunta, origen y motivo de la valoración cuando exista, y no deberá crear casos a partir de interacciones anónimas.

  **Verificación**: 8 interacciones (2 'sin información', 2 'No útil' con motivos distintos, 1 con ambas, 2 respondidas, 1 anónima 'sin información'): 5 casos con los datos pedidos, el de ambas con los dos orígenes y un solo caso; 0 casos de las otras 3.

- **RF-C4-AD-04** — Esencial; H5-C4; US6. El sistema deberá permitir al administrador técnico avanzar un caso de mejora por los estados 'Registrada', 'En análisis', 'En ajuste', 'Ajustada', 'Validada' y 'Cerrada', en ese orden y sin saltar ni retroceder, asignarle el tipo de fallo (clasificación de RF-C3-VA-04), y deberá exigir el tipo de fallo para pasar a 'En ajuste' y una nota de texto para pasar a 'Cerrada', registrando usuario, fecha y hora de cada cambio.

  **Verificación**: 3 casos recorridos hasta 'Cerrada' con usuario, fecha y hora en cada estado; 6 intentos inválidos (saltar estado, retroceder, 'En ajuste' sin tipo de fallo, cerrar sin nota, 2 con Gestor) rechazados sin cambios.

- **RF-C4-AD-05** — Importante; H5-C4; US6. El sistema deberá mostrar al administrador técnico la lista de casos de mejora con fecha, categoría, origen, tipo de fallo, estado y antigüedad en días, filtrable por estado, tipo de fallo y rango de fechas, y un contador de casos no cerrados visible en todas las pantallas del panel.

  **Verificación**: 6 casos (2 cerrados, uno de 45 días): lista con 6; 3 filtros correctos; contador 4 en 3 pantallas; baja a 3 al cerrar uno; el Gestor no ve la sección.

### Non-Functional Requirements

- **RNF-C3-AD-01** — Exigir autenticación con usuario y contraseña para acceder a cualquier pantalla o servicio del panel, y rechazar con respuesta 401, sin devolver datos, toda solicitud sin sesión válida.

  **Umbral**: 0 pantallas o servicios accesibles sin sesión válida.

  **Verificación**: 8 accesos sin sesión (4 rutas por URL y 4 servicios), 1 con sesión expirada y 1 tras cerrar sesión: los 10 reciben 401 o redirección sin datos; con sesión válida funciona.

- **RNF-C3-AD-02** — Rechazar toda contraseña de menos de 12 caracteres al crear una cuenta o al cambiarla, sin exigir mayúsculas, números ni símbolos, e informar la longitud mínima.

  **Umbral**: Mínimo 12 caracteres; 0 contraseñas menores aceptadas.

  **Verificación**: 6 intentos (3 al crear, 3 al cambiar): una de 11 caracteres, una de 12 solo en minúsculas y una de 12 con mayúsculas y números; las de 11 se rechazan, las de 12 se aceptan.

- **RNF-C3-AD-03** — Almacenar las contraseñas únicamente como resultado de un cifrado unidireccional con sal única por cuenta, con argon2id y parámetros documentados en el manual técnico, sin guardar ni registrar contraseñas en texto plano en la base, los registros técnicos, las notificaciones ni las respuestas del servicio.

  **Umbral**: 0 contraseñas en texto plano; 100 % de cuentas con valor cifrado y sal distinta.

  **Verificación**: 3 cuentas con la misma contraseña: 3 valores distintos con formato argon2id; búsqueda en toda la base; 8 operaciones (inicios, cambio, temporal, procedimiento de RF-C3-AD-13, error forzado) revisando registros, notificaciones y respuestas: 0 coincidencias.

- **RNF-C3-AD-04** — Bloquear el inicio de sesión de una cuenta durante 15 minutos tras 5 intentos fallidos consecutivos, rechazando en ese lapso todo intento con esa cuenta, incluido uno con la contraseña correcta, y reiniciar el contador con cada inicio exitoso. El bloqueo genera la notificación de cuenta bloqueada (cuenta, fecha y hora) de RF-C3-AD-28.

  **Umbral**: 5 intentos; 15 minutos; 0 inicios aceptados durante el bloqueo.

  **Verificación**: Reloj simulado: 5 fallidos y un 6.º correcto rechazado (14 min rechazado, 16 min aceptado); 4 fallidos, 1 exitoso y 4 fallidos sin bloqueo; mensajes idénticos para contraseña errónea, cuenta bloqueada y correo inexistente; aparece la notificación.

- **RNF-C3-AD-05** — Cerrar la sesión de un usuario del panel tras 30 minutos sin ninguna solicitud suya al servidor, y rechazar con 401, sin devolver datos, toda solicitud posterior con esa sesión.

  **Umbral**: 30 minutos; 0 solicitudes aceptadas con sesión vencida.

  **Verificación**: Reloj simulado: a 29 min se acepta; a 31 min 401; una solicitud cada 20 min durante 90 min mantiene la sesión.

- **RNF-C3-AD-06** — Bloquear durante 15 minutos las solicitudes de inicio de sesión del panel provenientes de una IP que acumule 20 intentos fallidos en una ventana deslizante de 15 minutos, contando cualquier cuenta, rechazándolas con 429 y Retry-After sin verificar credenciales, e identificando la IP por el encabezado del proxy, ignorando el del cliente.

  **Umbral**: 20 intentos fallidos por IP en 15 min; bloqueo de 15 min; 0 intentos procesados desde una IP bloqueada.

  **Verificación**: 4 recorridos: 20 fallidos sobre 5 cuentas y un 21.º correcto con 429 (14 min bloqueado, 16 aceptado); 19 fallidos, 1 exitoso y 5 más sin bloqueo; otra IP entra con normalidad; encabezado falsificado no evita el bloqueo.

- **RNF-C3-AD-07** — Entregar a los tableros de RF-C3-AD-43 a RF-C3-AD-46 únicamente cifras agregadas, sin el texto de preguntas ni de respuestas ni identificadores de conversación o de respuesta.

  **Umbral**: 0 textos y 0 identificadores en los servicios de los tableros.

  **Verificación**: 10 consultas con textos e identificadores conocidos; inspección de las respuestas de los 4 tableros y de la pantalla: 0 coincidencias.

- **RNF-C3-AD-08** — Cargar cada pantalla del panel (bandeja, matriz, notificaciones, auditoría y los cuatro tableros) con un percentil 95 de 3 segundos o menos, con 1.000 documentos en la matriz, 100.000 registros de interacciones y 10.000 registros de auditoría.

  **Umbral**: p95 de 3 s o menos por pantalla.

  **Verificación**: En producción (C6) con esos volúmenes simulados: 20 cargas por pantalla, repetidas en 2 días.

- **RNF-C3-AD-09** — Cumplir en todas las pantallas del panel el mismo nivel de accesibilidad de RNF-C4-UI-02 (WCAG 2.1, niveles A y AA).

  **Umbral**: 0 incumplimientos A o AA y 100 % de la lista manual.

  **Verificación**: axe-core en cada pantalla, recorrido completo solo con teclado y revisión con un lector de pantalla.

### Key Entities *(include if feature involves data)*

- **Cuenta y sesión administrativa**: nombre y correo único, perfil técnico o documental, estado activa/desactivada, contraseña protegida, obligación de cambio, actividad y bloqueos; vinculadas a acciones históricas. Rol reservado de recuperación no es otro perfil del panel. RF-C3-AD-05..13; RNF-C3-AD-01..06.
- **Documento y matriz documental**: identidad, tipo/título/dirección/enlace/procedimiento, metadatos opcionales, origen/usuario/fecha, huella, estado y marca de falta de actualización; integra matriz de SPEC001 y versiones pendientes/vigentes. RF-C3-AD-01..04/18..27/32/38/39.
- **Registro de rechazo o retiro**: documento/origen/huella/motivo/actor/fecha/hora; único remanente de contenido eliminado y base para omitir republicación del mismo contenido. RF-C3-AD-22..25.
- **Enlace configurado y propuesta**: URL/dirección/justificación, agregar/quitar, propietario, estado/decisión/motivo/fecha; lista de enlaces distinta de lista de hosts autorizados. RF-C3-AD-14..19/33/34.
- **Notificación**: tipo/objeto/fecha/última ocurrencia/descripción/estado/repeticiones y usuario de revisión; visibilidad por sistema o autor de la carga, sin envío externo. RF-C3-AD-28..31.
- **Contactos oficiales**: tres canales de recepción, tres datos del contacto general y lista ordenada no vacía de inmediatos con descripción≤120; valores vigentes compartidos con SPEC002–005. RF-C3-AD-35..37.
- **Pendiente, operación y auditoría**: documento/propuesta con antigüedad; reindexación/estado de componentes con tiempos; acciones atribuibles y resultado sin contenido/contraseñas, registro inalterable. RF-C3-AD-40/41/47/48.
- **Tarifa y estadística**: precio positivo USD por millón de tokens de entrada/salida/modelo, hasta cuatro decimales y vigencia de guardado; métricas agregadas con rango, sin texto/IDs ciudadanos. RF-C3-AD-42..46; RNF-C3-AD-07.
- **Interacción autorizada y valoración**: datos enmascarados ya registrados, categoría/tipo/citas/modelo/valoración, sin duplicar el registro ni reconstruir texto depurado. RF-C4-AD-01/02; RF-C3-IN-05/06/09; RNF-C3-IN-01.
- **Caso de mejora**: una interacción autorizada elegible, uno/dos orígenes, motivo cuando exista, fecha/categoría/pregunta disponible/REAL/estado y transiciones atribuidas; relacionado, pero no identificado automáticamente, con hallazgo de SPEC006. RF-C4-AD-03..05.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Los 53 RF y 9 RNF tienen evidencia verificable por criterio y versión; cero requisitos Importantes omitidos. Permisos de dos perfiles comprobados y cero funciones/datos administrativos accesibles indebidamente. RF-C3-AD-01..48, RF-C4-AD-01..05, RNF-C3-AD-01..09.
- **SC-002**: Todas las cargas válidas y rechazos de ambos perfiles cumplen sus seis intentos; cero contenido pendiente/derogado/vencido en consultas posteriores; cinco consultas antes/después por documento demuestran publicación y exclusión, con retiro de prueba acreditado. RF-C3-AD-01..04/38.
- **SC-003**: Tres reemplazos exitosos responden solo dato nuevo y conservan cero contenido anterior; tres reemplazos fallidos siguen respondiendo solo dato anterior; cuatro pruebas de reintento/exclusión/notificación completas; cien por ciento de consultas periódicas durante publicación/reindexación sin errores. RF-C3-AD-20/26/27/47; RNF-C3-IV-02.
- **SC-004**: Rechazos/retiros conservan los siete datos exigidos y cero contenido recuperable; tres objetos rechazados y tres retirados no vuelven a pendientes tras dos ejecuciones iguales, mientras una huella modificada sí vuelve. RF-C3-AD-22..25.
- **SC-005**: Catorce enlaces verifican seis permitidos/ocho denegados; cero cambios a lista de hosts desde panel; cambios aprobados/directos efectivos en siguiente ejecución, documentos de enlace quitado conservados con marcas correctas. RF-C3-AD-14..19/33/34.
- **SC-006**: Creación/desactivación/reactivación y temporales cumplen todos los intentos del criterio; siempre al menos un administrador activo, sesiones revocadas no reviven y recuperación afecta solo cuenta solicitada, con control del contratista y auditoría. RF-C3-AD-05..13/41.
- **SC-007**: Cero contraseñas menores de doce caracteres aceptadas ni contraseñas legibles expuestas; cuentas bloqueadas quince minutos tras cinco fallos, IP quince minutos tras veinte en quince, sesión vencida tras treinta minutos de inactividad. Todos los recorridos de reloj/credenciales/falsificación cumplen resultados esperados. RNF-C3-AD-01..06.
- **SC-008**: Ocho tipos de notificación ordenados y contados correctamente; cero envíos externos o avisos ajenos visibles al Gestor; repeticiones mismo objeto se agrupan y revisión se atribuye. Cinco pendientes ordenados por antigüedad y trece cambios auditados completos, cero contraseñas/contenido en auditoría. RF-C3-AD-28..31/40/41.
- **SC-009**: Todos los cambios válidos de los tres grupos de contactos aparecen en salidas ciudadanas sin redespliegue; cero formatos inválidos, canales obligatorios eliminados o lista inmediata vacía; 120 caracteres admitidos y 121 rechazados. RF-C3-AD-35..37.
- **SC-010**: Cinco estados degradados visibles al administrador en menos de sesenta segundos; cada pantalla contractual logra p95≤3 segundos sobre 1.000 documentos/100.000 interacciones/10.000 auditorías, veinte cargas por pantalla en cada uno de dos días en producción identificada. RF-C3-AD-48; RNF-C3-AD-08.
- **SC-011**: Todas las pantallas cumplen cero incumplimientos A/AA y cien por ciento de revisión manual; recorridos completos con teclado y lector no pierden tareas ni información. RNF-C3-AD-09; RNF-C4-UI-02.
- **SC-012**: Cuatro tableros coinciden con conteos/costos esperados en las muestras de 40 consultas, 20 respuestas, 10 valoraciones y 20 consumos; cero textos/IDs en entrega de agregados, anonimato representado únicamente en métricas permitidas y costo anterior sin recálculo tras tarifa nueva. RF-C3-AD-42..46; RNF-C3-AD-07.
- **SC-013**: Lista de interacción muestra veinte autorizadas/cero anónimas, cuatro filtros correctos y exportación de doce filas enmascaradas sin IDs legible en Excel o LibreOffice; cinco casos de ocho interacciones, uno con dos orígenes sin duplicación. RF-C4-AD-01..03.
- **SC-014**: Tres casos recorren los seis estados con responsable y tiempo; seis intentos inválidos rechazados, seis casos listados con contador cuatro→tres al cerrar uno; cero acceso del Gestor y cero cierre de hallazgos/recepciones por simple estado del panel. RF-C4-AD-04/05; RF-C3-VA-04; RF-C4-PR-03.

## Assumptions

### Continuidad y límites

- **Propietarios previos**: SPEC001 aporta matriz/corpus/conversión/OCR/vigilancia/publicación/reindexación; SPEC002 aporta respuestas/modelos/consumo y panel mínimo; SPEC003 flujo ciudadano; SPEC004 presentación/valoración/accesibilidad; SPEC005 registro/anonimato/enmascaramiento/retención/seguridad/contactos; SPEC006 matrices/evidencias/hallazgos/recepción de H5-C3/H4-C4. SPEC007 es dueño del panel administrativo completo y experiencia de H6-C3/H5-C4, reutilizando/corrigiendo estas capacidades, sin cerrar tareas anteriores por referencia.
- **Estado observado**: Se revisaron spec/plan/tareas de los seis directorios y superficies de administración/base existentes. Inventario/marcas son evidencia de trabajo registrado, no aceptación. No se importan los diagnósticos históricos como descripción actual; el plan contrastará cada brecha contra código/pruebas vigentes. Ninguna marca anterior se modifica.
- **Alcance contractual**: Son obligatorios los 62 requisitos completos. Priorización P1/P2 ordena incrementos; no reduce aceptación. No incluye editar prompt/reglas de generación/modelos, ampliar hosts permitidos desde panel, radicar/decidir, nuevos perfiles, correo de notificaciones, recuperación pública de contraseña o nueva analítica no aprobada. Lista de hosts permitidos no autoriza documentos ajenos al alcance de RF-C3-IV-01.
- **Permisos**: Gestor puede cargar, consultar matriz completa en solo lectura/filtro propio, proponer/ver/retirar pendientes propias, revisar avisos propios y cambiar su contraseña. Administrador agrega todas las acciones reservadas. Recuperación fuera del panel es un privilegio de operación reservado al contratista, no un perfil ciudadano/adicional.

### Interpretaciones para integrar sin contradicciones

- **Metadatos y «N/A»**: AD-01/02 define explícitamente opcionales de carga manual y permite mostrarlos ausentes como «N/A», ampliando ese contexto respecto de la matriz inicial de SPEC001. No obliga a eliminar código/versiones disponibles, no cambia los obligatorios originales de documentos extraídos y no sustituye en las citas la fecha de acceso disponible. Procedimiento asociado exige código o «ninguno». Dirección debe pertenecer al catálogo institucional ya aprobado. Enlace público HTTPS es obligatorio; su validación no inventa aprobación del documento.
- **Lista de hosts**: RF-C3-AD-15 fija envigado.gov.co con subdominios por límite de punto, y www.concejoenvigado.gov.co, observatorioenvigado.geotrends.co y ambientometroenvigado.com como hosts exactos. Propuesta/enlace deben cumplir HTTPS y esa lista. Se conserva el catálogo de contenido permitido de SPEC001; admitir host Concejo no carga por sí solo contenido fuera de matriz. Lista de hosts cambia solo con código desplegado.
- **Identidad documental**: Reemplazo aplica mismo código o mismo enlace de origen, conservando referencia del documento y una sola versión publicada tras éxito. Si esas identidades señalaran documentos distintos, no se publica automáticamente ni se destruye contenido por elección arbitraria; se registra incompatibilidad para revisión documental bajo RF-C3-IV-01/11, AD-20/21. Nuevo contenido permanece pendiente hasta resolverla.
- **Eliminación de contenido**: AD-20/22/24 exige borrar versiones/contenido y vectores indicados. La trazabilidad de SPEC006 conserva huellas/fechas/metadatos y evidencia de resultados permitida, no habilita retener copias del documento eliminado para revertir. Una versión vigente se preserva durante preparación/falla y se elimina solo tras éxito de sustitución.
- **Texto de carga original y citas**: Editar metadatos no altera contenido/huella, mantiene alcance y actualiza citas desde la siguiente consulta. Corregir validez de Vencido a futura restablece publicado según AD-39; no publica pendientes ni revive derogados por editar fecha.
- **Bloqueo IP**: Se respeta expresamente el recorrido RNF-C3-AD-06: 19 fallidos, un éxito y cinco posteriores sin bloqueo; el éxito reinicia el conteo pertinente. Bloqueo por IP usa identificación confiable ya definida en SPEC005, no el encabezado arbitrario del cliente. Bloqueo por cuenta conserva mensajes iguales y genera notificación del panel; auditoría sola no sustituye ese aviso.
- **Privacidad de métricas**: Categoría/tipo/valoración provienen de autorizadas; anónimas aportan únicamente total/diario y consumo disponible en registro técnico permitido. Ranking no inventa citas de registros anónimos; indica limitación de cobertura cuando hay consultas anónimas. Sin valoraciones, porcentajes cero. Exportación conserva el filtro real, datos enmascarados y excluye ambos identificadores públicos.
- **Retención de casos y exportaciones**: No se crean copias permanentes del texto fuera del ciclo de depuración SPEC005. Casos de mejora usan únicamente texto autorizado disponible y lo dejan de exponer al vencer su retención; seguimiento/estado/motivos no recuperan contenido purgado. Los casos no nacen del modo anónimo.
- **Estados de mejora y hallazgos**: RF-C4-AD-04 prohíbe retroceder un caso de mejora. Hallazgo de SPEC006 permite reapertura mediante evento; son entidades con relación explícita, no una sola máquina de estados. Un nuevo fallo confirmado se registra en su entidad correspondiente sin retroceder el caso cerrado. Para Validada/Cerrada se conserva comprobación de corrección exigida por constitución IX y validación aplicable; nota y clasificación no reemplazan corrida posterior. El ciclo no amplía el RF con otras acciones administrativas.
- **Protección normativa y recuperación**: RNF-C3-AD-03 exige explícitamente argon2id con sal única; RF-C3-AD-13 exige procedimiento almacenado con correo/contraseña temporal ya cifrada como únicos parámetros y rol reservado del contratista. Son restricciones de la fuente a respetar en el plan, no elecciones nuevas de este spec. Detalles/parámetros de implementación se documentarán en manual técnico; todos los criterios literales permanecen en la extracción.

### Evidencia, dependencias y entrega

- **Verificación completa**: Cada criterio original se conserva en Requirements; términos de herramientas de la fuente se expresan como resultado institucional cuando no cambian la obligación. Las pruebas automatizables se incluirán en plan/tareas; revisión de teclado/lector y desempeño en producción tendrá pasos y evidencia manual explícitos. Se usa la versión identificada y matriz/evidencia de SPEC006 sin presentar recibos sintéticos como aceptación.
- **Ajustes y regresión**: Cambios de base/recuperación/prompt obligan a repetir matriz congelada C3 integrada y ambos modelos de SPEC006; ajustes C3/C4 exigen C4 completo y renovar evidencia invalidada según SPEC006. Se conserva historial y aceptación anterior identificada, no se firma nueva recepción con pruebas obsoletas. Casos de mejora y fallos se clasifican Datos/Recuperación/Modelo antes de corregir, con severidad aplicable.
- **Rendimiento y accesibilidad**: RNF-C3-AD-08 usa entorno de producción identificado como C6, volúmenes simulados contractuales, veinte cargas por cada pantalla contractual repetidas en dos fechas distintas. No se deduce conformidad de ensayos locales ni promedios globales. RNF-C3-AD-09 hereda nivel A/AA de UI-02 para todas las pantallas administrativas, no solo widget; revisión manual completa, teclado/lector y contrastes/zoom aplicables se reutilizan del enfoque SPEC004.
- **Entrega**: H6-C3 incluye panel/mecanismo de actualización, matriz/base mantenibles, configuración de contactos/cuentas y tableros operables con documentación y evidencia por requisito; H5-C4 incluye consulta/exportación de registro autorizado y casos de mejora. No se agregan firmas ni actas específicas de esos hitos que no exige el Bloque 7; las actas H5-C3/H4-C4 de SPEC006 conservan sus propias puertas.
- **Dependencias externas**: Acceso autorizado al entorno de producción, cuentas reales de Municipio/Geotrends, datos sintéticos para pruebas, fuentes/canales oficiales vigentes y revisores de accesibilidad requeridos antes de aceptar verificaciones reales. Si faltan, evidencia queda pendiente; no se fabrican cuentas entregadas ni se ejecuta el procedimiento restringido durante la especificación.
