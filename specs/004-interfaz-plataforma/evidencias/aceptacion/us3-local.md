# US3 — resultados locales (T052)

Fecha 2026-10-10. Adapter **controlled**. Dos tipos de observación, marcados por separado:

- **Reloj simulado** (`vi.useFakeTimers` / `page.clock`): plazos de 40/45/50 s y Retry-After. No miden tiempo real del navegador.
- **Tiempo real de navegador** (Chromium): indicador ≤500 ms, bloqueo de campo/envío, foco, reintentos y canales.

| Suite | Tipo | Resultado |
| --- | --- | --- |
| `test/query-attempt.test.ts` — doble envío = 1 solicitud; demora 5 s; 40 s visible; 50 s → fallo a 45–46 s y tardía descartada; reintento con plazo propio; fallo fuera de los pares | reloj simulado | 6/6 |
| `test/contact-recovery.test.ts` — 6 causas IN-04 (2 VALIDACION sin Reintentar, 2 internas, 502 HTML, 200 incompleto) sin datos técnicos; 4 casos IN-06; corte a 5 s | reloj simulado / DOM | 11/11 |
| `test/query-failures.spec.ts` — U07/U08: indicador ≤500 ms, sin mover foco, campo/envío bloqueados, 6 salidas con 3 canales exactos, reintento con payload original, control oculto tras 2 fallos, recuperación | navegador real | 3/3 |
| `test/query-integration.spec.ts` — IN-04 (6), IN-03 (45–46 s con `page.clock`), ocultar con consulta pendiente, IN-06 | navegador + reloj simulado | 4/4 |
| `backend/test/ui-integracion/contact-config.test.ts` — B10: 3 lecturas = registro, edición por panel seguro visible sin redespliegue, ≤2 s, 0 LLM; falla de base ≠ «sin información» | PostgreSQL real, API de panel real | 2/2 |

## Observaciones relevantes

- El cliente aborta a los 45 000 ms; una respuesta del servidor posterior se descarta (guardas de epoch y secuencia).
- `VALIDACION` no ofrece «Reintentar»; `429` respeta `Retry-After` con cuenta atrás; `401` no reenvía.
- Un fallo con snapshot presente NO provoca solicitud extra de configuración; sin snapshot se repite al abrir (botón), al elegir emergencia y al mostrar el fallo, agrupando solicitudes en vuelo.
- Defecto encontrado y corregido por estas pruebas: tras un fallo de configuración, una respuesta posterior correcta no desbloqueaba el flujo.

## No cubierto

- 40 s / 45 s en tiempo real de un navegador (se usó reloj simulado); C3 ≤40 s contra Bedrock real.
- Tres llamadas reales de contactos contra el panel de producción y servicios reales (T081).
- Revisión de lector sobre el anuncio del estado y el fallo (T080).
