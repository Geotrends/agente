# Contratos documentales y de fuentes — SPEC007

RF-C3-AD-01..04/14..27/32..34/38/39/47; base y indexación SPEC001, fuentes/calibración SPEC002 y vigencia SPEC006. Referencia obligatoria: [modelo](../data-model.md), [decisión de publicación](../research.md).

## Matriz y carga

`GET /api/admin/documents?mine=&state=&cursor=&limit=`: matriz completa ambos perfiles, doce columnas heredadas más origen/autor/validez y vínculo candidato/vigente identificados; filtro `mine=true` usa usuario real. N/A manual para opcionales ausentes, procedimiento `ninguno` explícito. Metadata vigente no se sobreescribe por candidata pendiente. Controles según perfil, no se ocultan datos de matriz al Gestor.

`POST /api/admin/documents`: multipart/form-data, primera parte `metadata` JSON y luego un `file`. Metadata: type,title,direction,publicUrl,associatedProcedure obligatorios; code,version,updatedDate,validUntil opcionales. Auth/CSRF/Origin y metadata se validan antes de persistir archivo. Orden inválido, faltante o dato inválido señala campo y deja cero archivos/filas; rechazos y desconexión limpian temporales. Validar formato por estructura, no MIME suministrado. PDF/DOCX/XLSX admitidos con pipeline local OCR/tablas/formato en blanco y corpus cerrado; límites de infraestructura del research documentados por configuración, no cambian el perímetro ciudadano.

201 solo tras archivo aceptado y fila pendiente confirmada con origen manual/autor/fecha. Procesamiento técnico puede continuar pendiente; no significa documento publicado. Conversión/OCR descartada notifica según dueño001 y autor. Código o URL que resuelvan dos documentos distintos→409 sin sustitución arbitraria. Ningún fetch de publicUrl desde el servicio de carga.

## Mutaciones documentales

Todas exclusivamente técnico, expectedRevision obligatorio, auditables, idempotencia de POST trabajo mediante `Idempotency-Key` ligado a usuario+ruta+hash de entrada. Misma clave distinto cuerpo→409. IDs/colecciones internas se crean servidor, jamás se acepta `force`/ruta del filesystem.

| Ruta | Cuerpo | Resultado |
| --- | --- | --- |
| POST /documents/:id/publish | `{expectedRevision}` identifica candidato pendiente | 202 operationId; publica solo cuando operación cumple todas sus fases |
| POST /documents/:id/reject | `{expectedRevision,motivo}` no vacío | 202 operación de exclusión/eliminación, posterior criterio completo |
| POST /documents/:id/withdraw | `{expectedRevision,motivo,confirmedDocumentId}` coincide con documento confirmado | 202 operación; diálogo cancelado no envía mutación |
| PATCH /documents/:id/metadata | `{expectedRevision,changes}` solo título/tipo/dirección/enlace/procedimiento/versión/actualización/validez | 200 nueva revisión después de commit válido; metadata vigente y citas actualizadas siguiente consulta |
| POST /reindexations | `{}` e idempotencia, todos los publicados | 202 operationId; otra reindexación activa409 |
| GET /document-operations/:id | Técnico; job/estado/inicio/fin/error seguro | En curso / Terminada / Fallida |

El código no se edita por AD39 (no está en lista de campos editables). En vigente/candidato/vencido seleccionar versión explícita ligada a revisión; editar candidato no cambia vigente. Editar futura validez de vencido restaura publicado si contenido válido; no rehabilita derogado o pendiente. Hash de contenido no cambia. Cambio de campos usados por prioridad o citas se superpone desde metadata vigente antes de aplicar reglas de selección/citación; actualizaciones físicas de payload usan operación consistente si necesaria. No se devuelve éxito con cita anterior o dirección antigua por TTL.

## Protocolo de publicación

