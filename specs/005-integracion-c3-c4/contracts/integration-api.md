# Contrato integrado ciudadano C3–C4

RF-C3-IN-01..10 y RF-C4-IN-01..06. Adopta [API SPEC002](../../002-diseno-modelo-ia/contracts/chat-api.md) y [contrato SPEC004](../../004-interfaz-plataforma/contracts/citizen-api.md). No añade endpoint alternativo ni selector de modelo. Este documento define la corrección objetivo, no afirma que ya está ejecutada.

## Superficies

| Método/ruta | Entrada | Salida y efecto |
| --- | --- | --- |
| POST /api/session | Solicitud técnica sin contenido ciudadano; Origin explícito en arnés y control existente | Token solo memoria; no consentimiento ni conversación. Sin replay de generación tras 401. |
| GET /api/chat/config | Sin LLM; mismo origen puede omitir Origin | 200 apertura/politica/opciones/contactos existentes, bloque íntegro/revisión vigente. ≤2 s; error seguro si falta. |
| POST /api/conversations | Bearer, Origin, {autorizacion:true, policyVersion vigente} | 201{modo:"conversación", conversationId UUID v4 de C3}; una creación por autorización, sin ID cliente |
| POST /api/chat | Bearer, Origin, JSON español≤131072 bytes | 200 éxito con modo/tipo/texto/fuentes; respuesta≤40 s; sin elegir proveedor/modelo |
| POST /api/ratings | Bearer, Origin, responseId, valoracion, motivo según elección | 201 solo tras commit; VALIDACION uniforme para inexistente/ajeno/depurado/duplicado/motivo/texto libre |
| OPTIONS a POST ciudadanos | Origin exacto/método/headers permitidos | 204 solo permitido, 403 no permitido/sin Origin; no modelo/registro ni cuota consulta |

Para Origin, IP, no-store y errores anteriores a lectura se aplica [runtime-security](runtime-security.md).

## Petición y resultado

Petición autorizada: `{pregunta,conversationId,categoria?,historial?:[{pregunta,respuesta}]}`. Categoría exacta Ecosistemas/Bienestar Animal/Gestión Ambiental con espacios y tildes de la fuente. No estoy seguro→omitir categoría. Primer turno omite historial; siguientes últimos 10 pares completos cronológicos. Backend recorta 15→10; sin ID+historial rechaza. Pregunta vacía/categoría ajena/par incompleto producen 400 VALIDACION con campo, 0 LLM/0 interacciones. Payload legado `message/history/provider/model/autoRoute/autorizo` no se acepta.

Anónima `{pregunta,categoria?}`:sin conversationId/historial/responseId; no crea fila de conversación. Solo seis campos de consumo al éxito; nunca rating.

Éxito: `{modo,tipo,respuesta,fuentes,conversationId?,responseId?}`. Tipos exactos respondida/sin información/fuera de alcance/aclaración; son éxitos para completar un intercambio. Fuentes `{id,nombre,enlace:https,fecha:AAAA-MM-DD}`, únicas por documento realmente citado/intersectado con recuperación; fuentes=[] en tipos no respondida. Se generan desde evidencia, sin exigir JSON al modelo.

responseId UUID v4 solo autorizado y confirmado; conversación exitosa sin escritura sigue 200 sin responseId y respuesta completa. Cliente exige coincidencia de modo/conversationId vigente; no acepta 200 incompleto como éxito. Solo con responseId hay valoración.

Valoración útil `{responseId,valoracion:"Útil"}` sin motivo; no útil `{responseId,valoracion:"No útil",motivo}` entre «Información incorrecta», «Información desactualizada», «No responde mi pregunta», «Difícil de entender», «Otro». No campos adicionales ni texto libre. Propiedad por sesión, unicidad DB y bloqueo frente a purga.

## Tiempo, fallos y contactos

RequestContext desde recepción de headers en backend cubre lectura/auth/cola/conversación/recuperación/LLM/registro/error. Valor de fecha y duración proviene de ese inicio, no de admisión. Antes de 40 s completa 200 o error; escritura fallida se resuelve sin ID si ya hay respuesta. Si no puede comprobarse conversación, no cambiar a anónima. Reservar margen para transmitir; contactos del error con presupuesto y [] si no están disponibles a tiempo. Contactos faltantes no hacen desaparecer error.

Catálogo público `{error:{codigo,mensaje,campo?},canales}`; VALIDACION400, SERVICIO_NO_DISPONIBLE503, ERROR_INTERNO500; perímetro 403/413/429/401 según contrato. Sin modelo/proveedor/rutas/trazas/SQL. No se registran fallos como éxitos; eventos/avisos técnicos seguros del [modelo](../data-model.md). Ambos modelos caídos/búsqueda falla→503; reranker fallido→degradación RRF según SPEC002.

C4 inicia reloj 45000 ms antes de fetch y lo mantiene hasta leer/validar; timeout muestra salida 45–46 s, cancela y descarta epoch/sequence obsoleto. Nuevo intento tiene plazo propio, payload congelado, máximo 2 reintentos manuales tras inicial. Fallo no entra en historial; datos anteriores no aparecen al reiniciar.

VALIDACION sin Reintentar; ERROR_INTERNO/HTML502/cuerpo incompleto salida UI-08, sin exponer código/campo/mensaje.429 respeta Retry-After; 401 no autorrenueva/reenvía generación como anónima. Reutilizar textos/reinicio de SPEC004.

Contactos leídos al cargar≤5 s cliente; si faltan, repetir al elegir emergencia/fallo. Mensaje literal «No pudimos cargar los canales de atención. Consulte los canales oficiales del Municipio de Envigado.» con enlace oficial configurado, sin valores fijos. Un snapshot válido mantiene contactos vigentes desde última lectura, y nueva lectura usa revisión actual.

## Memoria e incrustación

Token/IDs/textos/historial solo memoria iframe; no storage/cookie/URL/postMessage al host. Ocultar/mostrar 5 veces conserva, recarga/cierre pierde y nueva autorización genera ID distinto. Confirmar nueva conversación invalida epoch antes de cancelación; sin contexto previo.

Origen API es del ChatBot. Host permitido iframe es https://observatorioenvigado.geotrends.co; protocolos/política SPEC004 se mantienen. Pruebas reales Chrome y Firefox+móviles/lectores, cabecera CSP nginx efectiva; fixtures no acreditan reales.
