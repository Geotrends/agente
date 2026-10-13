# §6 Reindexación sin interrupción (entorno limpio geobot_limpio, 2026-10-08)

- Reindexación completa (`sincronizar --completa --medir`): 584 elementos, 3117 puntos, duración de etapas 9,69 min (< 2 h). La medición de producción (3 de 3, SC-010) es T083.
- Sonda `06-sonda-chat.log` durante la reindexación: 6/6 respuestas HTTP 200.
- Fallo forzado (`NODE_ENV=test KB_FALLO_FORZADO_EN=50%`; la variable solo se lee con NODE_ENV=test): indexación `fallida`, alias sin cambio (`kb_chunks_20261008185348020`), notificación `indexacion_fallida` creada (`06-fallo-forzado.txt`).
- Sonda durante el fallo (`06-sonda-fallo-forzado.log`): 4/5 en 200 y 1 en 503. Los 503 de esta sección (también 1 de 7 en la corrida de fallo previa, sin NODE_ENV=test) son fallos del proveedor LLM (Gemini 503 "high demand" y Groq 429 por tokens/minuto), visibles en los logs del backend; no son del índice (el alias nunca dejó de servir). Para SC-009 estricto conviene repetir la sonda con proveedor estable o un proveedor local.
- Observación: la guía dice `KB_FALLO_FORZADO_EN=50%` sin mencionar NODE_ENV=test.