1. Worker único reserva operación durable y snapshot, guarda identidad de versión; construcción candidata completa separada de activa, parámetros y calibración vigentes.
2. Primer fallo de indexación limpia candidata parcial y acredita ausencia antes de un único reintento. Segundo fallo→pendiente intacta y aviso seguro; anterior responde. Nada parcial publicado.
3. Candidata completa verificada pasa a prepared. Commit SQL atomiza nueva generación/colección concreta, versiones y metadata vigente. Todas las rutas de recuperación leen manifest SQL y pasan nombre físico a search; no consumen alias autónomo. Alias kb_chunks se sincroniza como espejo y se reconcilia al reinicio.
4. Después de commit jamás se borra activa por excepción de alias/limpieza. Job reconciling/cleaning conserva diagnóstico seguro; se reanuda idempotentemente. Finalizar espera alias coherente y eliminación acreditada de anterior/parciales/archivos en todas las superficies administradas; cero copias antiguas. Antes de commit fallo conserva anterior; después de commit no hay rollback a contenido eliminado.
5. Consultas validan versión/estado/validez y metadata por solicitud, con lock compartido durante lectura física; eliminación espera lock exclusivo. Antes de invocar/entregar revalidan evidencia: si cambió, una nueva búsqueda dentro plazo global, si no es viable se devuelve indisponibilidad sin contenido obsoleto. Actualización normal se verifica con consultas cada treinta segundos y cero errores.

Todos los escritores, incluida CLI existente, pasan por este servicio. Admin solo crea comandos por función permitida; kb_writer conserva escritura de matriz/colecciones. No hay transacción distribuida entre PG/Qdrant. Se introducen pruebas de fallos alrededor de cada fase y reinicios antes/después de corte, sin SQL arbitrario desde cliente.

Rechazo/retirada ocultan de matriz/excluyen recuperación desde commit de decisión; eliminación física termina antes de Terminada. Solo registro con documento/origen/hash/motivo/usuario/fecha/hora; cero contenido/vectores. Rechazo de versión nueva conserva anterior. Vencimiento filtra por fecha Bogotá aunque worker retrase marca; worker emite evento único. Cinco consultas por dato único y comprobación en todas las colecciones administradas prueban exclusión real.

## Fuentes y propuestas

Host permitido: envigado.gov.co con subdominios por límite de punto; www.concejoenvigado.gov.co, observatorioenvigado.geotrends.co, ambientometroenvigado.com exactos. HTTPS y lista se validan en registro/aprobación/redirect; no endpoint de host-list, prompt o modelo. Corpus001 se valida separadamente.

| Método/ruta | Permiso / entrada | Comportamiento |
| --- | --- | --- |
| GET /link-proposals | Gestor propias; técnico pendientes/todas con filtro | Paginación, tipo/URL/fecha/estado/motivo |
| POST /link-proposals | Usuario permitido `{type:add/remove,url,direction,justification}` | 201 pendiente, lista no cambia |
| POST /link-proposals/:id/withdraw | Propietario `{expectedRevision}` | Solo pendiente propia→Retirada, lista no cambia |
| POST /link-proposals/:id/approve | Técnico `{expectedRevision}` | Decisión+enlace+audit en tx, siguiente corrida aplica |
| POST /link-proposals/:id/reject | Técnico `{expectedRevision,motivo}` | Motivo obligatorio y lista intacta |
| GET /scraper-links | Técnico | Lista vigente/revision |
| POST /scraper-links | Técnico `{url,direction,justification,expectedListRevision}` | Agrega, registra actor/fecha y siguiente corrida |
| DELETE /scraper-links/:id | Técnico `{direction,justification,expectedRevision,expectedListRevision}` | Quita, no retira documento |

Quitar enlace con publicados genera aviso solo técnico con enlace/fecha/hora/usuario/documentos y marca Sin actualización automática; sin publicados no aviso. Próxima corrida recibe snapshot/hash/listVersion y no verifica esos documentos ni semilla; no los elimina por falta de fuente. Reagregar/retirar/reemplazar quita marca; manual jamás marcado. Propuesta rechazada/retirada no modifica enlaces.

Tombstone URL+hash de rechazo/retirada impide mismo contenido en siguientes corridas, y registra omisión; nuevo hash vuelve pendiente. No incluir texto en tombstone. Scraper consume snapshot controlado del worker, no consultas online ni credenciales de escritor; policy desplegada sigue autoridad.
