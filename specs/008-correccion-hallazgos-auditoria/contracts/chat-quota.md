# Contrato — Topes del chat (`POST /api/chat`)

Cubre FR-001..FR-003, FR-002a, FR-022.

## Orden de controles
`originGuard` → tasa por IP (60/min) → validación de cuerpo → **bloqueo por mensajes largos** → cola de admisión → **tope diario IP/global** → LLM.

El tope diario cuenta las consultas que obtuvieron plaza: una consulta rechazada por la cola
(`chat_queue_full`, `busy`, `timeout`) no consume cupo (como documenta `.env.example`).

## Respuestas de rechazo (sin invocar al LLM, sin registrar la interacción)

| Estado | `error.codigo` | Cuándo | Cabeceras |
|---|---|---|---|
| 429 | `LIMITE_SOLICITUDES` | Umbral de mensajes largos superado, tope diario de la IP o tope global | `Retry-After` (hasta las 00:00 de Bogotá en los topes diarios; la duración del bloqueo en mensajes largos), `Cache-Control: no-store` |

El motivo concreto (`ip_temporarily_blocked`, `daily_ip_limit`, `daily_global_limit`) queda en el
registro del servidor, no en la respuesta: el catálogo de errores del chat es cerrado (principio VI).
Cuerpo: el error estándar del chat, sin proveedor, modelo ni rutas; el cliente ya trata 429 como
causa `limite` con reintento.

## Falla del contador (FR-002a)
Si el estado no se puede leer o escribir: se aplica un tope en memoria igual a `floor(límite/2)` por IP y global, y se avisa al administrador técnico (aviso `topes_degradados`, agrupado, como mucho cada 5 min). Las respuestas son las mismas.

## Configuración
`CHAT_DAILY_PER_IP_LIMIT`, `CHAT_DAILY_GLOBAL_LIMIT`, `CHAT_LONG_MESSAGE_*` (ya existen en `.env.example`).
