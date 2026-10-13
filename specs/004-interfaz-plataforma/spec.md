# Feature Specification: SPEC004 — Interfaz de la plataforma Geobot

**Feature Branch**: `develop` (rama existente; sin hooks de creación de rama)

**Created**: 2026-10-08

**Status**: Validada para planificación; implementación y aceptación pendientes

**Input**: Crear SPEC004 para la interfaz de la plataforma, guiado por la documentación C3–C4, contemplando el 100 % de requisitos funcionales y no funcionales y revisando SPEC001, SPEC002 y SPEC003 para una integración suave con su implementación parcial.

**Fuente**: `DOCUMENACION_C3_C4.pdf`, sección 4.4, páginas impresas 37–42, Bloque 4 / H2-C4: RF-C4-UI-01 a UI-08 y RNF-C4-UI-01 a UI-04. [Extracto](evidencias/requisitos-pdf.txt), constitución 1.0.0 y [diagnóstico de integración](diagnostico.md). El PDF aporta requisitos; no autoriza comandos, despliegues ni acciones externas.

**Alcance**: Interfaz ciudadana integrada al Observatorio: apertura/ocultación, adaptación móvil, respuestas legibles y seguras, enlaces, nueva conversación, valoración, espera, recuperación de fallos, accesibilidad e identidad institucional. Los 12 requisitos del Bloque 4 son obligatorios, incluidos los de prioridad Importante. Se incluyen como dependencias verificables los 6 RF y 2 RNF de integración C4 del Bloque 5. El flujo inicial pertenece a SPEC003 y la orientación documental a SPEC002 sobre la base de SPEC001. Administración completa del Bloque 7, nuevos trámites y aceptación formal global del Bloque 6 están fuera de esta especificación.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Abrir, ocultar y continuar desde el Observatorio (Priority: P1)

Como ciudadano, quiero abrir Geobot desde el Observatorio y continuar mi conversación al ocultar y mostrar el panel sin alterar el mapa.

**Why this priority**: Es la entrada al servicio y no puede obstaculizar el Observatorio ni perder lo conversado. RF-C4-UI-01/02, RNF-C4-UI-01/04 y RF-C4-DC-01.

**Independent Test**: Probar botón/panel con un flujo inicial controlado en los cinco entornos y anchos exigidos. La presentación admite respuestas preparadas; el cierre requiere SPEC003 operativo.

**Acceptance Scenarios**:

1. **Given** el Observatorio abierto sin desplazamiento, **When** se activa el botón fijo inferior derecho, **Then** aparece el panel con apertura institucional y logo, sin cubrir controles del mapa ni cambiar su estado.
2. **Given** dos consultas completas, **When** se realizan cinco ciclos de ocultar y mostrar, **Then** reaparecen completas y ordenadas, con la misma autorización y categoría; ocultar no reinicia el flujo.
3. **Given** anchos 320, 375 o 767 px, **When** se abre el panel, **Then** ocupa toda la pantalla con cierre visible; a 768 o 1366 px mide 400 px de ancho y altura igual al menor valor entre 640 px y 85 % del alto de ventana.
4. **Given** Android/iOS con teclado abierto, **When** se escribe, **Then** el campo permanece visible y utilizable, sin desplazamiento horizontal del panel.
5. **Given** tres cargas con caché vacía, **When** no se ha activado el botón, **Then** solo se descarga el script de apertura de hasta 10 KB desde Geobot; primera activación carga panel/recursos y las siguientes no lo recargan.

### User Story 2 - Comprender respuestas y consultar fuentes con seguridad (Priority: P1)

Como ciudadano, quiero leer pasos, tablas y prosa con teclado o lector de pantalla, y consultar fuentes en otra pestaña sin perder la conversación.

**Why this priority**: La información oficial debe ser legible y segura para todos. RF-C4-UI-03/04, RNF-C4-UI-02/03 y RF-C3-DI-07/10/25.

**Independent Test**: Mostrar nueve respuestas preparadas, diez respuestas con cita, el aviso de datos y cargas maliciosas; revisar estructura y navegación a 320 px sin generación en vivo.

**Acceptance Scenarios**:

