# T082 — Validación del quickstart en entorno limpio (2026-10-08)

Entorno: proyecto Compose `geobot_limpio` (volúmenes nuevos de Postgres, Qdrant, informes), corpus descargado reutilizado (no se re-descargó desde cero).

| § | Resultado | Evidencia |
|---|---|---|
| 1 Arranque | OK. `/ready` 503 sin base publicada (esperado). La colección vacía ya existe tras `make up` (la guía dice "sin colección": ajuste menor). | 01-* |
| 2 Carga y publicación | OK: 584 elementos, 584 publicados, `auditar-alcance` ok (0 puntos sin fila, 0 filas sin puntos), matriz .xlsx de 584 filas y 12 columnas. | 02-*, 02b-*, 02-matriz-documental.xlsx |
| 3 Fichas | OK: 229 fichas, 6 GT-P con los campos del contrato y tablas con filas. No se hizo la prueba de huella (editar página) ni la revisión visual en Excel/LibreOffice. | 03-* |
| 4 OCR | OK: `npm test` 268/268; 584 cargados, 244 descartados por OCR, cada descarte con notificación; ningún cargado con confianza ≤ 80 (máx. descartado 79,94; mín. cargado 80,09). | 04-* |
| 5 Vigilancia | PARCIAL: pruebas de integración de BD `kb-integracion` 49/49 (derogado, falla, vigilante, informes). Cron semanal confirmado en el scraper. No se observaron dos ciclos programados reales (SC-007) ni la prueba en vivo de derogado/falla. | 05-* |
| 6 Reindexación | OK con salvedad: reindexación completa 9,7 min, sonda 6/6 en 200; fallo forzado deja `fallida`, alias intacto y notificación. En la sonda del fallo hubo 503 por saturación de Gemini/Groq, no del índice. | 06-* |
| 7 Retención | OK: 11 meses se conserva, 14 meses se purga, no revisadas nunca. | 07-* |
| 8 No regresión | OK sin regresión: recall@8 92,9 % (+14,3 pts vs línea base); T077 en el stack principal dio 96,4 % (ac13 falla en el limpio). `npm run test:integration` en verde. | 08-* |

## Hallazgos
1. **Carrera entre el watcher del kb-worker y `kb sincronizar`**: al procesar la misma corrida los dos a la vez, la primera pasada quedó a medias (250 de 869 verificaciones, sin GMAS2) con la corrida ya marcada como procesada, y el segundo falló con ENOENT al mover el informe. Conviene que el procesamiento de una corrida sea atómico o que se retome si queda incompleto.
2. `kb_procesamiento` quedó con filas duplicadas (×2) por ese doble procesamiento.
3. `KB_FALLO_FORZADO_EN` solo actúa con `NODE_ENV=test`; la guía no lo dice.
4. Abstención 0/24 se mantiene (hallazgo para el bloque 2).
5. ac13: 92,9 % vs 96,4 % del stack principal; diferencia de un caso, dentro del criterio.
