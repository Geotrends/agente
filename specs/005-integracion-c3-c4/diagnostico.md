# Diagnóstico de continuidad para SPEC005

**Fecha**: 2026-10-10. Revisión de archivos del workspace en `develop`, con modificaciones locales existentes. Este diagnóstico es documental y estático: no ejecutó AWS, cargas, migraciones ni pruebas de aceptación, ni modificó SPEC001–004 o su implementación.

## Fuente y alcance elegidos

La ruta real del PDF compartido es `/Users/geotrends/Desktop/DEV_LAOR/DOCUMENACION_C3_C4.pdf`. La variación del nombre en el nuevo mensaje no identifica otra versión. Se extrajo sección 4.5 completa (páginas impresas 43–55), incluyendo Tabla 9, en [requisitos-pdf.txt](evidencias/requisitos-pdf.txt), con SHA256 del archivo.

Los cuatro specs corresponden a los cuatro primeros bloques. Por continuidad se asigna a SPEC005 el Bloque 5, Integración, hitos H4-C3 y H3-C4: 16 RF+15 RNF enumerados, de los cuales RNF-C3-IN-09 está descartado por el documento. Se requieren 30 requisitos activos íntegros. La tabla de requisitos del [spec](spec.md) conserva los 31 IDs, sus obligaciones, muestras y relación con historias.

## Revisión de los cuatro specs

Se leyeron `spec.md`, `plan.md` y `tasks.md` de cada directorio, junto con contratos y evidencias relevantes. Los conteos incluyen marcas `[X]` y `[x]`, solo en tareas con ID; no cuentan checklists ni ejemplos.

| Spec y responsabilidad | Tareas marcadas / total | Capacidades observadas | Pendientes declarados y consecuencia para SPEC005 |
| --- | --- | --- | --- |
| [001](../001-base-conocimiento-bloque1/spec.md): adquisición, base cerrada, publicación, reindexación | 89/91 | `backend/src/kb/`, `web_scraper/`, migraciones de `kb`, Qdrant por alias y worker separado. [Plan](../001-base-conocimiento-bloque1/plan.md), [tareas](../001-base-conocimiento-bloque1/tasks.md). | T082 validación completa en entorno limpio y T083 tres ingestas productivas<2 h. La existencia del worker no prueba IN-13: faltan medidas simultáneas del Observatorio/Geoportal. |
| [002](../002-diseno-modelo-ia/spec.md): orientación, recuperación, modelos, registro, panel mínimo | 93/100 | Contrato español, sesión técnica, conversación, Bedrock, registros/retención, contactos/avisos/perímetro. [Plan](../002-diseno-modelo-ia/plan.md), [tareas](../002-diseno-modelo-ia/tasks.md). | T092–T098: modelos/matriz/tráfico/carga AWS, revisión real de interfaz/funcional y hallazgos. [Integración local](../002-diseno-modelo-ia/evidencias/aceptacion/integracion-final.md) usa doble de Bedrock; no demuestra inferencia IAM ni latencias reales. |
| [003](../003-diseno-conversacional/spec.md): apertura, consentimiento, categoría, emergencia | 35/36 | Flujo reutilizado por `frontend/chat/StartupFlow.tsx` y estado de sesión del panel. [Plan](../003-diseno-conversacional/plan.md), [tareas](../003-diseno-conversacional/tasks.md). | T035 navegador escritorio/móvil, teclado y lector. Su plan histórico menciona `frontend/src/...`, `/api/contacts/emergency` y flag `autorizo`: no son la forma integrada actual. |
| [004](../004-interfaz-plataforma/spec.md): launcher, panel, presentación, fallos, reinicio, valoración | 77/84 | `frontend/widget/launcher.ts`, `frontend/chat/`, cliente español, renderer, CSP, `backend/src/chat/feedback.ts`, migración 007. [Plan](../004-interfaz-plataforma/plan.md), [tareas](../004-interfaz-plataforma/tasks.md). | T078–T084: instalación de aceptación en portal, cinco entornos reales, accesibilidad manual, servicios reales, hallazgos/informe/handoff. [Matriz](../004-interfaz-plataforma/evidencias/aceptacion/matriz.md): 22/22 con evidencia controlada, 0 real. |

Las marcas no son evidencia independiente de cumplimiento. Los resúmenes originales «0 completos» o «legacy activo» corresponden al inicio de esas features; no se copian como diagnóstico de hoy. El estado presente permite reutilizar una implementación mucho más avanzada.

## Integración que ya existe y se debe conservar