1. **Given** tres respuestas en pasos, tres tablas y tres en prosa, **When** se presentan, **Then** no quedan símbolos de formato sin interpretar; se conservan orden, texto y citas, y el lector anuncia listas y encabezados de columnas.
2. **Given** una tabla ancha a 320 px, **When** se consulta, **Then** se desplaza en su propio contenedor sin desplazar horizontalmente el panel.
3. **Given** enlaces de respuesta, política o canales, **When** se abren con ratón/toque/teclado, **Then** abren otra pestaña, muestran indicador visual externo y nombre accesible con «(se abre en una pestaña nueva)», y conservan mapa/conversación.
4. **Given** diez respuestas maliciosas y tres consultas con marcado, **When** se muestran, **Then** no se ejecuta código; las respuestas conservan solo contenido permitido y las consultas aparecen como texto plano.
5. **Given** cualquier estado, **When** se recorre con teclado, lector de escritorio/móvil o zoom 200 %, **Then** todas sus funciones y contenido son accesibles, con foco visible y predecible.

### User Story 3 - Saber que Geobot trabaja y recuperarse de un fallo (Priority: P1)

Como ciudadano, quiero saber cuándo Geobot busca, recibir una salida ante un fallo y reintentar la misma pregunta sin escribirla de nuevo.

**Why this priority**: Evita consultas duplicadas, espera indefinida y abandono sin alternativas. RF-C4-UI-07/08 y RF-C4-IN-03/04/06.

**Independent Test**: Simular demora, indisponibilidad, desconexión, tiempo vencido, respuesta inválida y recuperación con contactos controlados.

**Acceptance Scenarios**:

1. **Given** una consulta enviada, **When** empieza la espera, **Then** en ≤500 ms aparece indicador animado «Geobot está buscando en la información institucional…», anunciado sin mover foco; campo/envío deshabilitados hasta respuesta o fallo.
2. **Given** indisponibilidad, desconexión o tiempo vencido, **When** se informa fallo, **Then** aparece «En este momento no puedo responder. Puede intentarlo de nuevo o comunicarse por los canales oficiales.», los tres canales precargados y «Reintentar», sin valoración ni detalles técnicos.
3. **Given** fallo recuperable, **When** se reintenta, **Then** se reenvía la consulta y contexto originales válidos sin añadir intentos fallidos al historial; tras dos reintentos fallidos desaparece el control y permanecen mensaje/canales.
4. **Given** un intento que supera 45 s, **When** vence, **Then** entre 45 y 46 s aparece el fallo y se descarta cualquier respuesta tardía; cada reintento tiene plazo propio y ninguna respuesta antigua aparece en conversación nueva.
5. **Given** validación, error interno o respuesta no interpretable, **When** llega el resultado, **Then** se muestra el mensaje fijo sin código/campo/mensaje interno; solo validación omite «Reintentar».
6. **Given** contactos no disponibles, **When** se abre panel, se elige emergencia o se muestra fallo, **Then** se aplican solicitudes y salida alternativa de IN-06, sin contactos inventados ni guardados en Geobot.

### User Story 4 - Iniciar una conversación nueva conscientemente (Priority: P2)

Como ciudadano, quiero empezar de nuevo tras confirmarlo o cancelar sin perder nada.

**Why this priority**: Separa consultas y decisiones de privacidad; es obligatorio aunque se desarrolle después del acceso/lectura. RF-C4-UI-05, RF-C4-DC-01/02/03 y RF-C4-IN-01/02.

**Independent Test**: Seis recorridos con dos consultas previas: dos autorizados con reinicio, dos no autorizados con reinicio y dos cancelaciones, incluyendo teclado.

**Acceptance Scenarios**:

1. **Given** una conversación, **When** se activa «Nueva conversación» en encabezado, **Then** aparece «¿Desea iniciar una conversación nueva? La conversación actual dejará de mostrarse.» con «Iniciar nueva» y «Cancelar».
2. **Given** diálogo abierto, **When** se cancela, **Then** se cierra sin modificar conversación, autorización, categoría o solicitud en curso; foco vuelve al control de apertura.
3. **Given** cualquier modo de datos, **When** se confirma, **Then** desaparece historial visible, se descartan contexto/identificador anteriores, se repiten apertura → datos → categoría y primera consulta lleva cero intercambios previos.
4. **Given** solicitud anterior pendiente, **When** se confirma reinicio, **Then** su resultado o fallo tardío no altera la nueva conversación ni su espera.

