# Feature Specification: SPEC005 — Integración C3–C4 y continuidad del Observatorio

**Feature Branch**: `develop` (rama existente; sin hooks de creación de rama)

**Created**: 2026-10-10

**Status**: Validada para planificación; implementación y aceptación pendientes

**Input**: Crear SPEC005 con los requisitos funcionales y no funcionales del documento C3–C4, revisando los cuatro specs parcialmente desarrollados para construir sobre ellos de forma continua y ordenada.

**Fuente**: archivo compartido `DOCUMENACION_C3_C4.pdf` (mencionado ahora como `DOCUMENTACION_C3_C4.pdf`), sección 4.5, páginas impresas 43–55, Bloque 5 / H4-C3 y H3-C4. [Extracto con huella del PDF](evidencias/requisitos-pdf.txt). Se revisaron descripción, plan, tareas y evidencia de SPEC001–004, el código vigente y la constitución 1.0.0; véase [diagnóstico](diagnostico.md).

**Alcance**: Consolidar la integración del servicio de orientación C3, la interfaz ciudadana C4 y el Observatorio, reutilizando lo construido. Se cubren los 16 RF y 14 RNF vigentes del Bloque 5; el decimoquinto RNF, RNF-C3-IN-09, se registra como descartado por la fuente. La cobertura documental es 31/31 IDs; la aceptación exige 30/30 requisitos activos con evidencia. Se incluyen las correcciones de integración, seguridad, privacidad, capacidad y continuidad que requiera esa aceptación.

SPEC001 mantiene la adquisición y publicación documental; SPEC002 la orientación, recuperación, modelos y administración mínima; SPEC003 el flujo inicial; SPEC004 la presentación, apertura y valoración. SPEC005 integra y verifica esas capacidades sin crear rutas ciudadanas alternativas ni registros duplicados. El Bloque 6 (aceptación formal global) y el panel completo del Bloque 7 quedan fuera de este alcance; sus capacidades mínimas ya necesarias siguen siendo dependencias. El PDF aporta requisitos y no autoriza acciones externas.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Conversar con continuidad y una decisión explícita sobre datos (Priority: P1)

Como ciudadano, quiero que mis seguimientos pertenezcan a la conversación que autoricé, y poder preguntar sin que se conserve mi conversación si elijo «No autorizo».

**Why this priority**: Evita mezclar personas, inventar identificadores o convertir una decisión de privacidad en una mera preferencia visual. RF-C3-IN-01/02 y RF-C4-IN-01/02; depende del flujo de SPEC003 y de la integración de SPEC004.

**Independent Test**: Ejecutar el servicio con respuestas controladas e inspeccionar solicitudes, registros y memoria del panel. La prueba del aislamiento puede realizarse sin evaluar la calidad del modelo; el cierre integrado usa el servicio real.

**Acceptance Scenarios**:

1. **Given** una nueva sesión con apertura y aviso de datos, **When** el ciudadano elige «Autorizo», **Then** C3 emite un único identificador de conversación, C4 lo conserva solo en memoria y lo envía en cada consulta; una sesión técnica no sustituye la autorización.
2. **Given** tres conversaciones de tres turnos, **When** se consultan sus resultados, **Then** los nueve declaran el modo y mantienen el identificador de su propia conversación sin mezclas; tres identificadores no emitidos son rechazados.
3. **Given** «No autorizo», **When** se envían cinco consultas, **Then** no se solicita ni emite identificador de conversación o respuesta y no se crea fila de conversación; cada pregunta se envía completa y sin historial.
4. **Given** doce solicitudes de entrada, **When** se procesan ocho válidas y cuatro inválidas, **Then** un historial de quince pares llega reducido a los diez más recientes; pregunta vacía, categoría ajena, par incompleto e historial sin identificador se rechazan indicando el campo, con cero llamadas al modelo y cero registros de interacción.
5. **Given** doce consultas autorizadas, **When** se envía la última, **Then** lleva exactamente los diez intercambios completos previos en orden; las consultas fallidas y los mensajes de apertura no entran en el historial.
6. **Given** seis recorridos de autorización, anonimato, reinicio y recarga, **When** se inspeccionan, **Then** hay una solicitud de identificador por autorización, ninguna en anonimato, identificadores distintos al autorizar de nuevo tras reinicio o recarga y ninguno en almacenamiento del navegador.

### User Story 2 - Recibir respuestas identificables y registrar su utilidad (Priority: P1)

Como ciudadano, quiero leer una respuesta con fuentes verificables y valorar su utilidad cuando quedó registrada. Como responsable del servicio, quiero relacionar respuesta, consumo y valoración sin confundir consultas.

