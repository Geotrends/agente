# Hallazgos de SPEC005 (T073)

Fecha: 2026-10-10. Solo hallazgos **reproducidos con una prueba que falló antes de corregirse** o verificados en el arnés. Tipo: `C` = controlado/DB; ningún hallazgo REAL (A/P/H/B) porque no hubo acceso (ver `entorno-real.md`). Prioridad de fuente: requisito del documento C3–C4.

| ID | Hallazgo (falló antes del cambio) | Req. | Tipo | Corrección | Prueba |
| --- | --- | --- | --- | --- | --- |
| H005-01 | POST sin `Origin` pasaba el perímetro (200/401) | RNF-C3-IN-04 | C | `originGuard` exige Origin HTTPS exacto para POST/PUT; guardas antes de CORS | `reception-perimeter`, N304 |
| H005-01b | El preflight lo respondía `cors()` antes del guard (204 a orígenes ajenos) | RNF-C3-IN-04 | C | `preflightGuard` valida origen/método/cabeceras y responde 403 sin `Access-Control-*` | `reception-perimeter` |
| H005-05a | Preparación, configuración y valoración consumían los 60 turnos/min | RNF-C3-IN-05 | C | ventana propia `prepWindow` (`CHAT_PREP_RATE_LIMIT_PER_MINUTE`) | `reception-perimeter`, N305 |
| H005-04/05 | `received_at` y plazo nacían tras leer cuerpo, sesión y cola (806 ms de desfase con cuerpo lento) | RF-C3-IN-04/05 | C | `RequestContext` al llegar los encabezados; duración y fecha desde ahí | `reception-perimeter`, `results-records` |
| H005-03 | La purga vaciaba `cited_documents` contradiciendo «conservando los demás campos» | RNF-C3-IN-01 | C | `retention.ts` no lo toca; se retira `UPDATE (cited_documents)` a `chat_maint` (migración 008) | `consumption` (N301) |
| H005-06 | Errores de nginx sin `no-store`, en formato heredado; 413 en HTML | RNF-C3-IN-12 | C+P-local | `no-store` único, catálogo JSON, `proxy_request_buffering off` | `cache-entrypoint` (nginx real) |
| H005-07 | Aviso de registro sin fecha/modo; segundo episodio agrupado con el primero; drenaje de buffer no serializado | RF-C3-IN-08 | C | `registryEpisode`, objeto de aviso por episodio, `flushVolatile` compartido | `registry-episode` |
| H005-02 | `fromNodeProviderChain()` admitía perfiles, procesos, SSO y web identity | RNF-C3-IN-07/08 | C | `fromInstanceMetadata` (IMDSv2, sin IMDSv1); readiness rechaza otras fuentes | `instance-role` |
| H005-08/09 | Arnés de carga: 5 historiales efectivos, oleadas anónimas, 200 sin contrato, sesiones dentro del cronómetro | RNF-C3-IN-02/03 | C | `loadRunner` v2, auditoría, conciliación, `hostRunner` | `load-runner`, `load-reconciliation`, `host-runner` |
| H005-10 | `statement_timeout` **no acota el COMMIT** de PostgreSQL | RF-C3-IN-04/08 | C | resultado `indeterminada`: sin `responseId`, sin reintento, conexión descartada | `db-budget` |
| H005-11 | Cola de admisión en frío: la consulta 25 simultánea recibía `chat_queue_busy` (30 000 > 29 988 ms) | RNF-C3-IN-03 | C | supuesto inicial 5 s (`CHAT_QUEUE_INITIAL_AVERAGE_MS`) | `capacity-queue` |
| H005-12 | `TRUST_PROXY` como cadena numérica se interpretaba como dirección; «confiar en todos» aceptado | RNF-C3-IN-05 | C | `parseTrustProxy` (número de saltos o lista exacta) | `trust-proxy` |
| H005-13 | Respuestas JSON con `ETag` | RNF-C3-IN-12 | C | `app.disable("etag")` | `cache-entrypoint` |
| H005-14 | 413 por streaming cortaba la conexión antes de que el cliente leyera el motivo (flaky) | RNF-C3-IN-06 | C | descarte sin acumular con gracia de 300 ms | `chat-perimeter` (N306) |
| H005-15 | Conversación autorizada: el token vencido se renovaba en silencio y se reenviaba el ID a otro portador | RF-C4-IN-01/02 | C | no renueva si hay conversación; `sessionLost` exige «Nueva conversación» | `in-session`, `in-continuity` |
| H005-16 | El cliente aceptaba un 200 incoherente con la solicitud (modo/`conversationId`/fuentes en no respondida) | RF-C4-IN-04 | C | `esCoherenteConSolicitud`; `assertPublicResponse` en el backend | `contracts.test`, `public-response` |
| H005-17 | La respuesta guardada no se sanea de cédula/teléfono/correo | RF-C3-IN-06 | C | `sanitizeForRecord` conservando canales oficiales | `privacy` (C306) |
| H005-18 | Un adaptador que ignora `AbortSignal` rompía el plazo de 40 s | RF-C3-IN-04 | C | carrera con la cancelación en `callWithRouting` | `end-to-end-deadline` |
| H005-19 | Logs y avisos imprimían `error.message`/objetos (la URL del webhook es una credencial) | RNF-C3-IN-10 | C | `safeErrorCode` y `processGuards` | `secret-redaction` (N310) |

## No corregido / pendiente

| Tema | Estado |
| --- | --- |
| Chrome/Firefox de escritorio, Chrome Android, Safari iOS reales; lectores de pantalla | **pendiente** (T077) |
| Rol IAM real, IMDSv2/hop limit del servidor, 4 denegaciones reales, 2 modelos reales | **pendiente** (T074/T075) |
| 100 × 2 días, 3 × 25 × 2 días, 150 registros, 180 medidas del anfitrión | **pendiente** (T078/T079) |
| Dos ejecuciones horarias reales de `chat-purge` desplegado | **pendiente** (T076) |
| Firefox/WebKit/móviles emulados de Playwright no se ejecutaron localmente | solo en CI; sin verificar aquí |
| Código heredado sin invocar (`gemini/`, `groq/`, `deepseek/`, `openai/`, `ollama/`, `llm.ts`…) | sin tocar; su retiro requiere aprobación del usuario |
