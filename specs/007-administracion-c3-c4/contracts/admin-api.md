# Contrato común, identidad y permisos — SPEC007

RF-C3-AD-05..13/28..31/40/41/48; RNF-C3-AD-01..06. Ampliación de `specs/002-diseno-modelo-ia/contracts/admin-api.md` y seguridad SPEC005. Rutas nuevas son propuestas para implementar, no servicios disponibles hoy.

## Transporte y controles

Base `/api/admin`, HTTPS en producción, cookie de sesión opaca actual `geobot_admin` HttpOnly/Secure/SameSite. CSRF actual `X-CSRF-Token` para POST/PATCH/PUT/DELETE; validar Origin del panel. Ampliar CORS solo para métodos/cabeceras administrativas necesarias del origen permitido, sin habilitar comodines ni modificar las guardas ciudadanas. JSON general mantiene64KiB; multipart se controla aparte. `Cache-Control:no-store` en datos privados y rechazos. No enviar PHC/contraseña/token/SQL/trazas/proveedor.

Error uniforme `{error:{codigo,mensaje,campo?}}`: 400/422 validación,401 sin sesión válida,403 perfil/acción prohibida,404 recurso ajeno que no debe revelar existencia,409 revisión/estado/operación conflictivos,413 cuerpo excesivo,429 bloqueoIP con Retry-After entero,503 dependencia no disponible sin datos. Contraseña errónea, cuenta bloqueada y correo inexistente tienen mismo401/mensaje. DB inaccesible no autoriza overlay antiguo.

Identidad siempre procede de sesión; `usuario`, `owner`, `perfilInvocador`, rutas SQL y roles suministrados por cliente se rechazan. Revalidar permiso antes de commit de mutación. Cuenta con cambio obligatorio solo session/password/logout; todo el resto denegado. Revocar sesiones atómicamente en cambios de cuenta sensibles. Mutaciones exigen revisión de entidad existente y CSRF; no devolver éxito por job encolado:202 significa aceptado/En curso, no Terminada.

Listas `{items,total,nextCursor,revision?}` con cursor opaco estable, limit default25 máximo100, orden contractual más ID como desempate; COUNT SQL y filtros parametrizados. Cursor incluye alcance/rango/orden del filtro, no se puede reutilizar para evadir permiso ni contiene texto/IDs públicos de conversación.

## Matriz de permiso

| Acción | Administrador técnico | Gestor documental |
| --- | --- | --- |
| Session/logout/cambiar contraseña propia | Sí | Sí |
| Cargar documento y leer matriz completa | Sí | Sí, filtro propio disponible |
| Publicar/rechazar/retirar/editar/reindexar | Sí | No |
| Crear/ver/retirar propuestas propias pendientes | Sí, propias cuando corresponda | Sí |
| Ver propuestas de otros/decidir/cambiar enlaces directamente | Sí | No |
| Contactos/cuentas/auditoría/bandeja/estado/tableros/interacciones/export/mejoras | Sí | No |
| Avisos | Todos | Solo rechazo/OCR/indexación de sus cargas |
| Cambiar hosts/prompt/modelos desde panel | No | No |
| Recuperación SQL reservada | Solo rol operativo contratista fuera del panel | No |

## Identidad y cuentas

| Método/ruta | Entrada / resultado | Criterio |
| --- | --- | --- |
| POST /session | Conservar contrato login actual | RNF01/04/06 |
| GET /session | Cuenta/nombre/perfil/cambio obligatorio/CSRF, jamás PHC | RNF01/05 |
| DELETE /session | Revoca sesión actual | RNF01/05 |
| POST /password | Conservar contraseña actual/nueva del contrato vigente | AD09/10 |
| GET /accounts | Paginado, id/nombre/email/perfil/activa/revision | AD05..08 |
| POST /accounts | `{nombre,email,perfil,password}` →201 cuenta sin secreto | AD05, RNF02/03 |
| PATCH /accounts/:id | `{expectedRevision,active?,perfil?}`, al menos un cambio permitido | AD06..08 |
| POST /accounts/:id/temporary-password | `{expectedRevision,password}` para otra cuenta →200 sin secreto | AD10/11 |

Correo trim/lowercase único, nombre no vacío pero repetible; perfiles exactos de fuente. Contraseña no se recorta; mínimo12puntos de código, sin regla de composición. Creación/temporal obliga cambio y no reutiliza temporal como nueva. Desactivada se conserva con historia; reactivar restaura perfil sin sesiones. Cuando PATCH cambio de perfil deje cero técnicos activos→409 con motivo. No se ofrecen otros cambios de identidad no aprobados.

Login: guardia por IP confiable antes de credenciales, veinte fallos en ventana quince minutos→bloqueo quince; éxito reinicia conteo según recorrido fuente. Cinco fallos consecutivos cuenta→quince minutos y notificación de sistema; verificar incrementos concurrentes. Toda request válida renueva backend; treinta minutos sin requests→401. UI cesa sondeos tras sesenta segundos sin interacción explícita y al ocultarse; timer humano treinta minutos cierra/revoca best effort, sin renovar por actividad ficticia.

## Recuperación y arranque

Bootstrap solo instalación sin cuenta inicial; no reemplaza usuarios existentes. Cuenta técnica Geotrends se entrega con evidencia, puede asignar temporal a otro técnico y Municipio puede desactivarla salvo último activo.

`CALL admin.recover_password(email, temporary_phc)` con exactamente dos parámetros, role contractor_recovery, owner sin login, search_path fijo y EXECUTE revocado a PUBLIC/admin_app/chat_app/app_reader/kb_writer. Error si correo inexistente, no otra fila/perfil/estado modificado. Reset de bloqueo, marca cambio y revocación de sesiones en misma transacción. PHC válido argon2id; utilidad privada obtiene contraseña por stdin/TTY, hash local, query parametrizada y sin log de parámetros.

Wrapper reservado es la vía operativa soportada y única que recibe el rol: éxito audita transaccionalmente una fila, error hace rollback y escribe una fila segura en conexión/transacción separada de auditoría restringida. Actor es rol invocador real, no owner del definer. No se promete auditoría persistida dentro de una transacción abortada. Si falta evidencia de registro del intento, AD41 no se declara verificado. Manual técnico explica protocolo; no hay API pública ni se ejecuta CALL durante planificación.