**Why this priority**: Sostiene trazabilidad, revisión de información incorrecta y casos de mejora. RF-C3-IN-03/05/09 y RF-C4-IN-05; reutiliza SPEC002 y SPEC004.

**Independent Test**: Usar respuestas de los cuatro tipos y registros de prueba; cruzar lo mostrado con su registro y enviar valoraciones válidas, inválidas y concurrentes.

**Acceptance Scenarios**:

1. **Given** diez consultas exitosas, seis autorizadas y cuatro anónimas, **When** se reciben, **Then** todas llevan respuesta en Markdown y uno de los cuatro tipos; solo las autorizadas registradas llevan identificador de respuesta único. Las fuentes coinciden con los documentos efectivamente citados y están vacías si el tipo no es «respondida».
2. **Given** ocho consultas autorizadas exitosas, **When** se revisa el registro, **Then** existen ocho registros únicos con los nueve campos exigidos y el consumo de DI-16; identificador y fuentes coinciden con lo entregado, salvo el saneamiento obligatorio del texto persistido.
3. **Given** seis respuestas, **When** se presentan dos con identificador, dos autorizadas sin él y dos anónimas, **Then** solo las primeras permiten valorar; las demás se leen normalmente y no dejan controles de valoración ocultos enfocables.
4. **Given** doce valoraciones, **When** se envían siete válidas y cinco inválidas, **Then** las siete se asocian a su consulta y las otras no se guardan. Se rechazan identificador inexistente, segunda valoración, motivo ausente para «No útil», motivo presente para «Útil» y motivo fuera de lista; no se guarda texto libre. Dos envíos concurrentes nunca crean dos valoraciones para la misma respuesta.

### User Story 3 - Conservar solo los datos permitidos y seguir respondiendo ante fallos del registro (Priority: P1)

Como ciudadano, quiero que se protejan mis datos y que una caída del registro no me prive de orientación. Como operador, quiero conocer la degradación y comprobar la depuración a tiempo.

**Why this priority**: La privacidad y la continuidad son obligatorias incluso cuando falla la persistencia. RF-C3-IN-06/07/08, RNF-C3-IN-01/12 y RNF-C4-IN-01.

**Independent Test**: Realizar consultas con datos sintéticos, forzar fallos de escritura, restablecerla y simular fechas de retención; inspeccionar todos los destinos de registro y el navegador.

**Acceptance Scenarios**:

1. **Given** catorce consultas, nueve con datos personales y cinco sin ellos, **When** se registran, **Then** cédulas, teléfonos y correos quedan como «[CÉDULA]», «[TELÉFONO]» y «[CORREO]» sin apariciones originales; códigos documentales, resoluciones, decretos y fechas se conservan. Las cinco sin datos permanecen idénticas y el saneamiento del registro no modifica la respuesta mostrada.
2. **Given** seis consultas anónimas exitosas, **When** se inspeccionan todos los registros, **Then** existen únicamente sus registros técnicos de consumo, fecha/hora y modo; no aparecen textos, categorías, tipos de resultado, documentos citados, identificadores ni filas de conversación asociadas.
3. **Given** seis consultas con escritura fallida y dos tras recuperación, **When** se atienden, **Then** la orientación sigue entregándose, incluidas cuatro respuestas completas y dos autorizadas sin identificador de respuesta; aparece un solo aviso por episodio y el registro se retoma en el primer éxito. El aviso identifica fecha, hora y modo sin texto ciudadano.
4. **Given** registros de 11 meses y 29 días y de 12 meses y 1 día, **When** se realizan dos depuraciones automáticas consecutivas, **Then** el primero se conserva y el segundo pierde textos e identificadores de conversación/respuesta, conservando los demás campos; ambas ejecuciones quedan registradas y hay cero coincidencias del texto depurado.
5. **Given** tres recorridos en Chrome y Firefox, **When** se oculta/muestra cinco veces, recarga y cierra, **Then** ocultar mantiene completa la conversación, recarga/cierre la pierden y no quedan textos en almacenamiento del navegador, cookies o dirección de la página.
6. **Given** respuesta exitosa, servicio no disponible, valoración y validación, **When** se inspeccionan a través del punto de acceso real, **Then** todas impiden conservar contenido en caché; repetir una consulta que requiere generación provoca dos invocaciones independientes.

### User Story 4 - Obtener una salida a tiempo y canales oficiales vigentes (Priority: P1)

Como ciudadano, quiero que una espera o un fallo termine con una alternativa comprensible y contactos vigentes, sin mostrar errores internos ni respuestas de otra conversación.

