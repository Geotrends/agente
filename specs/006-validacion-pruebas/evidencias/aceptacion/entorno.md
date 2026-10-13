# Entorno y acceso

Fecha: 2026-10-10. Disponibles: workspace local y dependencias Node instaladas; arneses PostgreSQL/Qdrant aislados y AWS doble existentes. Debe verificarse conectividad antes de marcar integración.

Pendientes: entorno de aceptación autorizado/URL/rol servidor, base y calibración publicadas identificadas, versiones de contactos/política/modelos, directorio privado de evidencias, redactor/revisor/aprobador, supervisión y Geotrends para actas, móviles físicos y lectores. Se solicitó información al usuario; sin respuesta se conservan pendientes. No hay despliegue/carga autorizada por esta ficha. No se copian secretos, datos ciudadanos ni firmas.

Evidencia local: specs/006-validacion-pruebas/evidencias/aceptacion. Originales firmados requieren ubicación privada explícitamente autorizada; aún no asignada.

## Autorización recibida (2026-10-11)

Usuario autoriza crear imagen Docker para pruebas aisladas; confirma que no existe entorno de aceptación. Se preparó Dockerfile.validation y compose dedicado sin puertos de host, corpus/secretos/montajes operativos ni red externa en ejecución. AWS usa doble; esto acredita mecánica, no los hitos reales.

Usuario señala formatos-revision.md: corresponde a revisión manual de formatos/fichas SPEC001, no al barrido de umbral de recuperación SPEC002. Conservar esa evidencia como insumo documental; no inferir que acredita calibración de modelos ni aprobación de matrices VA/PR.

## Ejecución aislada

La imagen almacena modelos públicos ONNX durante build para trabajar sin red externa en ejecución. Para regresiones nativas IN/UI/KB se usó temporalmente el override docker-compose.validation.host.yml (puertos solo loopback PostgreSQL15436/Qdrant16336 y red no interna para comunicación del proceso anfitrión); se retiró el proyecto después. El compose por defecto sigue sin puertos y con red interna. No se montaron corpus/credenciales ni se tocaron servicios operativos.