| Capacidad | Evidencia de código revisada | Consecuencia de continuidad |
| --- | --- | --- |
| Montaje de rutas | `backend/src/index.ts`, `routes/chat.ts`, `routes/conversations.ts`, `routes/chatConfig.ts`, `routes/feedback.ts` | Hay una ruta activa de chat español y valoración. No crear API paralela ni volver al selector multivendor. |
| Contrato y aislamiento | `chat/contracts.ts`, `validateRequest.ts`, `conversations.ts`, `handleChat.ts`; contratos de SPEC002 y SPEC004 | Pregunta/historial por pares, IDs de C3 vinculados a sesión técnica, registro confirmado antes de ID respuesta. No convertir sesión técnica en consentimiento. |
| Persistencia | Migraciones `chat/001`–`007`, `chat/records.ts`, `chat/feedback.ts` | Tablas reales: `chat.conversation`, `chat.interaction`, `chat.anonymous_usage` y `chat.valoracion`. Valoración enlaza al `row_id` interno; evitar duplicación por nombres españoles de diseños antiguos. |
| Contactos oficiales | `admin/contacts.ts`, `routes/chatConfig.ts`, `routes/adminContacts.ts` | Un solo registro administrable compartido por orientación/configuración; lectura sin modelo. No crear un catálogo local de teléfonos/correos. |
| Espera y reinicio | `frontend/shared/chatClient.ts`, `chat/queryAttempt.ts`, `sessionReducer.ts`, `ChatContext.tsx` | Plazo cliente de 45 s, pares exitosos, estados y descarte de callbacks. Las pruebas de SPEC005 deben usar esta capacidad existente. |
| Memoria y autorización | `frontend/shared/session.ts`, `shared/consent.ts`, `chat/StartupFlow.tsx` | Token técnico/decisión/conversación son conceptos separados; el contrato objetivo es el de SPEC002/004, no el flag histórico de SPEC003. |
| Incrustación | `frontend/scripts/build-csp.mjs`, `widget/protocol.ts`, `frontend/nginx.conf` | CSP del iframe y protocolo host ya construidos. Verificar cabecera efectiva y bloqueos en móviles reales; no basta una fixture local. |
| Mantenimiento | `chat/retention.ts`, `purgeCli.ts`, servicio `chat-purge` de `docker-compose.yml` | Purga horaria con registro ya disponible. Corregir fidelidad de campos y comprobar dos ejecuciones automáticas, no construir otra purga. |
| Medición | `backend/scripts/eval-di-load.ts`, `scripts/lib/loadRunner.ts`, pruebas DI/UI | Reutilizar herramientas y ampliar evidencias faltantes. Corridas con dobles no aceptan requisitos que exigen producción o AWS real. |

## Hallazgos estáticos a resolver o verificar en el plan

| Hallazgo | Evidencia concreta | Requisito / clasificación y trabajo pendiente |
| --- | --- | --- |
| H005-01: se permite solicitud sin Origin | `chat/perimeter.ts`: condición `if (origin && ...)`; `test/di-integracion/chat-perimeter.test.ts` espera 200 sin Origin. | RNF-C3-IN-04; Fallo de Modelo (Tabla 9: abuso/perímetro). Corregir control y expectativa heredada; integrar preflight y arnés con origen explícito. No modificar protección productiva para permitir pruebas. |
| H005-02: proveedor de credenciales más amplio que el rol exigido | `bedrock/client.ts` usa `fromNodeProviderChain()`; `services/diConfig.ts` rechaza variables de llaves estáticas, pero esa restricción no demuestra exclusividad de la cadena. | RNF-C3-IN-07/08; Fallo de Modelo según Tabla 9. Revisar todos los orígenes de credenciales y limitar a identidad autorizada del servidor; verificar rol/política reales, ausencia de llaves en imagen/configuración y denegaciones. No se afirma que existan secretos. |
| H005-03: depuración elimina otro campo | `chat/retention.ts`: `cited_documents = '[]'::jsonb`; `test/di-integracion/consumption.test.ts` espera lista vacía. | RNF-C3-IN-01 y capacidad de revisión de IN-05; Fallo de Datos. PDF exige borrar textos/IDs y conservar demás campos. Ajustar conservación segura de fuentes y expectativas, sin retener texto ciudadano. |
| H005-04: plazo no abarca toda recepción y finalización | `routes/chat.ts` crea Deadline después del perímetro/cuerpo/sesión; `handleChat.ts` espera carga de conversación, contactos y escrituras sin acotar todas por el plazo; `errors.ts` espera canales antes de enviar. | RF-C3-IN-04 y RNF-C3-IN-02; Fallo de Modelo. Un temporizador de aborto no demuestra error enviado≤40 s desde recepción. Plan debe cubrir lectura, cola, persistencia lenta y construcción de error con medidas de extremo a extremo. |
| H005-05: duración persistida empieza después de cola | `handleChat.ts` asigna `receivedAt = now()` al entrar al caso de uso y calcula duración desde ahí; cola previa está en `routes/chat.ts`. | RF-C3-IN-05, RNF-C3-IN-02; Fallo de Datos para registro y de Modelo para plazo. Alinear recepción/duración con el mismo inicio medido; verificar semántica en cada capa. |
| H005-06: mensajes de intermediario y caché | `frontend/nginx.conf`: errores 502/503/504 locales en formato heredado y sin `Cache-Control: no-store` explícito en esas ubicaciones. | RNF-C3-IN-12 y RF-C4-IN-04; Fallo de Modelo. Verificar cabecera final y salida segura para errores del proxy y de cuerpo; corregir donde falta. Cliente ya trata contenido no interpretable como fallo. |
| H005-07: aviso de fallo no incluye modo explícito | Hook `onRegistryFailureEpisode` en `chat/runtime.ts` notifica texto genérico sin modo; `records.ts` llama hook sin metadatos del modo. | RF-C3-IN-08; Fallo de Datos. Incorporar fecha/hora/modo sin texto, asegurar agrupación y observabilidad cuando también cae la base operativa. |
| H005-08: aislamiento de carga no demostrado | Compose separa worker/backend; `loadRunner.ts` mide chat, no los dos destinos bajo tres condiciones. No se encontró informe real de IN-13 en evidencia revisada. | RNF-C3-IN-13; Salvaguarda, conforme Tabla 9. Planificar 180 medidas con referencia identificada y cargas reales, revisar recursos compartidos según resultados. |
| H005-09: arnés no equivale a toda muestra requerida | `loadRunner.ts` añade texto a la pregunta marcada como larga; eso por sí solo no demuestra que la respuesta sea larga. El resumen no basta para acreditar cada asociación de los 75 registros. | RNF-C3-IN-02/03; brecha de verificación. Seleccionar casos que produzcan respuestas largas válidas y cotejar registros por modo/conversación sin guardar respuestas reales innecesariamente. |