**Why this priority**: Una espera indefinida o un canal incorrecto impide acceder al servicio público. RF-C3-IN-04/10 y RF-C4-IN-03/04/06; reutiliza la recuperación de fallos de SPEC004.

**Independent Test**: Controlar demoras y errores del servicio, del registro y de contactos. Inspeccionar tiempos desde recepción/envío, respectivamente, y comprobar cambios de contactos mediante la administración existente.

**Acceptance Scenarios**:

1. **Given** nueve pruebas, **When** ocurren tres validaciones, tres indisponibilidades, dos vencimientos y un error interno, **Then** C3 devuelve el error genérico pertinente en ≤40 s, sin proveedor, modelo, rutas, trazas ni SQL; indisponibilidad deja registro técnico y aviso en el panel sin contenido ciudadano. La caída de búsqueda es indisponibilidad, nunca «sin información»; el fallo del reranker permite la degradación prevista en SPEC002.
2. **Given** cuatro intentos controlados, **When** una respuesta llega a 40 s y otra a 50 s, **Then** la primera se muestra y la segunda produce fallo entre 45 y 46 s; su resultado tardío no se muestra ni entra al historial. Cada reintento tiene plazo propio y el reinicio descarta resultados de la conversación anterior.
3. **Given** seis respuestas fallidas, **When** hay dos validaciones, dos errores internos, una página de error HTTP 502 y un resultado incompleto, **Then** C4 muestra la salida fija de SPEC004 sin código, campo ni mensaje interno, no incorpora esos turnos al historial y solo las validaciones omiten «Reintentar».
4. **Given** tres lecturas del bloque de contactos, **When** se edita el registro desde el panel entre lecturas, **Then** los valores coinciden con el registro vigente, el cambio aparece sin redespliegue, cada lectura tarda ≤2 s y no invoca al modelo.
5. **Given** cuatro recorridos con contactos fallando o restablecidos, **When** se abre el panel, se elige emergencia o se muestra un fallo, **Then** la carga inicial tiene máximo 5 s, se vuelve a solicitar si falta el bloque y los contactos recuperados se muestran. Si siguen faltando aparece «No pudimos cargar los canales de atención. Consulte los canales oficiales del Municipio de Envigado.» con enlace a contacto oficial y sin valores guardados en el chat.

### User Story 5 - Usar un servicio protegido contra abuso y exposición de credenciales (Priority: P1)

Como responsable del servicio, quiero que solo el chat autorizado invoque C3 dentro de límites seguros, con una identidad exclusiva y sin que credenciales o instrucciones maliciosas alteren la orientación.

**Why this priority**: Protege datos, presupuesto y confianza institucional. RNF-C3-IN-04/05/06/07/08/10/11 y RNF-C4-IN-02.

**Independent Test**: Ejecutar la matriz del perímetro con proveedor controlado y contadores de registros; revisar artefactos e invocaciones con identidad real; probar incrustación en orígenes permitidos y ajenos.

**Acceptance Scenarios**:

1. **Given** ocho solicitudes de origen, **When** se envían dos válidas y seis con origen ajeno, subdominio, http, preflight no permitido, sin origen o puerto/ruta añadidos, **Then** solo las dos válidas pasan y las demás reciben 403, sin llamada al modelo ni registro de interacción. CORS permisivo o una sesión técnica no eluden la restricción.
2. **Given** 62 consultas en 30 s desde una IP, **When** se procesan, **Then** 60 pasan y dos reciben 429 con espera indicada; otra IP sigue atendida, falsificar una cabecera no elude el límite y 60 consultas/min durante cinco minutos no reciben 429 al respetar la ventana deslizante.
3. **Given** seis cuerpos de prueba, **When** llegan aproximadamente 100 KB, una pregunta de 20.000 caracteres, 131.072 bytes, 131.073 bytes y 5 MB con/sin longitud declarada, **Then** los tres primeros válidos se atienden y los demás reciben 413 sin llamada al modelo ni registro; la memoria no crece por acumular los cuerpos rechazados.
4. **Given** identidad exclusiva del servidor AWS, **When** se invocan ambos modelos habilitados, **Then** funciona sin llaves estáticas en repositorio, imagen, variables o configuración. Al retirar el rol aparece indisponibilidad y aviso sin secretos; tercer modelo, listado, lectura de bucket y consulta de claves ajenas son denegados, con política limitada a la única acción de invocación y los dos modelos de la región configurada.
5. **Given** ocho escenarios de confidencialidad con proveedor controlado, **When** se fuerzan cuatro fallos, dos éxitos y un reinicio y se revisan código y paquete ciudadano, **Then** no aparecen credenciales temporales ni encabezados de autorización en registros, errores, avisos, interacciones o navegador.
6. **Given** nueve inyecciones, tres en pregunta, tres en historial falso y tres en fragmentos de prueba, **When** se generan respuestas, **Then** no se revela el prompt, no hay orientación sin respaldo ni fuera de alcance y se mantiene la leyenda obligatoria.
7. **Given** seis pruebas de incrustación, **When** se usan dos páginas oficiales, tres orígenes ajenos y se inspecciona la política del panel, **Then** solo se permite el origen oficial; los bloqueos de dominio ajeno, subdominio y http también se comprueban en Safari iOS y Chrome Android.