### User Story 5 - Valorar una respuesta sin compartir texto adicional (Priority: P2)

Como ciudadano que autorizó el tratamiento, quiero indicar si una respuesta fue útil y elegir un motivo cuando no lo fue.

**Why this priority**: Aporta evidencia de mejora sin pedir datos adicionales. RF-C4-UI-06 y RF-C4-IN-05; depende de registro confirmado e identificación por C3.

**Independent Test**: Diez respuestas autorizadas identificadas (cinco útiles y cinco no útiles, una por motivo), tres no autorizadas y seis variantes de IN-05.

**Acceptance Scenarios**:

1. **Given** respuesta autorizada con identificador de C3, **When** se elige «Útil», **Then** se registra una valoración asociada, aparece «Gracias por su valoración» y sus controles quedan deshabilitados.
2. **Given** esa misma condición, **When** se elige «No útil», **Then** se exige un único motivo: «Información incorrecta», «Información desactualizada», «No responde mi pregunta», «Difícil de entender» u «Otro», sin texto libre.
3. **Given** «No autorizo», respuesta sin identificador o mensaje de fallo, **When** se presenta, **Then** contenido normal visible sin controles de valoración, elementos ocultos enfocables ni registro de valoración.
4. **Given** envío duplicado o fallo de registro, **When** se procesa valoración, **Then** no crea una segunda ni anuncia éxito sin confirmación; el fallo se comunica accesiblemente y la respuesta sigue disponible.

### Edge Cases

- Exactamente 768 px aplica escritorio. Cambios de orientación/tamaño conservan sesión y ajustan cierre/campo.
- Ocultar durante espera conserva intento/plazo; reabrir no reenvía. Recargar/cerrar página destruye memoria; ocultar el panel la conserva.
- Reiniciar con consulta/configuración/valoración pendientes impide que resultados antiguos repueblen historial o alteren controles y consentimiento nuevos.
- «No autorizo» permite transcripción visible solo en memoria mientras existe el panel; nunca la envía como contexto ni la persiste/enlaza con identificadores. Distinguir historial visible de historial enviado.
- Respuesta autorizada sin identificador por fallo de registro se muestra normalmente sin valoración; nunca fabricar identificadores.
- Doble clic, teclado y reintento concurrentes producen un único intento activo. Máximo un envío inicial más dos reintentos manuales; ocultar no reinicia ese contador.
- Respuesta a 40 s se muestra si válida; a 50 s se descarta. Fallos/duplicados/tardías no forman intercambios completos.
- Contactos precargados y C3 caído: usar snapshot sin nueva solicitud. Sin snapshot: aplicar IN-06 con enlace oficial, sin números/correos de reserva.
- Enlaces inseguros, marcado malicioso y atributos de eventos se eliminan sin ejecución; respuestas normales conservan formato permitido.
- Botón/panel deben convivir con controles del mapa y áreas seguras móviles manteniendo anclaje inferior derecho.
- Fallo de valoración no reenvía pregunta ni se contabiliza como fallo de consulta; preservar respuesta y evitar valoración duplicada tras recuperar servicio.

## Requirements *(mandatory)*

### Functional Requirements

IDs y prioridades originales. Todos obligatorios; cada verificación es futura, no un resultado ya obtenido.

