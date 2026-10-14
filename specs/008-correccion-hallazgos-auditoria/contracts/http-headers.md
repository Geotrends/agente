# Contrato — Cabeceras y estado público (FR-017, FR-019)

## Cabeceras de todas las respuestas estáticas del panel y del chat (nginx)

| Cabecera | Valor |
|---|---|
| `Content-Security-Policy` | La generada por `frontend/scripts/build-csp.mjs`, con `frame-ancestors` del dominio del Observatorio (solo `/chat`) y `frame-ancestors 'none'` en el panel |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |
| `Cache-Control` | `no-store` en el panel; sin cambio en estáticos con huella |

## Estado público

| Ruta | Respuesta anónima |
|---|---|
| `GET /health` | sin cambio (proceso vivo) |
| `GET /ready` | `200 {"ready":true}` o `503 {"ready":false}`; sin lista de dependencias ni configuración |
| `GET /api/retrieval/status` | `{"ok":true|false}` |

El detalle completo (qué chequeo falla, estado del índice y de la cola) lo recibe solo quien llama
**desde el propio contenedor** (loopback y sin cabeceras de proxy); por el proxy público siempre
llega `X-Forwarded-For`. La causa de un 503 también queda en el registro del servidor. El panel
autenticado conserva su pantalla de estado.