### User Story 6 - Atender demanda sin degradar el Observatorio ni el Geoportal (Priority: P1)

Como ciudadano y usuario del Observatorio, quiero que Geobot responda a tiempo incluso con otras consultas o mantenimiento, y que el mapa y las consultas del Geoportal sigan operando.

**Why this priority**: La aceptación exige capacidad medida y continuidad del producto anfitrión, no solo pruebas aisladas del chat. RNF-C3-IN-02/03/13; depende de la reindexación de SPEC001 y la inferencia de SPEC002.

**Independent Test**: Ejecutar una versión identificada en el entorno requerido, con base publicada y modelos reales. Medir por separado consultas secuenciales, oleadas y destinos del Observatorio/Geoportal con referencia fija.

**Acceptance Scenarios**:

1. **Given** cien consultas secuenciales en producción, cuarenta simples, treinta medias y treinta complejas, incluidas diez con historial de diez pares y diez de respuesta larga, **When** se repite en dos días distintos, **Then** cada día tiene p95≤20 s para respuesta completa y ninguna consulta supera 40 s sin devolver error.
2. **Given** tres oleadas de 25 consultas simultáneas separadas por dos minutos, **When** cada oleada combina quince consultas autorizadas de cinco conversaciones y diez anónimas y la prueba se repite en dos días, **Then** cada oleada tiene cero errores y p95≤20 s; por día hay 75 registros sin pérdida ni mezcla, con registro autorizado o técnico según el modo.
3. **Given** una página del Observatorio y una consulta de referencia del Geoportal, **When** se toman treinta muestras por destino sin carga, treinta durante una reindexación completa y treinta durante una oleada de 25 consultas, **Then** hay cero errores y el p95 de cada destino bajo cada carga no supera el 120 % de su propio p95 sin carga.

### Edge Cases

- Identificador sintácticamente válido pero no emitido, ajeno o depurado: se rechaza y no habilita historial ni valoración.
- Respuesta escrita cuya confirmación de valoración no llegó: no se afirma que se guardó ni se permite una segunda valoración persistida.
- Reinicio o recarga durante envío, lectura, creación de conversación o valoración: no aparecen efectos tardíos sobre la sesión nueva; ocultar conserva la sesión.
- Falla prolongada o lentitud del registro/contactos: la salida ciudadana debe respetar el plazo completo, y los avisos no deben almacenar el texto perdido ni repetirse por cada consulta.
- Vencimiento durante lectura del cuerpo o antes de generar el error: se mantiene el máximo desde recepción; no basta medir solo generación.
- Error producido por un intermediario antes de llegar a C3: conserva protección contra caché y C4 lo trata como fallo seguro aunque sea ilegible.
- JSON válido de tamaño límite con caracteres multibyte y transmisión sin longitud: se mide en bytes, sin truncar preguntas por número de caracteres.
- Sesión técnica expirada: no se reenvía automáticamente una consulta autorizada como anónima ni se restaura identificador viejo tras el nuevo flujo de datos.
- Valoración concurrente con depuración: no se enlaza a una respuesta ya eliminada; se conservan estadísticas no identificables permitidas.
- Fallo de escritura del aviso por caída de la misma persistencia: el episodio debe hacerse observable al recuperarse sin retener texto ciudadano ni notificar por un canal externo.
- Rate limit y pruebas de carga: la preparación no consume la cuota de consultas; la aceptación no relaja el límite ni crea pérdidas o resultados favorables artificiales.
- Producción compartida con otros servicios: las tres condiciones se comparan sobre versión, destinos y configuración identificados; una medición local no demuestra la no degradación real.

## Requirements *(mandatory)*

### Functional Requirements

Todos son esenciales según el PDF. Cada fila es normativa y se verifica con la historia y criterio indicados.

