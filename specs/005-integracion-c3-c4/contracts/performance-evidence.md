# Contrato de carga y evidencia

RNF-C3-IN-02/03/13; RF-C3-IN-04/05/07 y constitución IX/X. Extiende `eval-di-load.ts`/`loadRunner.ts` existentes; propone `eval-di-host.ts`/`hostRunner.ts` y `report-in.ts`. Los nuevos comandos no existen todavía y no se ejecutan en planificación.

## Identidad y resultados de corrida

Registro offline: runId, caseId, requisitos, startedAt/finishedAt, fecha de ejecución, commit+hash del árbol relevante (incluidos untracked), digests de imágenes, configuración pública, hashes lockfiles/base/matriz/calibración/prompt/modelos, tipos de componentes real/controlado, fuentes de evidencia, resultados y hallazgos. Nunca copiar `.env`, credenciales, headers de autenticación o texto de ciudadanos reales. La identidad de casos usa datos sintéticos.

Reporter registra estados `pendiente`, `controlado_conforme`, `real_conforme`, `fallo`, `descartado`. Cada caso puede contener subresultados de componentes distintos; `real_conforme` solo cuando todas las partes exigidas del caso tienen evidencia completa. Un archivo de prueba existente no acredita corrida. Cierre necesita 30 activos conformes y N309 descartado, con evidencia controlada solo donde la fuente exige simulación o revisión estática y evidencia real para demás partes.

p95 por nearest-rank: ordenar n duraciones completas y tomar índice ceil(0.95*n)-1. No excluir errores/lentas del denominador. Reportar cantidad, errores, tipos, p50/p95/máximo/superan 40 s y cumplimiento por día/oleada/destino/condición. Fecha UTC para identidad y fechas locales America/Bogota para distinguir días de ejecución.

## Secuenciales N302

Por cada uno de dos días distintos en producción:100 consultas una a la vez, 40 simples/30 medias/30 complejas. Preparar manifiesto de preguntas sintéticas respaldadas por base publicada.10 casos efectivamente autorizados llevan exactamente 10 pares válidos; 10 producen respuesta larga, definida en manifiesto como≥700 tokens visibles, ≤2200 tokens del límite existente. Es una convención de selección del arnés, no una obligación adicional de longitud de toda respuesta.

Preparación de sesiones/IDs fuera de la medición de consultas, sin consumir su cuota. Mantener origen correcto y datos/autorización reales. Cronómetro desde enviar consulta a leer/validar cuerpo completo; verificar también reloj de recepción del servidor en evidencia restringida. No aceptar éxito por status 200 sin contrato válido. Registrar errores rápidos, respuestas fijas y modelo efectivo para impedir aprobar una corrida degenerada sin orientación completa.

Cada día:p95 ≤20000 ms; ninguna consulta pasa 40000 ms sin error. Si faltan 10 historiales/10 respuestas largas, mezcla o base, el día no acredita criterio aunque p95 pase. Runner respeta ventana 60/min sin elevar cuota, coordinando IP de carga identificada y preparación fuera de consulta.

## Oleadas N303

Por día:preparar cinco conversaciones autorizadas con cinco credenciales vinculadas y diez sesiones anónimas. Cada oleada inicia simultáneamente tres consultas por cada conversación (15) y diez anónimas. Mantener aislamiento de turnos sin depender de un único frontend; la prueba de capacidad es del servicio. Tres oleadas, pausa 120000 ms después de terminar cada una. Repetir en otra fecha.

Por oleada:25 éxitos, 0 errores, p95 ≤20000 ms y ningún silencio>40000 ms. Por día:75 registros, 45 autorizados+30 anónimos; total dos días 150, 90+60. No promediar una oleada fallida con las otras. Política de recursos/cola debe satisfacer 25 sin relajar cuota ni límites.

Conciliación autorizada:IDs devueltos confirmados cruzan conversación/campos/token/costo; pruebas sintéticas y archivos de acceso restringido, sin publicar IDs ni textos reales. Anónima:no añadir traceId/hash/IP; cotejar multiset de seis campos con ventana de prueba exclusiva, muestreo previo/posterior y validación de ausencia de tráfico ajeno. Si no puede aislarse tráfico, declarar conciliación pendiente; conteo global no es evidencia de 75 registros propios.

## No degradación N313

Definir dos destinos reales:URL página Observatorio y una petición de referencia Geoportal (método, URL, cuerpo sintético si corresponde, criterio de éxito/esquema/tamaño). Usar mismo cliente, red, configuración, versión y caché documentados. Timeout de medición fijo 120000 ms, contado como error y duración; no truncar muestra favorable.

Condiciones:sin carga, reindexación completa efectiva de SPEC001, oleada real de 25 consultas.30 muestras por destino/condición:180 totales. Cronología de carga y mediciones debe probar solapamiento; no etiquetar como «durante» una petición posterior a carga. Lanzar las muestras concurrentes bajo una ventana de carga sostenida identificada; si se necesita repetir oleada para solapamiento, documentarla como carga adicional de N313 sin reemplazar tres oleadas obligatorias de N303. No degradación exige para cada destino ambas razones p95Carga/p95Base≤1.2 y 0 errores en las tres condiciones. Línea base 0/inválida o condición sin solapamiento impide aceptación.

Worker/backend separados son mecanismo existente; ajustar límites/prioridades/aislamiento en compose según medición si no pasa, sin detener chat ni ampliar límites contractuales. Registrar memoria/CPU solo para explicar hallazgo, no como sustituto de respuesta completa.

## Cierre y compatibilidad

Guardar evidencia bajo `evidencias/aceptacion/` al implementar. Reporte 31 casos enlaza corridas de SPEC002/004 solamente si versión/muestras/componentes coinciden. Fallos REAL antes de corrección; repetir casos completos afectados y regresión integrada. Cambios a prompt, base, recuperación obligan a matriz congelada completa en ambos modelos; no aceptar subconjunto favorable. Acta global sigue Bloque 6.
