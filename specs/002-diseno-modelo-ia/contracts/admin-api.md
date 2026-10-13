# Contrato de administración mínima

Superficies necesarias para RF-C3-DI-03/06/19/20/24; RF-C3-AD-08/09/10/28/29/30/35/36/37/41/48, RNF-C3-AD-01..07/09. Diseño objetivo. Prefijo `/api/admin`; todo servicio y pantalla requieren identidad propia del panel, distinta de sesión ciudadana.

## Autenticación y permisos

`POST /session` `{email,password}`: éxito 200 establece cookie opaca HttpOnly/Secure/SameSite=Strict, devuelve perfil y `mustChangePassword`, nunca PHC/password. Error 401 idéntico para cuenta inexistente, password incorrecto o cuenta bloqueada. Bloqueo por cuenta tras 5 fallos consecutivos, 15 min; exitoso reinicia contador. IP20 fallos/ventana 15 min→429/Retry-After, bloquea 15 min sin verificar password. Login exitoso reinicia los fallos de esa IP, incluido caso 19 fallidos+éxito+5 sin bloqueo. IP del proxy confiable, no header arbitrario cliente.

`GET /session`: cuenta/perfil y estado de cambio obligatorio; refresca last_request_at real. Inactividad 30 min→401 sin datos. `DELETE /session`: revoca cookie/sesión. `POST /password` con `{currentPassword,newPassword}` y CSRF: nueva≥12, sin requisitos de composición, contraseña actual obligatoria/correcta; temporal debe reemplazarse por un valor distinto. Hasta ese cambio solo session/password/logout; servicios y rutas directas restantes rechazados.

Bootstrap protegido de infraestructura, no endpoint público ni credencial default. Dos perfiles exactos: administrador técnico y Gestor documental. Gestor puede iniciar sesión/cambiar propia contraseña; contactos/estado/notificaciones de sistema siempre 403 y sin datos, incluso llamando directamente. Gestión web completa de cuentas/documentos fuera de fase; invariantes del último técnico y revocación se implementan en los servicios de identidad/DB.

Mutaciones autenticadas exigen CSRF vinculado a session; verificar Origin/Content-Type, sin pasar token en URL. Cuerpo/login/password nunca entra en logs. Inicialmente un backend para autoridad de sesiones en memoria; escalar réplicas requiere invalidación coordinada antes de habilitarlo, no confiar en cache de roles.

## Contactos

`GET /contacts`: `{revision,recepcion:{pqrsd,whatsapp,email},general:{phone,email,url},inmediatos:[{id,name,description,type,value,position}]}`. Sin valores ficticios ni hardcoded. `PUT /contacts/reception`, `PUT /contacts/general`: body incluye revision y entidad completa. `POST /contacts/immediate` añade; `PUT /contacts/immediate/:id` modifica; `DELETE` elimina si queda≥1; `PUT /contacts/immediate/order` lista de IDs completa sin duplicados.

Todo éxito aumenta revision y actualiza actor/fecha en misma transacción que auditoría. Valores vacíos/inválidos 422 `{error:{codigo:"VALIDACION",campo,mensaje}}`; PQRSD/URL https, teléfonos dígitos/símbolos permitidos, email válido, descripción≤120, lista≥1. revision obsoleta 409 sin cambios ni pérdida de otra edición. Guardado autorizado debe aparecer en siguiente respuesta sin redespliegue/caché TTL. No eliminar ninguno de los tres canales de recepción.

## Estado

`GET /status`: modelos 20b/120b con disponibilidad, lastFailureAt y lastSuccessAt; reranker status y thresholdApplied; scraper última ejecución fecha/resultado de KB; escritura estado/lastFailureAt. Nunca textos de consulta/secretos/stack/SQL; disponibilidad observada o no comprobado, no booleano credencial=configurada. Poll del panel≤15 s, actualizaciones por eventos del runtime+lectura KB≤15 s para estados visibles<60 s; hora cliente no se usa como evidencia de evento. El polling es una solicitud válida y mantiene sesión; pausar polling al verificar 29/31 min de inactividad.

Para caída de write pool con read pool vivo, leer estado normal. Para caída total de DB, servir solo estado/avisos volátiles a sesiones técnicas previamente autenticadas en el registro autoritativo del único runtime, con expiración 30 min y controles locales; nuevos logins/mutaciones se bloquean. No persistir datos de ciudadano en overlay. Ninguna revocación en proceso normal puede dejar una sesión cache vigente: invalidación sincrónica. Reinicio con DB caída borra sesiones→401; no modo administración abierta para ver estado.

## Avisos

`GET /notifications?estado=no_revisada|todas`: entradas descendentes por última ocurrencia con id, type, description, state, firstAt, lastAt, repetitions, reviewedBy/reviewedAt y contador no_revisadas. Lista integrada de KB/operación con permisos de sistema, contador en todas las pantallasdel panel mínimo.

`POST /notifications/:id/review` con CSRF: marcar revisada una sola vez, actor/fecha, conservar fila, descontar contador. Gestor 403 en avisosde sistema. Repetido tipo+objeto no_revisada agrupado; tras revisar nueva ocurrencia abre aviso. No webhook/email ni destinos externos. Fallo de escritura de interacciones 1 aviso por episodio, 6 fallos consecutivos no 6 avisos; primer éxito restablece. DB caída aviso volátil sanitizado y persistencia al restablecer, sin textos retenidos para reintentos.

## Auditoría y accesibilidad

Mutaciones de contactos/revisión/cuentas con actor/objeto/acción/resultado/fecha. Auditoría append-only por privilegios, sin rutas update/delete ni contenido confidencial. Pantallas login/password/contactos/estado/avisos: teclado, foco visible, labels, mensajes de campo asociados, contraste/lector WCAG 2.1 A/AA; links https nueva pestaña. No exponer JSON de tecnología dentro de flujo ciudadano.

## Verificación

Ediciones válidas 3 recepción/3 general, rechazo 4 formatos por grupo, 10 acciones inmediatas, actualización siguiente consulta; Gestor 401/403 sin datos; bloqueo 5/15 e IP20/15 y sesión 29/31 min; último técnico protegido frente a dos operaciones concurrentes; estados forzados 5 y avisos listados/revisados/agrupados según tablas del PDF. Evidencias manuales del panel real, no solo mocks HTTP.