| ID fuente | Obligación observable | Historia / criterio |
| --- | --- | --- |
| RF-C3-IN-01 | C3 es el único emisor de identificadores de conversación UUID v4, tras solicitud por autorización. Cada éxito declara «conversación» con su identificador o «anónima» sin él. Rechaza todo identificador no emitido. | US1.1–3; 3×3 turnos, 5 anónimas y 3 IDs no emitidos. |
| RF-C3-IN-02 | Acepta pregunta obligatoria, identificador y categoría opcionales («Ecosistemas», «Bienestar Animal», «Gestión Ambiental») e historial opcional por pares completos; conserva solo los últimos 10. Pregunta vacía, categoría inválida, par incompleto e historial sin ID producen validación con campo y sin invocación ni registro. | US1.4; 12 solicitudes: 8 válidas/4 inválidas, historial 15→10. |
| RF-C3-IN-03 | Cada éxito lleva Markdown con citas, tipo «respondida», «sin información», «fuera de alcance» o «aclaración», y una fuente por documento citado según DI-08 con identificador/nombre/enlace/fecha. Fuentes vacías si no es «respondida». Solo conversación registrada lleva UUID v4 de respuesta ligado a su fila. | US2.1; 10 consultas: 6 autorizadas/4 anónimas. |
| RF-C3-IN-04 | Devuelve «VALIDACION» con campo, «SERVICIO_NO_DISPONIBLE» por doble fallo de modelos/búsqueda excepto reranker o «ERROR_INTERNO», con mensaje genérico sin detalles internos en ≤40 s desde recepción. La indisponibilidad genera registro técnico y aviso en panel sin texto ciudadano. | US4.1; 9 pruebas: 3/3/2 tiempos/1 interno. |
| RF-C3-IN-05 | Cada éxito autorizado deja un registro único: fecha/hora, IDs de conversación/respuesta, categoría, pregunta, respuesta completa, tipo, documentos citados y duración en ms; más modelo efectivo, tokens de entrada/salida y costo estimado de DI-16. Identificador/fuentes coinciden con la entrega. | US2.2; 8 consultas/8 registros completos. |
| RF-C3-IN-06 | Antes de persistir, reemplaza cédulas/teléfonos/correos de pregunta y respuesta con etiquetas exactas según RNF-C3-DI-01; preserva códigos, resoluciones/decretos y fechas, sin alterar por esa operación la entrega a C4. | US3.1; 14 consultas: 9 con datos/5 sin datos. |
| RF-C3-IN-07 | Cada éxito anónimo deja solo consumo de DI-16, fecha/hora y modo; no guarda texto, categoría, tipo, documentos ni identificadores ni fila de conversación. | US3.2; 6 consultas, cero coincidencias de texto en toda la base. |
| RF-C3-IN-08 | Entrega orientación aunque falle el registro y omite ID de respuesta; avisa en panel en el primer fallo con fecha/hora/modo sin texto, agrupa el episodio y retoma registro al primer éxito. | US3.3; 6 fallos/2 recuperadas, 1 aviso. |
| RF-C3-IN-09 | Guarda una sola valoración asociada a la respuesta: «Útil» sin motivo o «No útil» con uno de los cinco motivos cerrados de UI-06. Rechaza ID inexistente, duplicado o motivo indebido, sin texto libre. | US2.4; 12 envíos: 7 válidos/5 inválidos. |
| RF-C3-IN-10 | Ofrece lectura del mismo registro vigente de DI-19/20/24: atención inmediata, PQRSD, WhatsApp, correo y contacto general, sin generación. Edición del panel visible sin redespliegue. | US4.4; 3 lecturas≤2 s, cero llamadas al modelo. |
| RF-C4-IN-01 | Solicita ID a C3 solo con «Autorizo», conserva/envía en memoria; con «No autorizo» lo omite. No genera IDs, los descarta al reiniciar/recargar. | US1.1/3/6; 6 recorridos con tráfico/almacenamiento. |
| RF-C4-IN-02 | Envía últimos 10 pares completos en orden con autorización; omite historial en primera pregunta y anonimato. Fallos no son pares completos. | US1.5; 3 recorridos: 12 autorizadas, anónimo y fallo. |
| RF-C4-IN-03 | Espera máximo 45 s por intento, cancela al vencer y descarta resultado tardío sin mostrarlo ni incorporarlo a historial; reintento tiene plazo propio. | US4.2; 4 pruebas 40 s/50 s/reintento/reinicio. |
| RF-C4-IN-04 | Validación, error interno y cuerpo no interpretable producen salida fija de UI-08 sin código/campo/mensaje técnico; validación sin «Reintentar». | US4.3; 6 pruebas: 2 validaciones/2 internos/502 HTML/estructura incompleta. |
| RF-C4-IN-05 | Solo respuestas con ID de respuesta muestran valoración; las demás se leen sin controles visibles u ocultos enfocables. | US2.3; 6 respuestas: 2 con ID/2 autorizadas sin ID/2 anónimas. |
| RF-C4-IN-06 | Solicita contactos al abrir (≤5 s); si faltan, repite al elegir emergencia y mostrar fallo UI-08. Sin bloque, muestra texto fijo y enlace oficial; sin contactos guardados en el ChatBot. | US4.5; 4 pruebas de caída y recuperación. |

