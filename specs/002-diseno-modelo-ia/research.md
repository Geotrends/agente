# Investigación — Bloque 2

Fecha:2026-10-08. Fuente normativa: spec/PDF y constitución; evidencias locales en diagnóstico. Fase 0 ejecutada tras gate de diseño I–X; investigación distribuida en Bedrock/tokenización y persistencia/administración, consolidada aquí. Fuentes externas son evidencia técnica, no requisitos funcionales nuevos.

## R1 — Bedrock, región y credenciales

**Decision**: SDK AWS v3 `BedrockRuntimeClient`/`ConverseCommand`, IDs `openai.gpt-oss-20b-1:0` y `openai.gpt-oss-120b-1:0`, región inicial `us-east-1`, inferencia in-region. Credenciales explícitas de rol EC2; para prueba local sesión temporal de rol, nunca variables de llaves estáticas. `maxAttempts:1`, no streaming en esta fase. Configuración inválida se rechaza antes de servir consultas.

**Rationale**: Ambos modelos admiten Converse; API normaliza uso/motivo determinación. Rol EC2 encaja con Docker/Dokploy. IAM permite solo `bedrock:InvokeModel` sobre dos ARN regionales; sin permisos a otros modelos/proveedores ni envío de textos en tags/requestMetadata. Región/acceso se comprueban al poner en servicio, sin fallback regional automático. RF-C3-DI-03, RNF-C3-DI-02 y RNF-C3-IN-07/08/10.

**Alternatives considered**: añadir Bedrock al catálogo multivendor perpetúa incumplimiento; API OpenAI compatible con llave Bedrock no respeta rol-only; ECS no necesario para despliegue actual; cross-region no necesario.

