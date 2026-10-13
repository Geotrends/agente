# Hallazgos SPEC004 (T082 — parcial)

Estado: se registran los hallazgos detectados y corregidos durante la ejecución **controlada**. Los hallazgos REALES (portal, dispositivos, Bedrock, KB publicada) solo pueden surgir de T079–T081, que no se han ejecutado: esta tarea permanece abierta.

| # | Requisito/caso | Observado | Causa | Corrección | Reejecución |
| --- | --- | --- | --- | --- | --- |
| 1 | RNF-C4-UI-02 / N02 | `color-contrast` 2,16:1 en el subtítulo del encabezado | regla heredada `.chat-header p { color:#666 }` sobre fondo `#0c342c` | `chat/panel.css`: texto blanco (13,61:1) | `reading-a11y.spec.ts` 1/1 |
| 2 | RF-C4-IN-06 / I06 | tras un fallo de configuración, una respuesta posterior correcta no desbloqueaba el flujo | `configListo` solo transicionaba desde `apertura` | `sessionReducer.ts`: también desde `bloqueada` | `contact-recovery.test.ts`, `query-integration.spec.ts` |
| 3 | RF-C4-UI-06 / U06 | doble clic en «Útil» enviaba dos solicitudes | guarda basada en estado de React aún no pintado | `ChatContext.tsx`: bloqueo síncrono por respuesta | `feedback.test.tsx` (doble clic) |
| 4 | RF-C4-UI-01 / U01 | foco inicial del panel móvil intermitente bajo carga | `focus()` ignorado con el panel recién visible | `panelFocus.ts`: reintento por `requestAnimationFrame` | 3 corridas completas de E2E |
| 5 | Regresión SPEC002/003 | pruebas heredadas esperaban literales y comportamientos previos (mensajes de respaldo, transcripción anónima de una sola consulta, `.sr-only` en enlaces) | cambios contractuales de SPEC004 (IN-06, transcripción volátil, nombre accesible) | pruebas heredadas actualizadas; no se relajó ninguna garantía de privacidad | `npm test` 17/17 |

## Sin clasificar aún (Datos/Recuperación/Modelo)

Ninguno: no hubo corrida con corpus ni modelo reales. Si T081 produce hallazgos, clasificarlos según la tabla 7 y repetir T077–T081 completos; si cambian prompt/recuperación/base, repetir la matriz SPEC002 con ambos modelos (constitución IX).