### Non-Functional Requirements

| ID fuente | Obligación y umbral | Historia / criterio |
| --- | --- | --- |
| RNF-C3-IN-01 | Depuración automática antes de 12 meses+24 h desde recepción: elimina textos e IDs de conversación/respuesta y conserva demás campos; registra cada ejecución. | US3.4; 11 m 29 d conservado/12 m 1 d depurado, 2 ejecuciones. |
| RNF-C3-IN-02 | Respuesta completa desde recepción hasta entrega, una consulta a la vez, p95≤20 s; ninguna supera 40 s sin error. | US6.1; 100 consultas/día en producción, mezcla 40/30/30, 10 con 10 pares y 10 largas, 2 días. |
| RNF-C3-IN-03 | 25 consultas simultáneas exitosas, cero errores, p95≤20 s y registro de todas sin pérdidas/mezclas. | US6.2; 3×25/día, pausas 2 min, 15 de 5 conversaciones+10 anónimas, 2 días. |
| RNF-C3-IN-04 | Solo acepta Origin explícito en lista configurable del dominio del chat; ajenos y ausentes reciben 403 sin invocación ni registro. | US5.1; 8 solicitudes, 2 válidas y 6 rechazos. |
| RNF-C3-IN-05 | Máximo 60 consultas/min/IP en ventana deslizante de 60 s; exceso 429 con Retry-After sin invocación/registro. IP del proxy confiable, no cabecera falsificada. | US5.2; 62 en 30 s, otra IP, falsificación, 5 min sin 429 al respetar límite. |
| RNF-C3-IN-06 | Cuerpo máximo 131.072 bytes, por longitud declarada o lectura; exceso 413 sin invocación/registro, sin límite separado de caracteres. | US5.3; 6 cuerpos incluido 20.000 caracteres y 5 MB con/sin longitud, sin crecimiento por acumular carga rechazada. |
| RNF-C3-IN-07 | Credenciales únicamente del rol IAM del servidor AWS; cero llaves estáticas o credenciales en código/repositorio/imagen/variables/configuración. | US5.4; escaneo y 2 modelos reales con rol; retiro→indisponibilidad/aviso sin secretos. |
| RNF-C3-IN-08 | Identidad IAM exclusiva, una acción de invocación permitida sobre solo los 2 modelos de RNF-C3-DI-02 en región configurada; toda otra acción denegada, política sin comodines. | US5.4; 2 invocaciones válidas/4 acciones o recursos ajenos denegados. |
| RNF-C3-IN-09 | **Descartado por el PDF**: no se implementa rotación de llaves cada 90 días porque se usa rol, no llaves estáticas. Conserva trazabilidad hacia IN-07/08. | Revisión documental; excluido de 30 requisitos activos, sin declararlo implementado. |
| RNF-C3-IN-10 | Cero credenciales temporales o autorización de Bedrock en cualquier registro, aviso, error o respuesta ciudadana. | US5.5; 8 escenarios: 4 fallos/2 éxitos/1 reinicio/1 revisión código y paquete. |
| RNF-C3-IN-11 | Instrucciones en pregunta/historial/fragmentos son datos: mantienen DI-04/09/20, sin revelar prompt, sin orientación sin respaldo ni fuera de alcance y con leyenda. | US5.6; 9 casos: 3 por superficie. |
| RNF-C3-IN-12 | Toda respuesta de consulta/valoración, incluidos errores e intermediarios, lleva Cache-Control: no-store. | US3.6; 4 clases inspeccionadas, repetir consulta generada=2 invocaciones. |
| RNF-C3-IN-13 | Observatorio y consulta de referencia Geoportal sin errores, p95 bajo reindexación completa y bajo 25 consultas≤1,2×p95 propio sin carga. | US6.3; 30 muestras×2 destinos×3 condiciones=180. |
| RNF-C4-IN-01 | Texto/historial solo en memoria volátil del iframe; cero entradas en localStorage, sessionStorage, IndexedDB, cookies o URL; recarga/cierre lo pierden, ocultar conserva. | US3.5; 3 recorridos en Chrome y Firefox, 5 ciclos. |
| RNF-C4-IN-02 | Incrustación solo desde https://observatorioenvigado.geotrends.co mediante frame-ancestors; bloquea otro dominio, subdominio y http. | US5.7; 6 pruebas y bloqueos también en Safari iOS/Chrome Android. |