| ID | Prioridad | Obligación completa | Verificación exigida |
| --- | --- | --- | --- |
| RF-C4-UI-01 | Esencial | Disponible en `https://observatorioenvigado.geotrends.co/observatorio` por botón fijo inferior derecho: activa panel en iframe; nueva activación lo oculta conservando conversación. | US1: Chrome/Firefox/Edge escritorio, Chrome Android, Safari iOS. En los cinco botón visible sin desplazar ni cubrir mapa; apertura DC-01; dos consultas y cinco ciclos conservan conversación completa/ordenada. |
| RF-C4-UI-02 | Esencial | <768 px: pantalla completa con cierre visible. ≥768 px: inferior derecho, ancho 400 px, altura menor entre 640 px y 85 % de ventana. | US1: 320/375/767/768/1366 px, dimensiones correctas, sin desplazamiento horizontal del panel; campo visible con teclado Android/iOS. |
| RF-C4-UI-03 | Esencial | Convertir Markdown a contenido semántico; pasos en listas ordenadas, viñetas en no ordenadas, tablas con encabezados de columna. Tabla ancha se desplaza en contenedor propio. | US2: nueve respuestas (tres pasos/tablas/prosa), sin símbolos de Markdown visibles; marcado contractual del PDF, lector anuncia elementos y encabezados; tabla a 320 px no desplaza panel. |
| RF-C4-UI-04 | Esencial | Todo enlace de respuesta/mensaje fijo abre otra pestaña, con indicador externo y nombre accesible «(se abre en una pestaña nueva)»; preserva Observatorio/conversación. | US2: diez respuestas con citas más aviso de datos, escritorio/móvil, ratón/toque/teclado; 100 % de enlaces cumple apertura, indicaciones y protección de pestaña exigida por PDF. |
| RF-C4-UI-05 | Importante | «Nueva conversación» en encabezado y diálogo literal de US4. Confirmar borra historial visible/envío previo y repite DC-01/02/03; cancelar no modifica conversación. | US4: seis recorridos con dos consultas: dos autorizados/reinicio, dos no autorizados/reinicio y dos cancelación; texto exacto, orden, cero historial en primera consulta y diálogo con teclado. |
| RF-C4-UI-06 | Importante | «Útil»/«No útil» bajo respuesta elegible, una valoración por respuesta; motivo único entre cinco de US5 para «No útil», sin texto libre. Asociar identificador; registro confirmado muestra «Gracias por su valoración» y deshabilita controles. Elegibilidad IN-05/consentimiento. | US5: diez autorizadas (cinco útiles/cinco no útiles, una por motivo), identificación/motivo correctos, ninguna segunda valoración, teclado/lector; tres no autorizadas sin controles ni registros. |
| RF-C4-UI-07 | Esencial | Durante envío→respuesta/fallo, indicador animado con texto literal US3 anunciado sin mover foco; campo/envío deshabilitados y habilitados al finalizar. | US3: cinco consultas con demora cinco segundos y una fallida; indicador ≤500 ms, ninguna solicitud adicional, anuncio sin mover foco, desaparición y campo habilitado en los seis casos. |
| RF-C4-UI-08 | Esencial | Indisponibilidad/tiempo/desconexión: mensaje literal US3 más PQRSD/WhatsApp/correo del bloque precargado administrable sin consultar C3 para obtenerlos. Reintentar misma consulta; ocultar control tras dos reintentos fallidos, conservar mensaje/canales. | US3: seis pruebas (dos por causa), texto/valores exactos, ninguna llamada extra por contactos disponibles, reintento original, límite dos, respuesta tras recuperar servicio, fallo sin valoración. |

### Non-Functional Requirements

| ID | Categoría | Restricción completa | Verificación exigida |
| --- | --- | --- | --- |
| RNF-C4-UI-01 | Desempeño | Antes de primera activación solo script de apertura ≤10 KB desde Geobot; iframe y recursos desde primera activación. | US1: tres cargas con caché vacía; cero solicitudes al dominio del ChatBot salvo script antes de clic; después carga iframe; posteriores clics no lo recargan. |
| RNF-C4-UI-02 | Accesibilidad | WCAG 2.1 A/AA en botón, iframe y todo panel: apertura/datos/categorías/emergencia/respuestas/citas y controles/diálogos/estados. Contraste ≥4,5:1 texto; ≥3:1 controles/texto grande. | Todas las historias: revisión automática en cada estado con cero incumplimientos A/AA; 100 % lista manual; teclado completo, lector de escritorio y móvil, zoom 200 % sin pérdida. |
| RNF-C4-UI-03 | Integridad | Solo elementos permitidos por PDF: párrafos, saltos, énfasis, listas, tablas, encabezados nivel 3/4 y enlaces exclusivamente https. Eliminar otros elementos/eventos/esquemas antes de mostrar. Consultas como texto plano, sin interpretar marcado. | US2: diez respuestas maliciosas y tres consultas HTML/Markdown; cero ejecución y elementos/atributos ajenos; formato normal conservado. Lista exacta del extracto vinculante. |
| RNF-C4-UI-04 | Identidad | Colores/familia tipográfica/logo del Observatorio en botón y panel. Guía con hexadecimales y nombres de fuentes; encabezado logo junto a «Geobot». | US1/US2: 100 % colores/fuentes documentados y coincidentes con estilos oficiales; diez elementos y encabezado inspeccionados, sin combinaciones que incumplan contraste. |

