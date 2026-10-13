# Interacciones, mejoras, tarifas y tableros — SPEC007

RF-C4-AD-01..05, RF-C3-AD-42..46, RNF-C3-AD-07; registro/anonimato/purga de SPEC005. Exclusivo administrador técnico, no escritura/edición/borrado de interacción.

## Filtros y lectura

Rango civil `from,to` YYYY-MM-DD inclusivos Bogotá, convertido a UTC [inicio,finExclusive); ambos o ninguno, default 30d incluyendo hoy. Rechazar fechas/rango inválidos. `GET /api/admin/interactions?from=&to=&category=&resultType=&rating=&cursor=&limit=` proyecta únicamente chat.interaction+valoracion, ordenreceived_at DESC,row_id DESC. Nueve campos: fecha/hora,categoría,pregunta,respuesta,tipo,citas,modelo,valoración. Modelo público administrativo es etiqueta permitida o none; preguntas/respuestas enmascaradas y texto plano. Si purged o edad≥12meses, texto null y disponibilidad depurada, sin reconstrucción. Categoría nula muestra Sin categoría, no una dirección inventada.

`GET /api/admin/interactions/export` usa exactamente filtros anteriores, ignora paginación UI para incluir todas las filas filtradas. XLSX con las mismas nueve columnas, cero conversation_id/response_id/row_id, lectura en Excel/LibreOffice. Sin fórmula/hyperlink externo: campos ciudadanos/metadatos string explícito incluso `=`, `+`, `-`, `@`. No convertir valores en HTML ni ejecutar Markdown del ciudadano.

ExcelJS writer streaming y cursor SQL/chunks; archivo temporal **efímero privado de la petición**, no archivo durable/export histórico. Se valida workbook terminado, conteos y edad de textos antes de iniciar descarga; cleanup en éxito/error/cancel/reinicio, TTL de emergencia≤24h como guardia, no permiso para exponer texto vencido. No registrar archivo ni filtros que contengan texto. No descargar cien mil filas JSON al navegador. En purga concurrente o cruce de corte de retención se reconstruye proyección depurada o aborta antes de entregar; nunca cache reutilizable. Revalidar sesión al comenzar descarga y cortar si revocada durante petición. Respuesta no-store, Content-Type XLSX, nombre seguro fijo y sin secreto. No hay endpoint para borrar registros.

## Casos

Generación ocurre en misma tx que INSERT autorizado elegible o No útil confirmado; FK UNIQUErow_id y UPSERT une causas. No caso por anonimato, sin información+No útil es uno con ambos orígenes. Backfill autorizado idempotente para registros históricos sin texto copiado ni fechas inventadas.

| Método/ruta | Datos | Resultado |
| --- | --- | --- |
| GET /improvements?state=&failureType=&from=&to=&cursor=&limit= | Filtros permitidos | id/fecha/categoría/orígenes/REAL/estado/días, total/noCerrados |
| GET /improvements/:id | Técnico | Pregunta por JOIN actual, motivo si existe, historia segura/ref006 |
| POST /improvements/:id/transitions | `{expectedRevision,toState,failureType?,note?,evidenceRefs?}` | Commit de estado+evento+audit o409/422 sin cambios |

Máquina literal: Registrada→En análisis→En ajuste→Ajustada→Validada→Cerrada. `failureType` solo Datos/Recuperación/Modelo, requerido antes deEn ajuste. Nota no vacía paraCerrada. Validada/Cerrada requieren evidencia posterior de corrección aplicable conforme006/constituciónIX, revisada con hash/run/release; un ref arbitrario no pasa. Cada cambio actor/fecha/hora. No retroceder/reabrir caso; nuevo hallazgo006 puede tener eventos propios sin editar caso cerrado. Ninguna transición confirma/cierra actas automáticamente.

Un contador abierto cuenta toda fila noCerrada, incluso sin clasificación. Los motivos de valoración son exactamente cinco de `chat/feedback.ts`: Información incorrecta, Información desactualizada, No responde mi pregunta, Difícil de entender, Otro; no crear motivo libre. Nota administrativa se sanea para no conservar texto ciudadano ya depurado.

## Tarifas

`GET /api/admin/tariffs`: dos modelos/región activa, USD, precios/version/vigencia/source_url actuales; no endpoints de proveedor/modelo nuevo. `PUT /api/admin/tariffs/:model`: `{expectedRevision,inputPerMillion,outputPerMillion}` donde model etiqueta20b/120b permitida, prices strings positivos≤4decimales, sin exponente/texto, cabida numeric20,10. Fuente se conserva de versión institucional vigente, moneda fijaUSD.

Lockpor modelo/región, hora guardado de servidor, cerrar anterior e insertar nueva sin solapamiento; misma marca temporal conflictiva409, no intervalo vacío. Guardado afecta received_at posteriores, consulta en vuelo recibida antes conserva tarifa anterior. Auditoría y CAS en tx. Precio histórico/costo guardado nunca recalculados. Conservar decimal.js costo12decimales. Cero/negativo/texto/5decimales inválidos, Gestor403.

## Cuatro tableros

GET `/metrics/usage`, `/metrics/documents`, `/metrics/ratings`, `/metrics/consumption`; rango común. DTOs allowlist solo agregados: ninguna pregunta/respuesta/conversation_id/response_id/row_id. COUNT/SUM SQL por separado evita producto de JOINs.

- Uso: total/porDía=autorizadas+anónimas, categorías/tipos solo autorizadas, anonymousCount aparte, etiqueta de procedencia. Por categoría incluye sin categoría, no modifica la preferencia enviada.
- Documentos: dedup documento por respuesta autorizada, top10 con nombre/dirección/citas, citasdesc/nombreasc; dirección se resuelve por identity/catálogo seguro que sobrevive retiro sin contenido. `anonymousCoverage=not-recorded`, explicación visible, no inferir citas anónimas.
- Valoraciones: Útil/No útil, porcentaje de ambas y No útil por cinco motivos; total0→porcentajes0. Ningún aporte anónimo.
- Consumo: por modelo ambas tablas, tokens entrada/salida/consultas/costo total, `unknownCostCount` y señal de parcial cuando NULL, neverNULL→0. `none` separado para rutas locales, sin modelo efectivo inventado.

Error/ausencia de fuentes no se muestra como cero normal: estado no disponible e información segura. Totales coinciden con muestras40/20/10/20 de fuente, incluyendo anónimos en consumo. Adminstats no es respuesta del ciudadano ni habilita análisis/predicción a Geobot.