### Key Entities *(include if feature involves data)*

- **Decisión de datos**: elección explícita del ciudadano; diferencia conversación autorizada y consulta anónima. La sesión técnica es un control de acceso separado.
- **Conversación autorizada**: identificador emitido por C3, decisión asociada y turnos de esa sesión; el panel solo conserva su representación en memoria.
- **Intercambio completo**: pregunta y respuesta válida en orden; historial máximo de diez para la siguiente consulta autorizada.
- **Resultado ciudadano**: modo, texto, tipo y fuentes; identificador de respuesta solo si existe registro autorizado confirmado.
- **Registro de interacción**: campos de IN-05 saneados y consumo; su depuración elimina los textos e identificadores exigidos conservando las estadísticas y demás campos permitidos.
- **Registro técnico anónimo**: fecha/hora, modo, modelo efectivo, tokens de entrada/salida y costo, sin contenido ni vínculo ciudadano.
- **Valoración**: vínculo con una interacción registrada, elección y motivo cerrado cuando corresponde; una por respuesta, sin texto libre.
- **Bloque de contactos**: único registro oficial administrable compartido por lectura, orientación, emergencia y salida de fallos.
- **Episodio de degradación**: fecha/hora, modo afectado y estado sin texto; agrupa fallos y permite observar recuperación.
- **Evidencia de integración**: caso, requisito, versión/configuración/base identificadas, entorno, resultados y hallazgos; distingue comprobación controlada de aceptación real.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100 % de los casos de US1 mantiene decisión e identidad correcta: nueve turnos sin mezcla, cinco anónimas sin IDs, tres IDs falsos rechazados, ocho entradas válidas y cuatro inválidas sin generación/registro; la consulta 12 lleva diez pares.
- **SC-002**: Las diez respuestas de US2.1 tienen tipos/fuentes correctos; ocho registros coinciden con sus entregas; solo dos de las seis respuestas de US2.3 ofrecen valoración; siete valoraciones válidas persisten y cinco inválidas no, con cero duplicados concurrentes.
- **SC-003**: Catorce casos de saneamiento cumplen íntegramente, seis anónimos dejan cero textos/vínculos; seis fallos de escritura no impiden la entrega, producen un solo aviso de episodio y los dos éxitos posteriores recuperan el registro.
- **SC-004**: Los dos controles de retención y las dos ejecuciones automáticas cumplen 12 meses+24 h y conservan demás campos; tres recorridos por navegador mantienen cero textos persistidos y cinco ciclos sin pérdida; cuatro clases de respuesta impiden caché y repetir generación invoca dos veces.
- **SC-005**: Las nueve salidas fallidas de C3 se entregan en ≤40 s sin datos internos; los cuatro controles de plazo de C4 y seis de errores cumplen US4.2/3 sin resultados tardíos visibles ni turnos fallidos en historial.
- **SC-006**: Tres lecturas oficiales responden en ≤2 s sin generación, reflejan edición sin redespliegue; los cuatro casos de carga/recuperación cumplen espera inicial≤5 s y salida oficial sin contactos inventados.
- **SC-007**: Las ocho solicitudes de origen y seis de tamaño cumplen exactamente sus decisiones; el exceso de cuota no genera ni registra consultas y una IP independiente sigue atendida. Cero elusiones por cabecera falsificada y cero acumulación de cuerpos rechazados.
- **SC-008**: Los dos modelos funcionan con rol exclusivo; las cuatro acciones/recursos ajenos resultan denegados; cero credenciales expuestas en los ocho escenarios y cero llaves estáticas encontradas. El retiro de rol produce indisponibilidad observable.
- **SC-009**: Nueve de nueve inyecciones conservan respaldo, alcance y leyenda sin revelar instrucciones; solo el origen oficial incrusta el panel y se comprueban bloqueos en ambos navegadores móviles reales.
- **SC-010**: Cada una de las dos corridas diarias de cien consultas secuenciales alcanza p95≤20 s para entrega completa y ningún silencio>40 s; se conserva mezcla y cantidades sin excluir casos lentos o fallidos del informe.
- **SC-011**: Las seis oleadas totales de 25 consultas alcanzan cada una p95≤20 s con cero errores; sus 150 registros, 90 autorizados y 60 anónimos, están completos según su modo, sin pérdidas ni mezclas.
- **SC-012**: Las 180 muestras de Observatorio/Geoportal producen cero errores y cada destino bajo cada una de las dos cargas tiene p95≤120 % de su referencia sin carga.
- **SC-013**: Hay evidencia completa para 30/30 requisitos vigentes y constancia documental de uno descartado, sin atribuir cumplimiento real a simulaciones. Todo hallazgo bloqueante está corregido y vuelto a verificar; los requisitos compartidos enlazan una misma evidencia identificada sin cerrar automáticamente tareas previas.

