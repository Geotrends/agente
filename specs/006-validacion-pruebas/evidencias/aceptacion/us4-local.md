# US4: matriz y flujos controlados

Fecha: 2026-10-11. Matriz fixture de 22 filas, ocho flujos y desktop/mobile; umbral ceil(0,90×22)=20. FAQ enlaza C3 por sus tres direcciones, variantes completas y grupos de emergencia/límite al 100 %.

22 casos funcionales controlados y un negativo de runner pasan con hostServer/stubApi, Chrome local y viewport emulado. Incluyen consentimiento, cuatro categorías, FAQ, emergencia, límites radicar/decidir, indisponibilidad/espera, valoración y reinicio. Las fichas emuladas/stub no pasan como físicas/reales. Importación móvil valida todo el lote antes de escribir, liga revisiones/hashes/personas, conserva runId y permite reintento idéntico sin sobrescritura.

Regresión SPEC004: 98/100 pasaron inicialmente; dos pruebas CSP dependían de chrome-error://. Se corrigió el test del propietario para exigir infracción frame-ancestors observada y ausencia del chat. Los seis casos CSP pasan tras la corrección; no se relajaron cabeceras/orígenes ni se omitieron casos. Vitest: 116/116. Tipos frontend: PASS.

Runner real disponible: test:pr:e2e, configuración separada sin stubs/servidor local y source-root obligatorio; pr-import permite incorporar resultados físicos/revisados a la corrida pendiente. T047/T049–T051 requieren C3 congelada, candidata documental/aprobación, host HTTPS real, dispositivos/lectores y revisión humana.
