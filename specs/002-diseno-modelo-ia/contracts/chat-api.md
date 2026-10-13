# Contrato HTTP ciudadano

Diseño objetivo, no endpoints ya implementados. RF-C3-IN-01/02/03/04/05/06/07/08/10, C4-DC-01/02, todos los requisitos DI afectados. Prefijo `/api`; mismo origen nginx. JSON UTF-8, `Cache-Control:no-store`; cuerpo≤131072 bytes, sin límite de caracteres adicional; 60 consultas/min/IP en ventana deslizante, proxy confiable. Rechazo 413/429 sin proveedor ni registro; Retry-After en 429. Origen fuera allowlist rechazado. Nunca aceptar modelo/proveedor/prompt enviado por ciudadano.

## Acceso y autorización

`POST /api/session`: token técnico de acceso en memoria, no autorización de datos ni conversationId. Respuesta `{token,expiresIn}`. No guardar token/UUID/IP del modo anónimo. Renovar acceso no autoriza ni importa historial.

`GET /api/chat/config`: apertura fija que identifica Geobot/alcance y política de datos municipal con versión/URL oficial; opciones Autorizo/No autorizo y bloque completo de contactos del registro (recepción PQRSD/WhatsApp/correo, general e inmediatos), sin detalles de modelos. Servicio de solo lectura en≤2 s, sin LLM; probar 3 llamadas y cambio visible tras edición, RF-C3-IN-10. No habilitar chat antes de decisión. Valor oficial faltante indica servicio no preparado; no inventar contacto.

`POST /api/conversations`, Bearer técnico, body `{autorizacion:true,policyVersion}`: generar UUIDv 4 backend y ligar a sesión técnica. Respuesta 201 `{modo:"conversación",conversationId}`. Validar versión política presentada. Con autorizacionfalse no crear nada: cliente opera anónima; cuerpo indebido 400VALIDACION. UUID desconocido o ajeno nunca habilita registro/historial.

## Consulta

`POST /api/chat`, Bearer técnico. Campos públicos en español, sin compatibilidad que habilite proveedores viejos:

```json
{
  "pregunta": "¿Cómo solicito el trámite?",
  "conversationId": "UUID emitido por el backend, solo con autorización",
  "categoria": "Ecosistemas",
  "historial": [{"pregunta":"Consulta previa", "respuesta":"Respuesta previa exitosa"}]
}
```

`pregunta` obligatoria texto no vacío. conversationId opcional: ausente determina anónima; categoria opcional solo tres direcciones. `historial` opcional, array de pares completos no vacíos, solo con UUID emitido. Validar todos los pares antes de conservar últimos 10; no truncar silenciosamente cada pregunta ni aceptar mensajes role/content incompletos. Token no sirve como conversationId. Campo de proveedor/modelo/autoRoute se rechaza con VALIDACION; la ruta antigua `/providers` se retira del público. Ajustar frontend y API juntos; no mantener ruta legado capaz de llamar otros LLM.

Éxito 200:

```json
{
  "modo":"conversación",
  "conversationId":"UUID backend",
  "responseId":"UUID backend tras escritura confirmada",
  "tipo":"respondida",
  "respuesta":"Orientación en Markdown con citas fechadas y cierre de canales",
  "fuentes":[{"id":"id documental","nombre":"Nombre","enlace":"https://fuente-oficial","fecha":"2026-10-08"}]
}
```

`tipo`: respondida/sin información/fuera de alcance/aclaración. `fuentes` contiene una entrada por documento citado después de DI-08; vacía para tipos distintos de respondida. Fechas: última actualización o acceso según fuente. `responseId` solo en conversación y registro confirmado; ausente por fallo IN-08, respuesta se entrega. No devolver uso/costo/proveedor/modelo/requestId AWS ni trazas en público.

Anónima 200: `{modo:"anónima",tipo,respuesta,fuentes}`, sin conversationId/responseId; no historial recibido ni persistido. No hay aclaración pendiente que se arrastre entre consultas anónimas: todas son autónomas por C4-DC-02. La pregunta insuficiente puede pedir reformulación completa; se controla la segunda insuficiente tras aclaración en las conversaciones autorizadas. Mostrar aviso fijo de que no se conserva la conversación y cada pregunta debe formularse completa. Tipos/categoría/fuentes pueden viajar al ciudadano según contrato, nunca persistirse en registro técnico anónimo.

## Errores

Formato `{error:{codigo,mensaje,campo?},canales:[canales vigentes pertinentes]}`.400VALIDACION con campo, 503SERVICIO_NO_DISPONIBLE por doble fallo/búsqueda, 500ERROR_INTERNO; sin proveedor/modelo/rutas/trazas SQL. Código local de catálogo/región no se divulga. Ninguna falla de búsqueda se devuelve como sin información. Deadline≤40 s para toda consulta, incluyendo cola/cancelación/escritura.

## Reglas de contenido

Ausencia: exactamente «No encontré información validada…» más canal oficial, sin citas/datos adicionales. Aclaración solo un turno, sin fuentes. Fuera de alcance declara tres direcciones+contacto general, no contesta la materia. Decisión/concepto incluye información base, responsable y leyenda exacta. AdvertenciaPII primero; canales inmediatos antes de orientación de riesgo; tres canales de recepción al cierre de respuestas de trámite. Citas dentro del texto, sin HTML bruto de modelo. Links https, nueva pestaña, saneamiento semántico por allowlist; texto ciudadano plano. Las referencias técnicas/marcadores no se muestran.

## Escritura y autenticidad

Intento de registro acotado después de composición y antes de emitirUUID de respuesta; éxito confirma una fila por consulta, no escritura fire-and-forget seguida de id ficticio. Error escritura omite id y produce una sola notificación por episodio. Anónima guarda solo fecha/modo/modelo/tokens/costo; no hashes del texto ni IP/session token. LoggingHTTP excluye cuerpos/Authorization/respuestas. Tests deben inspeccionar salida al proveedor y todos los destinos persistentes, no solo la tabla principal.