## Assumptions

- **Continuidad por bloques**: Se interpreta SPEC005 como Bloque 5 porque SPEC001–004 corresponden a Bloques 1–4. No se amplía al panel completo ni a la aceptación global; todos los requisitos activos de integración son obligatorios.
- **Base de partida revisada**: El diagnóstico registra 89/91 tareas marcadas en SPEC001, 93/100 en SPEC002, 35/36 en SPEC003 y 77/84 en SPEC004. Esas marcas y archivos no prueban aceptación real. Los diagnósticos originales describen el pasado; prevalece evidencia del código y corrida identificados.
- **Reutilización y corrección**: Se conservan las responsabilidades previas; una brecha de integración se corrige en la capacidad existente y se vuelve a verificar. El plan debe asignar un propietario de corrección y una referencia de evidencia compartida; no se crean implementaciones paralelas ni se cambian marcas anteriores solo para cuadrar conteos.
- **Consentimiento**: SPEC003 usa una descripción histórica de autorización booleana. La integración respeta la decisión explícita y la emisión de conversación ya acordadas en SPEC002/004; la ausencia de identificador determina el modo anónimo y nunca admite historial.
- **Saneamiento separado**: La protección antes de enviar al proveedor permanece a cargo de RNF-C3-DI-01. IN-06 se refiere al registro y no debe añadir modificaciones a la entrega ciudadana; se preserva el comportamiento de orientación de SPEC002.
- **Depuración fiel al PDF**: Se retiran textos e IDs a los doce meses, conservando los demás campos, incluidos documentos citados sin contenido personal. Si un campo remanente contiene texto ciudadano o secretos, debe resolverse el saneamiento conforme la fuente antes de persistir; no se impone un borrado adicional de estadísticas por comodidad.
- **Avisos de registro**: Se debe poder observar el primer fallo y su modo sin almacenar texto, incluso si la persistencia operativa también falla; no se añaden notificaciones por correo ni servicios externos.
- **Dos dominios distintos**: La lista de origen de consultas corresponde al dominio desde el que se sirve el ChatBot. La autorización de incrustación corresponde exclusivamente al Observatorio oficial. Los entornos de prueba deben estar identificados y separados de la configuración productiva; la protección de producción no se amplía para hacer pasar fixtures.
- **Casos de frontera**: «Historial de 15» se recorta sin error; «sin identificador» con historial es inválido. «Sin información», «fuera de alcance» y «aclaración» son éxitos que pueden completar un intercambio y registrarse; no equivalen a fallo técnico.
- **Muestras**: Los diez casos con historial y diez largos pertenecen a las cien consultas diarias sin alterar la mezcla 40/30/30. Las 75 consultas diarias de capacidad son tres oleadas independientes, no una sola carga continua. «Dos días» exige fechas distintas.
- **Ambigüedad de conteo de RNF-C3-IN-10**: La fuente enumera ocho escenarios y agrupa revisión de código/paquete como el último; se conserva esa agrupación. El título del criterio de IN-01 se entiende como nueve turnos de tres conversaciones más los casos anónimos e inválidos, según las cantidades explícitas.
- **Dependencias reales**: El cierre exige versión/configuración identificadas, matriz documental publicada, contactos/política vigentes, dos modelos con rol IAM en el entorno AWS, acceso al Observatorio/Geoportal y navegadores móviles reales. La falta de cualquiera deja el caso pendiente y no modifica su umbral.
- **Regresión y aceptación**: Cambios en prompt, recuperación o base obligan a repetir la matriz congelada completa de SPEC002 en ambos modelos; cambios de integración repiten sus casos afectados y la batería integrada. Evidencia firmada del hito global pertenece al Bloque 6. Este comando crea especificación y diagnóstico; no ejecuta implementación, cargas productivas ni despliegue.
