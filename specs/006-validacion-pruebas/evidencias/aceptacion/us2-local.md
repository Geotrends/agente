# US2: verificación local

Fecha: 2026-10-11. Ensayos controlados, sin AWS ni aceptación contractual.

Suite VA sobre el caso de uso existente y su recuperación: 39 filas por corrida integrada HTTP y por cada modelo independiente. Se comprueban intentos SDK, modelo enviado/efectivo, uso, decisiones locales sin invocación, checkpoints y rechazo de filtros. El doble y las revisiones pendientes no devuelven aceptación real. `--evaluate-run` importa revisiones sin nueva inferencia y rechaza invalidación o corrida posterior.

Las pruebas de integración incluyen PostgreSQL/Qdrant reales aislados, publicación mediante el pipeline KB, exposición de fragmentos, borrado y comprobación de no recuperación; errores, cancelación e interrupción dejan obligación persistente reconciliable. Ver base-ataques.md e integracion-local.md para comandos/resultados.

Pendientes T032–T033: base/calibración vigente, matrices humanas aprobadas, rol AWS de servidor, ejecución real y revisión semántica individual. Ningún JSON sintético constituye esos insumos.