Fuentes: [parámetros AWS](https://docs.aws.amazon.com/bedrock/latest/userguide/model-parameters-openai.html), [SDK ConverseCommand](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/bedrock-runtime/command/ConverseCommand/), [modelo 20b](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-oss-20b.html), [modelo 120b](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-oss-120b.html), [credenciales del SDK](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/setting-credentials-node.html).

## R2 — Generación, consumo y tokens de razonamiento

**Decision**: Configuración compartida `maxTokens:2200`, `temperature:0`, sin `topP` personalizado ni ajustes de razonamiento por modelo. Prompt/config con versiones/hashes iguales; solo cambia modelId. Extraer únicamente bloques `text`; nunca devolver, almacenar o reenviar `reasoningContent`. Conservar usage real y stopReason; `max_tokens` activa abreviación. El razonamiento puede agotar el presupuesto antes de una oración útil; fallo seguro en ese caso.

**Rationale**: AWS mapea maxTokens a max_completion_tokens; el límite incluye razonamiento, no autoriza subir 3000. Temperatura 0 es elección de ingeniería, no garantía de determinismo semántico. Usar `usage.inputTokens/outputTokens` real para tarifa, no restar tokens visibles para inventar desglose de razonamiento. RF-C3-DI-16/17/18, RNF-C3-DI-03.

**Alternatives considered**: estimación por palabras no mide uso; rescatar razonamiento como respuesta filtra contenido; reglas distintas por modelo incumplen DI-17.

Fuentes: [Converse](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html), [InferenceConfiguration](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_InferenceConfiguration.html), [TokenUsage](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_TokenUsage.html), [ContentBlock](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ContentBlock.html), [semántica del límite](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create).

## R3 — Longitud visible final exacta, local

**Decision**: No usar CountTokens: las dos fichas AWS lo marcan no soportado. Tokenización local `o200k_harmony`: AutoTokenizer existente con artefactos oficiales `openai/gpt-oss-20b` fijados por revisión+SHA256, red deshabilitada y sin tokens especiales añadidos. Gate previo a integración: igualdad de IDs con `tiktoken.encode_ordinary` oficial sobre español, Unicode, Markdown, URL/correos y tokens especiales como texto. Python se usa solo para generar oráculo offline. Si adaptación JS falla, usar binding WASM local de la codificación oficial validado por el mismo oráculo; no introducir Python online ni aceptar aproximación. La implementación no pasa gate sin paridad.

**Rationale**: Contar respuesta visible entera después de ensamblar avisos, cuerpo, citas y contactos; no sumar cantidades por fragmento porque cambia BPE en fronteras. Quitar últimas unidades completas y repetir hasta≤2200; actualizar fuentes según contenido conservado y añadir aviso si se abrevia. `provider_output_tokens` y `visible_output_tokens` son métricas diferentes, ambas acotadas. Sin inferencia extra ni documentos enviados a otra entidad. DI-18 y RNF-DI-03.

**Alternatives considered**: CountTokens remoto no soportado; caracteres/4 es aproximación; subir tope contradice PDF; tiktoken Python atendiendo solicitudes contradice stack de constitución.

Fuentes: [mapa oficial de codificaciones](https://github.com/openai/tiktoken/blob/main/tiktoken/model.py), [codificación oficial](https://github.com/openai/tiktoken/blob/main/tiktoken_ext/openai_public.py), [tokenizer publicado por OpenAI](https://huggingface.co/openai/gpt-oss-20b/blob/main/tokenizer.json), [entorno offline Transformers.js](https://huggingface.co/docs/transformers.js/api/env). La adaptación TypeScript es decisión del proyecto, no una librería oficial TS de OpenAI.

## R4 — Plazo, respaldo y estado

**Decision**: Deadline único 40 s desde recepción, cancelable también en cola/recuperación. Presupuesto inicial recuperación≤5 s, finalización 2 s, dividir remanente entre principal/respaldo, sin reintentos SDK. Intentar otro modelo ante fallo del principal; validación local fallida no se envía a ninguno. Circuit breaker por ID y cooldown existente revisado dentro del deadline. Aviso agrupado y estado volátil disponibles aunque falle PostgreSQL; persistir descripción sanitaria al recuperar, sin cola de preguntas/respuestas.

**Rationale**: El comportamiento actual puede no llegar al respaldo o exceder plazo; `/ready` no es pantalla AD-48. No hacer inferencias sintéticas pagadas para sondear salud: estado por llamadas reales/circuito, último fallo/último éxito y señal explícita de no comprobado. Backend expone liveness/observación administrativa; los tres estados de fallo se fuerzan con dobles en integración y se prueban reales donde aplica. DI-03/06, IN-04/08 y AD-28/30/48.

**Alternatives considered**: varios reintentos ocultos sin presupuesto, webhook y diagnósticos públicos no cumplen; guardar consultas fallidas para reintentar escritura anula anonimato/UUID omitido.

## R5 — Persistencia y permisos sin romper KB

**Decision**: Esquemas chat/admin con propietario/migrador no-login y usuario runtime limitado; conservar app_reader solo lectura KB, kb_writer exclusivo del worker. Migrador con registro separado, secuenciaSQL transaccional y bootstrap idempotente ejecutable también sobre volúmenes existentes. Runtime recibe solo vistas y procedimientos/GRANT precisos; sin DDL ni UPDATE/DELETE de auditoría. Tarifas NUMERIC versionadas por modelo/región; costo decimal a partir de tokens oficiales y snapshot de tarifa.

**Rationale**: `backend/src/kb/db.ts` y el runner se reutilizan como mecánica; `01-roles.sh` no vuelve a ejecutarse en volumen existente. No reutilizar KB_DATABASE_URL como escritor web. Ausencia de tarifa produce estado degradado/falla de configuración, jamás precio/costo cero supuesto. DI-16, IN-05/07, AD-41 y constituciónVII.

**Alternatives considered**: CSV activo no cumple; ampliar app_reader rompe separación; flotantes binarios distorsionan costo; migrar CSV como consentido inventa consentimiento. Archivo previo queda fuera del runtime y requiere tratamiento separado antes de conservarlo, no se importa automáticamente.

Fuentes: [privilegios PostgreSQL16](https://www.postgresql.org/docs/16/ddl-priv.html), [tipos NUMERIC](https://www.postgresql.org/docs/16/datatype-numeric.html), [tarifas Bedrock](https://aws.amazon.com/bedrock/pricing/). Valores tarifarios no fijados aquí: cargar tarifa oficial contratada y fecha en puesta en servicio.

## R6 — Consentimiento, pares y anonimato

**Decision**: Token técnico de acceso separado de UUID de conversación. Elegir Autorizo/No autorizo antes de habilitar consulta; UUIDv 4 backend únicamente con autorización. Historial de pares `{pregunta,respuesta}`, máximo 10 recientes tras validar todo el historial; rechazar pares incompletos, categoría inválida, vacío o historial sin UUID emitido. Complejidad cuenta pares, no mensajes, puntaje finito `max(base,6)` al forzar por 10 pares y motivo historial_largo.

**Rationale**: Con No autorizo no guardar texto, categoría, fuentes, tipo, token/IP/hash ni UUID. Solo registro técnico fecha/modo/modelo/tokens/costo. Historial en memoria frontend en autorizada; anónima no envía historial. El límite de una aclaración encadenada se controla solo en conversación autorizada. Cada consulta anónima es autónoma conforme C4-DC-02; puede solicitar reformulación completa, pero no arrastra un estado de turnos anteriores. Identificador de respuesta solo después de INSERT confirmado, omitir si falla. Purga textos/UUID12 meses+24 h. DI-02/15/16/21/23, RNF-DI-01, IN-01/02/03/05/07/08 y C4-DC-02.

**Alternatives considered**: tokenJWT como consentimiento o id de conversación, persistir hash de consulta anónima, aceptar mensajes sueltos o emitir responseId antes de guardar no cumplen. Mantener sesión técnica solo en memoria para evitar nuevos datos persistentes; no registrar cuerpos HTTP.

## R7 — Protección de datos antes de salida

**Decision**: Extender `pii.ts` a resultado `{textoSaneado,tiposDetectados}`. Etiquetas contractuales `[CÉDULA]`, `[TELÉFONO]`, `[CORREO]` para envío/persistencia; detectar direcciones y nombres de terceros para advertencia DI-23 y evitar reproducción en respuesta. No enmascarar normativa/códigos/fechas. Snapshot de contactos oficiales se ensambla por canal confiable distinto; no eximir datos de ciudadano porque coincidan parcialmente con un número oficial. Mascarar pregunta, historial y contenido recuperado antes de Bedrock. Saneamiento de salida como segunda barrera; logs solo errores estructurales sin payload o razonamiento.

**Rationale**: Mask actual solo en CSV, etiquetas distintas, sin advertencia. Detección libre de nombres/direcciones necesita evidencia funcional en matriz, además de regex/contexto local; no se afirma precisión universal. Si un detector no puede garantizar un caso probado, registrar fallo REAL y corregir antes de cierre. RNF-DI-01, DI-23 e IN-06.

**Alternatives considered**: delegar PII al prompt después de enviar datos es demasiado tarde; regex de cualquier cifra destruye números normativos; aviso siempre visible no cumple equivalentes sin datos.

## R8 — Recuperación, orden y fragmentación

**Decision**: Mantener Qdrant BM25+denso+RRF y modelos locales existentes. Tope duro 16 al reranker; filtro `score>umbral`; deduplicación Jaccard≥0, 6 irreversible; diversidad max 3 mientras existen otros documentos útiles, excepción hasta 8 únicamente cuando sirve uno; ordenar finalmente por puntaje y desempate estable. Sin reranker devolver RRF.slice(0, 8), sin filtro de logit ni diversidad que cambie top 8; reflejar estado. Fragmentación con tablas atómicas y tamaño completo≤1000, overlap 150±una palabra en cortes contiguos de prosa; no cruzar límites de tablas duplicándolas. Tablas/palabras mayores son error de publicación, conservar alias anterior y notificar.

**Rationale**: Pruebas existentes aceptan dividir tablas y recuperar duplicados. Encabezado cuenta contra límite; conservar metadatos fuera del texto embebido evita excederlo. No inferir excepción del tamaño. DI-06/12/13/14, RNF-IV-02.

**Alternatives considered**: dejar configurables hasta 64 candidatos, completar con duplicados, usar >= o fragmentar filas contradice criterios. Tabla>1000 requiere revisión documental, no excepción de ingeniería.

## R9 — Calibración y seguimientos

**Decision**: Oro congelado del corpus vigente, preguntas presentes/ausentes identificadas antes de barrido; elegir máximo candidato finito probado con cero abstenciones falsas en presentes. Informe incluye todos valores y versiones/checksums corpus/embedding/reranker/selección. Config normal sin calibración válida no sirve consultas; cambio de embeddings/reranker invalida calibración. Seguimiento añade cola≤500 en límite de palabra a BM25/reranker, sin duplicarla como contexto del LLM; vector sigue consulta actual conforme separación existente. Palabra>500 no se mutila: cola vacía y recuperación por consulta actual.

**Rationale**: Existe herramienta sweep pero recomienda recall relativo; no es el criterio de DI-05. Versionar publicación de alias con calibración evita servir combinación desconocida. Preguntas autónomas no reciben cola. DI-05/15.

**Alternatives considered**: inventar umbral 0, usar-Infinity, conservar recall de un umbral ya malo o calibrar sobre corpus anterior no cumplen.

## R10 — Respuestas y evidencia

**Decision**: Prompt único con instrucciones institucionales y evidencias marcadas como datos. Modelo declara fuentes mediante marcador con IDs opacos temporales de fragmentos/documentos recuperados, sin exigir JSON. Referencias por párrafo/unidad permiten determinar cuáles se conservan al abreviar; backend valida intersección y ensambla citas/fechas. No fallback a todas. Citas en Markdown dentro del texto y lista sincronizada para contrato IN-03. Plantillas backend para ausencia, aclaración limitada, alcance, leyenda, avisoPII, urgencia y tres canales. Si respuesta factual carece de fuente válida, fallo seguro de generación, no ausencia de información ni cita fabricada.

**Rationale**: El cuerpo actual se separa de fuentes y omite fechas. Validar pertenencia no demuestra verdad de cada afirmación: mantener prueba de datos clave y revisión funcional. GT-P prevalece explícitamente; tono/estructura siguen tasas originales. DI-01/04/07/08/09/10/11/18/19/20/21/22/23/24/25, RNF-IN-11.

**Alternatives considered**: prompt solamente para elementos fijos no garantiza exactitud; documentos declarados ajenos no autorizan mostrar todas las fuentes; conocimiento general ante fallos incumple anclaje.

## R11 — Contactos, panel seguro y avisos

**Decision**: Recepción 3 canales obligatorios, contacto general 3 datos y atención inmediata≥1 canal ordenado. Snapshot transaccional/versionado nuevo por consulta sin caché de 5 min. Edición con control de versión, validación por campo y auditoría en misma transacción. Panel técnico: contactos, estado, notificaciones, cuenta/cambio obligatorio. Dos perfiles exactos, Gestor no accede a contactos/estado/avisos de sistema. Password argon2id con sal aleatoria, memoria 65536KiB/timeCost 3/parallelism 1, documentados y medidos; longitud≥12 sin reglas de composición. Cuenta bloqueada 5 fallos/15 min, IP20 fallos/15 min bloqueada 15 min, con reinicio de acumulación de IP tras login exitoso para el caso 19 fallidos+éxito+5 sin bloqueo, inactividad 30 min; último administrador protegido bajo bloqueo transaccional. Cookie de sesión admin HttpOnly/Secure/SameSite y CSRF verificado en mutations; no valores de contraseña en logs.

**Rationale**: Roles producto no son rolesSQL. Bootstrap de administrador inicial con entrada protegida local sin credencial versionada; cambio obligatorio primera sesión. Reutilizar sanitización y upsert de avisos KB, ampliar panel con agregación de avisos chat; no ampliar acceso web a dueñoKB. Estado incluye datos reales scraper del worker; disponibilidad por runtime si DB cae. RF-C3-AD-08/09/10/28/29/30/35/36/37/41/48, RNF-AD-01..07/09.

**Alternatives considered**: tercer rol, panel público, scrypt/JWT anónimo como login, notificaciones externas y prompteditable no autorizados.

Fuente técnica: [node-argon 2 del mantenedor](https://github.com/ranisalt/node-argon2), soporte Argon 2 id y PHC/TypeScript; probar dependencia nativa en Docker. Los parámetros numéricos de hash son selección de ingeniería documentada, no métricas nuevas del PDF.

## R12 — Puertas y configuración operativa

**Decision**: Matriz completa en ambos modelos y fixtures por cada ID; pruebas manuales de tono/estructura/citas/enlaces/WCAG; CI incluye tipos, unitarias, integración PostgreSQL/Qdrant, auditoría sin altas y imágenes con nativas. Informes fallos REAL y rerun tras cambios. Valores de contactos, URL política, administrador inicial, tarifas, rol/cuotas AWS son entradas de puesta en servicio obligatorias; ausencia bloquea habilitar producción, no impide generar diseño. No hay decisiones abiertas marcadas NEEDS CLARIFICATION.

**Rationale**: Simulación acredita contrato/fallos, no calidad real, tráfico o p95; 70 pruebas previas no prueban 28 RF/RNF. No migrar CSV como consentimiento ni aumentar deuda. Todos los requisitos DI y constitución IX/X.

**Alternatives considered**: declarar cierre tras tests existentes, omitir panel directo o eximir requisitos Importantes incumple alcance.
