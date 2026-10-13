# Purga programada — evidencia controlada (T038)

Fecha: 2026-10-10. Componente: **C + DB** (PostgreSQL real aislado). **No** es la aceptación horaria real de N301.

## Qué se ejecutó

El programador identificado es el servicio `chat-purge` de `docker-compose.yml`:

```
sh -c "while true; do node dist/chat/purgeCli.js; sleep 3600; done"
```

La prueba `backend/test/in-integracion/purge-scheduler.test.ts` toma ese comando del compose y cambia únicamente el intervalo (`sleep 3600` → `sleep 2`) y el ejecutable (`node dist/…` → `node --import tsx src/…`). Las filas de `chat.purge_run` provienen del bucle, no de llamadas manuales. Una corrida adicional con `sleep 3` durante 11 s dejó:

| run_id | started_at (UTC) | finished_at (UTC) | status | rows_purged |
| --- | --- | --- | --- | --- |
| 1 | 2026-10-10T23:14:17.168Z | 2026-10-10T23:14:17.178Z | ok | 0 |
| 2 | 2026-10-10T23:14:20.350Z | 2026-10-10T23:14:20.360Z | ok | 0 |
| 3 | 2026-10-10T23:14:23.522Z | 2026-10-10T23:14:23.532Z | ok | 0 |
| 4 | 2026-10-10T23:14:26.703Z | 2026-10-10T23:14:26.713Z | ok | 0 |

Inicio y fin son instantes reales (antes `finished_at` repetía `started_at`; corregido en `chat/retention.ts`). Intervalo observado ≈ 3,18 s = `sleep 3` + duración de la corrida.

## Cobertura de datos

`consumption.test.ts` (N301): 11 m 29 d se conserva, 12 m 1 d se depura; solo `question_text`, `answer_text`, `conversation_id`, `response_id` pasan a NULL; `received_at`, `category`, `result_type`, `cited_documents`, `duration_ms`, `visible_output_tokens`, `model`, tokens, `tariff_version`, `estimated_cost`, `row_id` y las valoraciones quedan idénticos; dos ejecuciones, la segunda con 0 filas.

## Lo que NO acredita

- Las dos ejecuciones **horarias** del contenedor desplegado con la imagen real (≥ 2 h de observación): **pendiente T076**.
- Que el servicio `chat-purge` esté vivo en el entorno de producción.
