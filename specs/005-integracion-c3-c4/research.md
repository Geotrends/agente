# Research: SPEC005 — Integración C3–C4

**Fecha**: 2026-10-10. Investigación de fase 0 sobre workspace, PDF y documentación primaria. Se despacharon tres agentes de investigación según la habilidad: seguridad, datos/plazos y aceptación. No editaron código ni ejecutaron AWS/cargas. Todas las decisiones de diseño están resueltas; accesos/destinos/rol reales son prerequisitos de ejecución identificados, no funcionalidades por inventar.

## R1 — Reutilizar capacidades y contratos actuales

**Decision**: Una API española, las tablas reales y el iframe de SPEC002/004; SPEC005 corrige y verifica integración sin reinstalar SPEC003 en rutas históricas. Evidencia compartida con versión/caso/corrida, no marcas automáticas en tareas anteriores.

**Rationale**: [Diagnóstico](diagnostico.md):89/91, 93/100, 35/36, 77/84 tareas marcadas, con aceptación real pendiente. Es más fiel que diagnósticos iniciales de specs previos. RF-C3-IN-01..10/RF-C4-IN-01..06 y constitución IX.

**Alternatives considered**: API nueva, tablas españolas duplicadas o tomar una prueba verde anterior como aceptación completa: contradicen continuidad y trazabilidad.

## R2 — Origin y CORS antes de cualquier efecto

**Decision**: Guard de origen exacto obligatorio para POST ciudadanos y sus OPTIONS antes del CORS global. Rechazos 403 sin interacción/modelo; preflight válido 204 no consume cuota. Configuración productiva acepta orígenes HTTPS serializados exactos (`URL.origin === valor`), sin ruta/query/fragmento/credenciales/comodines; fixtures localhost separados. GET de configuración mismo origen puede omitir Origin, no crea conversación ni genera. Sesión técnica mantiene protección independiente.

