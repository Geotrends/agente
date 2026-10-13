# Operación, avisos, auditoría y contactos — SPEC007

RF-C3-AD-28..31/35..37/40/41/48; RNF-C3-AD-01/08/09. Reutilizar contratos/rutas de SPEC002; operaciones documentales en [documents-sources.md](documents-sources.md).

## Avisos y contadores

`GET /api/admin/notifications?estado=&cursor=&limit=` devuelve unión KB/admin autorizada, más reciente primero por última ocurrencia/id. Campos id namespace,tipo,fecha/hora,descripción,estado,repeticiones; para carga incluye documento sin contenido. Técnico ve sistema y cargas, Gestor solo rechazo/OCR/indexación de sus cargas. Mismo permiso en conteo y lectura directa, nunca owner arbitrario por parámetro.

Conservar ruta de revisión actual `POST /notifications/:id/review`; ampliar el parser de ID para namespace KB/admin y mantener cliente/router coherentes. `{expectedRevision}` y CSRF. Revisa una vez con actor/fecha/hora, conserva fila y reduce contador; ajena/sistema al Gestor403/404 sin datos. Misma type/object/scope/owner agrupa solo No revisada, suma repeticiones/última ocurrencia; posterior a revisada crea otra con uno. Audit transaccional no sustituye aviso.

`GET /api/admin/counters`: `{notifications,pending?,openImprovements?}`. Técnico todas, Gestor solo propias notificaciones; contador agrupadas cuenta filas, no repeticiones. Actualización después de mutación y sondeo mientras actividad humana reciente; no mantener sesión indefinida.

`GET /api/admin/pending`: técnico, documentos pendientes+propuestas pendientes, type/nombre o URL/origen/fecha/días, antiguo→reciente; cursor/limit/total. Días civiles Bogotá nunca negativos. Publicación/decisión reduce contador al confirmar cambio efectivo, no al encolar trabajo sin finalizar.

## Auditoría y estado

`GET /api/admin/audit?usuario=&accion=&desde=&hasta=&cursor=&limit=`: técnico, actor cuenta o rol real,acción,objeto,fecha-hora,resultado. Unión historia admin/KB, sin payloads de documento/contraseña/PHC. No PUT/PATCH/DELETE ni permisos DB de borrado. Cada mutación aceptada y recuperación éxito queda en misma tx; intento rechazado que hizo rollback se registra en otra tx segura, según contrato de recuperación. Si acción no puede auditarse, no confirmar modificación.

`GET /api/admin/status`: conservar DTO actual y ampliar tiempos/fuente de evidencia si falta; modelos20b/120b disponibles y último fallo, reranker y umbral aplicado, última corrida scraper fecha/hora/resultado, estado escritura. Hydratar estados persistidos al reinicio; `no comprobado` no se inventa como normal. Cinco fallos del criterio visibles<60s. DB que no permite validar sesión→503 sin datos; falla de escritura con lectura disponible sí puede verse autenticada. Nunca rutas/SQL/cuerpos del proveedor.

## Contactos

Conservar GET/PUT del registro actual y cuerpo/CSRF/revision CAS de `specs/002-diseno-modelo-ia/contracts/admin-api.md`; no construir tabla o cache paralelo. Rutas verificadas: GET /contacts; PUT /contacts/reception y /contacts/general; POST /contacts/immediate; PUT /contacts/immediate/order y /contacts/immediate/:id; DELETE /contacts/immediate/:id. Se conserva cuerpo actual, incluido revision, y se prueba compatibilidad existente.

- Recepción: PQRSD HTTPS, WhatsApp formato `[0-9 +()-]` con dígito, correo válido; tres obligatorios, ningún DELETE de canal.
- General: teléfono/correo/enlace HTTPS, tres obligatorios.
- Inmediatos: alta/modificación/baja/reorden, nombre y descripción no vacíos,≤120 puntos de código, valor según tipo teléfono/correo/HTTPS; siempre≥1 y posiciones consistentes. Corrección concreta de `validateImmediate`: vacío/solo espacios debe rechazarse, también121.

Cambio confirma una nueva revisión/auditoría; siguiente respuesta/bloque de contactos/emergencia/riesgo usa orden/valor nuevo sin redespliegue ni LLM. Gestor denegado en pantalla y servicio. Clientes siguen plazos C3≤2s/C4≤5s, salidas seguras ya aprobadas. Editor no permite prompt/modelo/hosts/tarifas de otros modelos.