**Precisiones contractuales de presentación**: RF-C4-UI-03 exige `<ol>`, `<ul>` y `<table>` con `<th scope="col">`. RF-C4-UI-04 exige `target="_blank"` y `rel="noopener noreferrer"` en cada enlace. RNF-C4-UI-03 permite únicamente `p`, `br`, `strong`, `em`, `ul`, `ol`, `li`, `table`, `thead`, `tbody`, `tr`, `th`, `td`, `h3`, `h4` y `a` (solo https) en el contenido de la respuesta. La envoltura de interfaz no amplía esta lista de contenido. Son condiciones literales de aceptación del PDF, no decisiones de stack.

### Dependencias obligatorias de integración C4

Complementan los 12 UI y deben verificarse; no dan por implementado Bloque 5 ni trasladan persistencia del C3 al navegador.

| ID | Comportamiento necesario | Aceptación integrada |
| --- | --- | --- |
| RF-C4-IN-01 | Solicitar ID al C3 solo con «Autorizo», conservar en memoria/enviar en consultas; omitir con «No autorizo», descartar al reiniciar/recargar; no generar en cliente. | Seis recorridos: una solicitud y mismo ID autorizado, cero solicitudes anónimas, ID distinto tras reinicio/recarga, cero IDs en almacenamiento del navegador. |
| RF-C4-IN-02 | Autorizado: hasta diez últimos intercambios completos cronológicos; primera consulta/anónima sin historial; fallida no entra. | Tres recorridos: doce autorizadas, duodécima exactamente diez pares; ninguna anónima con historial; fallida excluida. |
| RF-C4-IN-03 | Máximo 45 s por intento, cancelar al vencer y descartar tardías. | Cuatro pruebas: a 40 s visible; a 50 s fallo entre 45–46 s sin respuesta/historial tardíos; reintento con límite propio; no aparece resultado antiguo en conversación nueva. |
| RF-C4-IN-04 | VALIDACION/ERROR_INTERNO/no interpretable siguen UI-08 sin código/campo/mensaje interno visibles; VALIDACION sin reintento. | Seis pruebas: dos validaciones sin reintento, dos internas con reintento, una HTTP 502 con página de error y una respuesta estructurada incompleta; sin datos técnicos/historial fallido. |
| RF-C4-IN-05 | Valoración solo con ID de respuesta; sin ID mostrar texto normalmente. Prohibir valoración anónima/DC-02. | Seis respuestas: dos identificadas con valoración enviada, dos de conversación sin ID de respuesta, dos anónimas; últimas cuatro sin controles ni ocultos enfocables. |
| RF-C4-IN-06 | Solicitar contactos al abrir panel (máximo 5 s). Si faltan, repetir al elegir emergencia y al mostrar fallo. Mientras faltan: «No pudimos cargar los canales de atención. Consulte los canales oficiales del Municipio de Envigado.» con enlace oficial de contacto, sin valores guardados en ChatBot. | Cuatro pruebas del PDF: incluir recuperación antes de emergencia y caída en ambos momentos; canales vigentes o mensaje/enlace según disponibilidad, código sin teléfonos/correos de reserva. |
| RNF-C4-IN-01 | Texto/historial solo memoria volátil del iframe; cero escritura en almacenamiento de navegador/cookies/URL; recargar/cerrar página los pierde, ocultar no. | Tres recorridos en Chrome/Firefox, inspección y revisión de código; cero texto persistido, cinco ciclos conservan conversación. |
| RNF-C4-IN-02 | Incrustación únicamente desde `https://observatorioenvigado.geotrends.co`; rechazar ajenos/subdominios/http. | Seis pruebas: dos válidas, tres bloqueadas (ajeno/subdominio/http), una inspección de política; repetir bloqueos Safari iOS/Chrome Android. |

