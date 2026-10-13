# Código fuera del alcance del bloque 1 presente en el árbol de trabajo (T091)

Revisado el 2026-10-08. Estos archivos no pertenecen a la spec 001 (base de conocimiento): vienen de la
**auditoría pre-producción** (observabilidad y rendimiento del chat, ver sus propios comentarios de cabecera).

| Archivo | Qué hace | Relación con el bloque 1 |
|---|---|---|
| `backend/src/services/alerts.ts` | Avisos de operación por `ALERT_WEBHOOK_URL` (cuota, proveedores, índice caído). | Ninguna. Lo usan `index.ts` y `llm.ts`. |
| `backend/src/services/circuitBreaker.ts` | Circuit breaker por proveedor y modelo. | Ninguna. Es del chat (`llm.ts`). |
| `frontend/shared/chatErrors.ts` | Mensajes de error del cliente según el tipo de fallo del API. | Ninguna. |

## Verificaciones

- **FR-018 / Constitución VI**: las notificaciones del kb (`kb_notificacion`) no usan el webhook. `backend/src/kb/notifications.ts`
  solo lo menciona en un comentario y ningún archivo de `backend/src/kb/` importa `services/alerts.ts`. Se verificó con
  `grep -rn "alerts" backend/src/kb`.
- **Constitución VI** pide que las notificaciones de degradación no salgan del panel por otro canal. El webhook de
  `alerts.ts` es un canal de operación del backend ajeno a esas notificaciones. Si el Líder de Proyecto lo considera
  incompatible con el principio, debe decidirse en el bloque que lo reclame (observabilidad), no aquí.

## Decisión

Actualización (convergencia T092/T093): `alerts.ts` y el webhook `ALERT_WEBHOOK_URL` (con `ALERT_MIN_INTERVAL_MS` y
`ALERT_LABEL`) se retiraron por la Constitución VI; las degradaciones solo se notifican en el panel y quedan como líneas
de log sin texto ciudadano. `circuitBreaker.ts` y `frontend/shared/chatErrors.ts` se conservan (los usa el enrutamiento
de modelos del bloque 2). Respaldo previo al borrado: referencia git `refs/backup/pre-converge`.