H005-01 y H005-03 contradicen directamente expectativas actuales de pruebas: esas pruebas verdes no acreditan la fuente. Los demás hallazgos son riesgos de integración observados en código o evidencia faltante; deben confirmarse con pruebas dirigidas antes de declarar fallo reproducido en ejecución. No se usó un resultado inventado de prueba dinámica.

## Orden de continuidad para la planificación

1. Congelar inventario de versión, contratos, matriz publicada, configuración y evidencia reutilizable; definir propietario único de cada corrección.
2. Resolver las contradicciones de origen, retención, identidad, plazos y avisos en capacidades existentes, con regresiones automatizadas conforme constitución X.
3. Verificar recorrido autorizado/anónimo, historial, resultado, registro/valoración, contactos/fallos y memoria con servicios de prueba identificados; comprobar perímetro/caché desde entrada pública.
4. Ejecutar aceptación AWS y portal/móviles reales; medir dos días de latencia/capacidad y las 180 muestras de no degradación; completar revisiones manuales.
5. Resolver hallazgos REAL con prioridades de la fuente, repetir matriz correspondiente y consolidar 30 activos+1 descartado. El Bloque 6 conserva su informe/acta global.

Este orden prepara el futuro `plan.md`; no constituye un plan técnico completo ni autoriza implementación por esta invocación.

## Evidencia compartida sin cierres ficticios

- IN-01..08/10, IAM/inyección y latencia/capacidad se solapan con SPEC002. Una corrida válida puede referenciarse en ambos specs si conserva versión, muestras y resultados; no marca por sí misma T092–T098 completas.
- C4-IN-01..06, memoria/incrustación y C3-IN-09/10 se solapan con los 22 casos de SPEC004. Reutilizar evidencia vigente, completando portal/servicios/móviles; no dar por ejecutadas T078–T084.
- Revisiones de apertura/consentimiento/emergencia siguen SPEC003. No se reconstruye su flujo ni se acepta T035 por existencia del componente.
- IN-13 utiliza reindexación de SPEC001 y sus mediciones de disponibilidad; no sustituye T082/T083 ni el umbral propio de ingesta.
- La fecha de las evidencias previas y su hash/cambiosLocales pueden diferir del workspace actual. Antes de aceptarlas se verifica correspondencia de versión o se repite la prueba.

## Estado tras la implementación local (2026-10-10)

Actualización del diagnóstico; el texto anterior se conserva como línea base. El detalle de cada corrección y su prueba está en [`evidencias/aceptacion/hallazgos.md`](evidencias/aceptacion/hallazgos.md).

| Hallazgo | Estado |
| --- | --- |
| H005-01 sin Origin | **corregido y probado** (controlado) |
| H005-02 cadena de credenciales | **corregido y probado** (IMDS simulado); falta verificar el rol y las políticas **reales** |
| H005-03 purga de fuentes | **corregido y probado** (DB real aislada); falta la purga horaria real |
| H005-04 / H005-05 plazo y duración | **corregido y probado** (cuerpo, cola, pool, registro y error acotados) |
| H005-06 nginx y caché | **corregido y probado** con nginx real en Docker local; falta la entrada desplegada |
| H005-07 aviso con modo | **corregido y probado** |
| H005-08 / H005-09 arnés de carga y no degradación | **arnés corregido y probado**; las mediciones reales de dos días y 180 muestras siguen **pendientes** |

La aceptación real (AWS, portal, Geoportal, dispositivos, dos días) **no se ejecutó**: ver [`entorno-real.md`](evidencias/aceptacion/entorno-real.md). Ninguna marca de SPEC001–004 se modificó ni se da por cerrada por esta evidencia.