**Servicio de valoración dependiente (RF-C3-IN-09)**: Recibir ID de respuesta, «Útil»/«No útil» y motivo obligatorio exclusivamente para «No útil», entre los cinco motivos aprobados; guardar asociado al registro de consulta. Rechazar con VALIDACION y cero escrituras un ID inexistente, segunda valoración, motivo ausente/indebido o fuera de lista; nunca guardar texto libre. Verificar doce envíos: siete válidos cruzables con el registro y cinco inválidos sin filas, con texto adicional no guardado. Esta dependencia tiene que completarse para aceptar UI-06; no está cubierta por el alcance de implementación actual de SPEC002.

**Servicio de contactos dependiente (RF-C3-IN-10)**: Tres llamadas deben acreditar valores idénticos al registro, nuevo valor tras editar en panel sin redespliegue, cero invocaciones al proveedor y respuesta en ≤2 s. La limitación a un único origen de incrustación se verificará mediante la directiva contractual `frame-ancestors` en la respuesta que sirve el iframe (RNF-C4-IN-02).

### Key Entities *(include if feature involves data)*

- **Sesión del panel**: apertura, decisión de datos, categoría, mensajes visibles, contactos y solicitud actual; volátil, conservada al ocultar, destruida al recargar/cerrar página.
- **Conversación autorizada**: ID de C3, política aceptada y pares completos permitidos; reinicio descarta vínculo local sin borrar registros institucionales previos.
- **Respuesta**: orientación, tipo, fuentes e ID opcional tras registro confirmado; distinta de mensajes fijos/fallos.
- **Fuente**: nombre, enlace y fecha validados por C3; interfaz no inventa documentos/fechas.
- **Intento**: pregunta/contexto válidos, espera/plazo y contador de reintentos; fallida no crea intercambio completo.
- **Valoración**: respuesta identificada, útil/no útil y único motivo cuando aplica; una por respuesta, sin texto libre, solo autorizado.
- **Contactos**: recepción, general e inmediatos administrados institucionalmente; no generados por modelo ni fijados por interfaz.
- **Guía de estilo**: colores, fuentes y logo del Observatorio con combinaciones accesibles.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Los 12 UI pasan íntegramente verificaciones originales y ocho dependencias C4 pasan aceptación integrada sobre versión identificada; ningún Importante excluido.
- **SC-002**: En cinco entornos, apertura sin desplazarse ni tapar mapa y dos consultas conservadas en cinco ciclos; cinco anchos cumplen dimensiones y teclado móvil sin desbordamiento.
- **SC-003**: Nueve respuestas con estructura correcta y 100 % enlaces de diez respuestas con cita más aviso abren otra pestaña conservando mapa/conversación en escritorio/móvil.
- **SC-004**: Cero incumplimientos A/AA, 100 % revisión manual aprobada; tareas completas con teclado, lectores escritorio/móvil y zoom 200 %, cumpliendo contrastes.
- **SC-005**: Seis ensayos de espera con indicador ≤500 ms, cero envíos adicionales y entrada recuperada. Seis fallas UI-08 con mensaje/canales; reintento conserva pregunta y desaparece tras dos fallos.
- **SC-006**: Seis recorridos reinicio/cancelación cumplen texto, decisión y orden: reinicio sin historial, cancelación idéntica; cero resultados tardíos en conversación nueva.
- **SC-007**: Diez valoraciones registradas una vez por respuesta correcta, cubriendo cinco motivos; tres no autorizadas y variantes sin identificación no permiten valorar; cero duplicados/éxitos sin confirmación.
- **SC-008**: Tres cargas descargan únicamente apertura ≤10 KB antes de activación; ocultar no recarga. 100 % colores/fuentes coincide con guía/Observatorio, verificado en diez elementos y encabezado.
- **SC-009**: Diez cargas maliciosas con cero ejecución/contenido prohibido; tres preguntas con marcado como texto plano; respuestas normales conservan estructura.
- **SC-010**: Recorridos de privacidad con cero textos/IDs de conversación en almacenamiento persistente; duodécima consulta autorizada envía diez pares completos; ninguna anónima envía historial.
- **SC-011**: Cuatro pruebas de tiempo descartan tardías tras fallo entre 45–46 s; seis errores no muestran datos técnicos; cuatro casos de contactos muestran canales vigentes o salida oficial según disponibilidad.
- **SC-012**: Seis pruebas de incrustación permiten solo origen oficial; tres orígenes indebidos bloqueados también en Android/iOS. Evidencia distingue pruebas controladas de integración real.