**Rationale**: RNF-C3-IN-04. Código actual permite ausencia de Origin y su prueba la considera válida; `cors()` global responde OPTIONS antes del guard. Origin es una política HTTP, no prueba criptográfica de que cliente es un navegador. [Documentación Express CORS](https://expressjs.com/en/resources/middleware/cors/) explica manejo de preflight y alcance de CORS.

**Alternatives considered**: Solo CORS, aceptar ausencia para facilitar scripts, obligar Origin en GETs del mismo origen o ampliar lista con dominio padre: no cumplen el contrato o rompen carga legítima.

## R3 — IP de confianza y cuota de consultas

**Decision**: Parsear y validar TRUST_PROXY; preferir direcciones/subredes exactas de proxies identificados y backend interno. Si se usan saltos, convertir explícitamente a número y comprobar todas las rutas de llegada. Ventana deslizante existente cuenta solo POST consulta: sesión/conversación/config/valoración y OPTIONS usan controles independientes sin restar los 60 turnos.

**Rationale**: RNF-C3-IN-05. Código actual comparte `chatWindow` y pasa un string a `app.set('trust proxy',...)`. Express da semántica diferente a número y string: [proxies Express](https://expressjs.com/en/guide/behind-proxies/).

**Alternatives considered**: Confiar en cualquier X-Forwarded-For, aumentar cuota durante pruebas o agregar IP a consumo anónimo: incumplen fuente/privacidad.

## R4 — Identidad exclusiva de instancia EC2

**Decision**: Sustituir default chain por proveedor explícito `fromInstanceMetadata`, con timeout/reintentos acotados y renovación administrada; IMDSv2 obligatorio en EC2, conectividad/hop limit verificados desde contenedor. Rechazar configuración de llaves/bearer keys/perfiles/procesos/proveedores alternos; no montar `.aws`. Dobles solo en arnés.

**Rationale**: RNF-C3-IN-07/08/10. `fromNodeProviderChain()` admite más fuentes que el rol aunque se rechacen dos variables. [AWS cadena de credenciales](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/setting-credentials-node.html), [proveedor IMDS](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-config/Function/fromInstanceMetadata1/), [opciones de instancia](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-instance-metadata-options.html). Revisar export instalado en implementación; no asumir otra versión de SDK.

**Alternatives considered**: Perfil local/SSO/proceso o sesión temporal exportada a variables en runtime: no prueban credenciales exclusivas del servidor; ECS sería otra arquitectura fuera de alcance.

## R5 — IAM concreto sin comodines

**Decision**: Para Converse sin streaming, permitir solo `bedrock:InvokeModel` en dos ARN foundation-model de región configurada (actual us-east-1). Revisar todas las políticas adjuntas/inline y límites, no solo un documento. Registrar dos éxitos y cuatro denegaciones reales. Mantener RNF-C3-IN-09 descartado.

**Rationale**: RNF-C3-IN-08. [AWS Converse](https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html) identifica permiso InvokeModel. El contrato [runtime-security](contracts/runtime-security.md) fija recursos, sin inventar `bedrock:Converse`.

**Alternatives considered**: BedrockFullAccess, Resource*, streaming/perfiles cross-region o rotar llaves: amplían permisos o contradicen descarte.

## R6 — Presupuesto desde recepción hasta entrega

**Decision**: Crear RequestContext antes de body/session/cola: fecha UTC y reloj monotónico común; plazo único≤40000 ms, objetivo operativo 39000 ms con 1000 ms para finalización. Propagar cancelación/presupuesto a lectura, auth, pool, conversación, búsqueda, modelo, registro y error. Contactos no pueden retrasar rechazo. SQL con timeouts por presupuesto, adquisición acotada y cleanup/rollback; no Promise.race que deja trabajo vivo. Cliente conserva 45000 ms desde envío hasta lectura/validación; nginx proxy_request_buffering off para que lectura lenta alcance el plazo del backend.

**Rationale**: RF-C3-IN-04/05, RNF-C3-IN-02 y RF-C4-IN-03. Deadline nace tarde y receivedAt aún después de cola; statement_timeout fijo no acota pool/error. Esta corrección no cambia generación ni tiempo contractual. [Nginx proxy](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_request_buffering) documenta buffering; comprobar comportamiento efectivo en imagen/entrada real.

**Alternatives considered**: Medir solo LLM, aumentar plazo, cortar en frontend únicamente o abandonar escrituras tardías sin observar resultado: no cumplen entrega integral ni ID confirmado.

## R7 — Retención exacta y anonimato por allowlist

**Decision**: Conservar cited_documents y demás campos cuando se vacían textos/UUID públicos; mantener FK interna de valoración y row_id. Seis campos anónimos exactos ya existentes. Metadata documental persistida debe provenir de catálogo publicado, sin consultas/secretos dentro de nombre/URL. Ninguna tabla de diagnóstico añade IDs, hashes o IP a anónimas.

**Rationale**: RF-C3-IN-05/06/07, RNF-C3-IN-01. Código y test borran fuentes pese a «conservando los demás campos». No reescribir migraciones aplicadas; modificar purga/tests y agregar migración solo si falta constraint/tabla operativa nueva.

**Alternatives considered**: Borrar fila, borrar todas las fuentes o conservar UUID para estadísticas: pierden campos exigidos o mantienen identificador ciudadano.

## R8 — Episodio operativo separado de revisión del aviso

**Decision**: Hook tipado fechaHora/modo y episodio operativo independiente de conversación. Primer fallo emite un aviso; fallos continuos no repiten; primer éxito cierra episodio, restaura estado y drena metadatos pendientes de forma serializada. Nuevo episodio genera aviso nuevo aun si el anterior sigue no revisado. Reusar Operations y su buffer seguro; no retener texto para reparar registro. Fallo de búsqueda/doble modelo deja evento técnico mínimo además de aviso.

**Rationale**: RF-C3-IN-04/08 y constitución VI. Código no transporta modo ni restaura estado; agrupación tipo+objeto y drenaje concurrente pueden mezclar episodios. Eventos operativos identifican fallo del servicio, no consulta/ciudadano. Estado volátil se pierde al morir proceso: no se promete recuperación de texto o exact-once atravesando una caída total de proceso/base.

**Alternatives considered**: Un aviso por consulta, webhook/correo, reintento de escritura con texto en disco o usar ID ciudadano como agrupación: no cumplen privacidad y canal permitido.

## R9 — Caché y contrato seguro de intermediarios

**Decision**: no-store temprano para todas las rutas de consulta/valoración y rechazos, y `always` en cada ubicación nginx efectiva de API/errores 413/502/503/504. Errores propios del proxy usan catálogo genérico; no interceptar indiscriminadamente errores JSON del backend. Escaneo de fuga por allowlist de logging sin imprimir coincidencias.

**Rationale**: RNF-C3-IN-12/10, RF-C4-IN-04. Named locations con su propio add_header no heredan otros; [Nginx headers](https://nginx.org/en/docs/http/ngx_http_headers_module.html) describe herencia/always. Fixture Node de Playwright no acredita cabeceras nginx.

**Alternatives considered**: Solo no-store del éxito, confiar en cabecera superior o preservar errores legacy: faltan rutas de fallo y trazabilidad.

## R10 — Carga con muestras efectivas y conciliación segura

**Decision**: Corregir loadRunner existente:10 solicitudes autorizadas con 10 pares efectivos; 10 respuestas largas respaldadas (convención del arnés≥700 tokens visibles, sin alterar tope 2200); oleadas con 15 autorizadas de 5 conversaciones+10 anónimas. Preparar tokens/conversaciones antes de medir y validar forma/modo/IDs/cuerpo completo. Medir todos los casos, errores incluidos; p95 por día/oleada. Conciliar registros autorizados por IDs solo en evidencia de acceso restringido con datos sintéticos; anónimos por multiset de seis campos y ventana exclusiva sin tráfico ajeno, sin nuevo ID persistido.

**Rationale**: RNF-C3-IN-02/03, RF-C3-IN-05/07. Hoy runWaves todo anónimo; solo 5 de 10 marcos envían historial; HTTP200 no valida resultado. La definición de respuesta larga es convención de prueba visible, no requisito añadido al producto; debe fijarse en manifiesto antes de corrida.

**Alternatives considered**: Alargar pregunta, promediar oleadas/días, excluir lentas, conciliar por conteo global o agregar traceId anónimo: falsean muestra o privacidad.

## R11 — No degradación real y medidas solapadas

**Decision**: Añadir runner offline hostRunner/eval-di-host:30 muestras/destino/condición, registrar método/URL de referencia sanitizada, configuración y tiempos completos; demostrar solapamiento con reindexación y oleada 25. Si no cabe toda muestra en oleada, crear ventanas de carga adicionales equivalentes identificadas sin alterar las tres oleadas obligatorias de capacidad. Comparar cada destino con su propia referencia; errores/plazo/cuerpo inválido fallan.

**Rationale**: RNF-C3-IN-13:180 muestras. Separación de worker no demuestra no degradación; requiere referencia Geoportal elegida según instalación oficial y actividad real. [SPEC001 plan](../001-base-conocimiento-bloque1/plan.md) ya ofrece reindexación, sin medir ambos destinos.

**Alternatives considered**: Solo CPU/health o localhost, etiquetar «durante carga» sin timestamps solapados o aumentar 120%: no cumplen.

## R12 — Informe de ejecución, no inventario de archivos

**Decision**: Manifiesto 31 casos con cantidades, resultados/runId/hashes/entorno; generador de informe exige artefactos de corridas efectivas y evidencia real donde aplica. Hashes del árbol relevante incluyen no versionados, lockfiles, imágenes/configuración y matriz, excluyendo secretos. No copiar «cubierto» de report-ui como PASS.

**Rationale**: Constitución IX/X y aceptación de todos IN. report-ui solo verifica existencia y diff HEAD no incluye contenido untracked. Recorridos controlados, PostgreSQL real, Bedrock real, portal real y móvil real se registran por componente, no una etiqueta ambiguamente «real».

**Alternatives considered**: Checklist verde por archivo, hash solo commit o aceptar Android emulado como Android real: no acreditan criterio.
