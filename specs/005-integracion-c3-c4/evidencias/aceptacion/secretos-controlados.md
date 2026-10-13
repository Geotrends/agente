# Secretos y registros — evidencia controlada (T056)

Fecha: 2026-10-10. Componente: **C** (proveedor y SDK simulados con señuelos) + **DB** (PostgreSQL real aislado). No acredita la imagen desplegada ni el rol real. **Ningún valor sensible se imprime**: este documento solo lista conteos, rutas y reglas.

## Escenarios (N310)

`backend/test/in-integracion/secret-redaction.test.ts` — 8 escenarios con 7 señuelos (llave de acceso, secreto, bearer de Bedrock, sesión, JWT, DSN con contraseña, URL de webhook):

| # | Tipo | Qué se inyecta |
| --- | --- | --- |
| 1 | fallo | `AccessDeniedException` del SDK con todos los señuelos en el mensaje |
| 2 | fallo | `CredentialsProviderError` con señuelos |
| 3 | fallo | la búsqueda lanza un error con señuelos |
| 4 | fallo | la base rechaza la escritura con un mensaje que trae DSN y contraseña |
| 5 | éxito | consulta autorizada con cabeceras `x-amz-security-token`, `x-api-key` y `Authorization` con señuelos |
| 6 | éxito | consulta anónima |
| 7 | reinicio | `unhandledRejection` y `uncaughtException` con señuelos en mensaje y pila |
| 8 | revisión | escaneo del repositorio, configuración y paquete del frontend |

Resultado: **0 señuelos** en la consola capturada (logs y avisos a operación), en `operations` (avisos y estado), en **todas** las tablas de `chat` y `admin`, y en cuerpos y cabeceras HTTP (lo que ve el frontend). Control negativo incluido: el barrido detecta un señuelo escrito a propósito en el log.

## Escaneo de repositorio/paquete (`npm --prefix backend run … scripts/scan-secrets.ts`)

| Dato | Valor |
| --- | --- |
| Archivos revisados | 282 (`backend/{src,migrations,config,scripts}`, `frontend/{app,chat,shared,widget,scripts,public,out}`, `docker-compose.yml`, `.env.example`, Dockerfiles, `nginx.conf`, `.github`) |
| Reglas | AWS access key id (`AKIA…`), clave temporal (`ASIA…`), PEM privado, bearer key de Bedrock (`ABSK…`), `aws_secret_access_key=` |
| Hallazgos | **0** |

La imagen de backend no se construyó en este entorno: **pendiente** (T073/T074).

## Cambios

- `services/safeLog.ts` (`safeErrorCode`) y sustitución de `error.message`/objeto por código acotado en `index.ts`, `app.ts`, rutas, `chat/*`, `retrievalClient`, `search`, `reranker`, `alerts` (la URL del webhook es una credencial), `documentLinks`, `chatTraffic`.
- `services/processGuards.ts`: manejadores de proceso con solo código; ya no se envía `error.message` a `notifyOps`.
- `chat/records.ts`: log de falla de escritura con `estado/razón/código SQLSTATE`.
- `services/diConfig.ts`: rechazo por nombre (sin valor) de toda fuente de credenciales distinta del rol.

## Salvedades

- El registro de `console.*` de módulos heredados sin invocar (`gemini/`, `groq/`, `deepseek/`, `openai/`, `ollama/`, `llm.ts`, `answerQuestion.ts`) y de la ingesta KB no se tocó; están fuera del camino del chat.
- No hay evidencia de que el servidor real no tenga llaves: eso es T074/T075.