## Assumptions

- **Interpretación de plataforma**: Bloque 4 cubre la interfaz ciudadana completa; no implica construir las 48 funciones administrativas. Pantallas mínimas planificadas en SPEC002 permanecen allí.
- **Estado de partida**: [Diagnóstico](diagnostico.md) revisa spec/plan/tareas y código. SPEC001: 89/91 tareas marcadas, T082/T083 pendientes; SPEC002: 5/100 con componentes parciales adicionales sin cierre; SPEC003: 0/27. Marcas/archivos aislados no acreditan aceptación integral. Preservar cambios locales.
- **Coordinación**: SPEC002 controla generación, fuentes, privacidad/persistencia, contactos, identificación y errores; SPEC003 apertura → datos → categoría y emergencia sin modelo. SPEC004 presenta ese mismo flujo, sin segundo consentimiento, bienvenida o conversación paralela.
- **Contrato coherente**: Antes de integrar, planificación debe reconciliar artefactos SPEC003 con contrato ciudadano SPEC002 y rutas realmente disponibles. Discrepancias de campos, historial y contactos constan en diagnóstico; no asumir compatibilidad ni dar por implementado lo planificado. No selección ciudadana de proveedor/modelo.
- **Valoración**: Servicio de registro y unicidad aún pendiente. RF-C3-IN-09 y RF-C3-IN-03/05/07/08 son dependencias de UI-06; usar IDs auténticos de C3 y registro protegido por consentimiento. Ruta/formato se define en planificación; no simular persistencia para cierre.
- **Plazos/reintentos**: C3 ≤40 s (RF-C3-IN-04), interfaz 45 s independientes (C4-IN-03). Solo «Reintentar» inicia hasta dos intentos adicionales de generación con pregunta/contexto previos al fallo; no reintento automático oculto ni duplicación de turno.
- **Contactos**: C3 entrega bloque ≤2 s (RF-C3-IN-10); panel espera ≤5 s (C4-IN-06). Bloque disponible se reutiliza para fallo; ausente aplica IN-06. Enlace de salida oficial es configuración institucional autorizada, no teléfono/correo de reserva. Cada nueva carga obtiene datos vigentes; administración pertenece a SPEC002/Bloque 7.
- **Identidad**: No inventar logo/colores/fuentes; planificación obtendrá estilos oficiales con versión identificada. Falta de evidencia o conflicto de contraste debe resolverse antes de aceptar RNF-UI-04, manteniendo ambas obligaciones.
- **Presentación contractual**: Marcado semántico, lista de elementos y apertura segura del PDF son requisitos, no elecciones de tecnología. Instrumentación se decide en plan; verse bien o evitar ejecución no basta si quedan elementos prohibidos.
- **Privacidad**: Ocultar conserva sesión; reiniciar descarta estado local sin borrar registros previos. «No autorizo» permite solo transcripción visible volátil, sin contexto enviado, registros, categoría persistida o valoraciones. Recargar/cerrar página destruye memoria.
- **Entrega y evidencia**: Interfaz integrada, guía de estilo, verificaciones de 12 UI/dependencias y registro de valoraciones/casos de mejora según consentimiento. Relación requisito → caso → evidencia → versión antes de cierre. Simulaciones permiten desarrollo independiente, pero no reemplazan base publicada, C3 y flujo inicial reales.
- **Validación**: Automatizar verificaciones posibles; registrar pasos manuales de navegadores reales, teclado, lectores, mapa/estilos oficiales. Hallazgos Datos/Recuperación/Modelo según tabla 7; cambios relevantes requieren repetir matriz completa. RF-C4-PR-01/03/04 y constitución IX/X guían evidencia/regresión; aceptación formal H4-C4 corresponde a Bloque 6.
- **Fases siguientes**: Esta ejecución genera spec, diagnóstico y checklist. `$speckit-plan` y `$speckit-tasks` deberán contemplar implementación/pruebas de todos los requisitos y dependencias; MVP o demostración no declara hito completo.
