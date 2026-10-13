# Contrato ciudadano e integración — SPEC004

Adopta [contrato de SPEC002](../../002-diseno-modelo-ia/contracts/chat-api.md); reemplaza como diseño objetivo las formas incompatibles del contrato003 antes de implementar su cliente. RF-C4-IN-01..06, RF-C4-UI-03/04/05/07/08, RNF-C4-UI-03 y RNF-C4-IN-01. No endpoints ya terminados.

## Acceso, configuración y autorización

- `POST /api/session`: token técnico, solo memoria del iframe. No equivale a consentimiento/ID. Obtener/validar acceso antes de envío; no renovar y reejecutar generación automáticamente tras401. Si expiración destruye pertenencia, solicitar reinicio/autorización/ID nuevos, sin reasociar historial anterior.
- `GET /api/chat/config`: `{apertura,politica:{version,url},opciones,contactos}`; contactos `{revision,recepcion:{pqrsd,whatsapp,email},general:{phone,email,url},inmediatos:[{id,name,description,type,value,position}]}`. Solo lectura, no LLM, no-store, servicio≤2 s; cliente máximo5 s. Se monta al primer abrir iframe, nunca antes del primer clic.
- `POST /api/conversations`, Bearer, `{autorizacion:true,policyVersion}`;201 `{modo:"conversación",conversationId}`. Una solicitud por nueva autorización, bloquear doble clic; versión vigente y vínculo seguro a sesión. Anónimo no llama esta ruta. No permitir usuario elegir UUID.
- Consulta habilitada después de apertura/datos/categoría y, si autorizado, ID confirmado. No seguro→omitir categoría, no excluir documentos de otras áreas. Emergencia muestra inmediatos sin consulta/modelo ni exigir consentimiento; volver a flujo normal.

Si config no cargó íntegra, no inventar apertura/política; bloquear consulta y permitir salida al Municipio. Datos oficiales faltantes no son valores por defecto. Contactos fallidos: repetir al elegir emergencia y al entrar a fallo; agrupar solicitud en vuelo para no duplicar, con límite5 s. Mientras no hay snapshot, mostrar literal «No pudimos cargar los canales de atención. Consulte los canales oficiales del Municipio de Envigado.» y enlace de salida HTTPS oficial configurado en build institucional y validado. Enlace no contiene teléfono/correo ni se obtiene del C3 caído. Nuevo snapshot se usa desde siguiente carga; fallo con snapshot existente no solicita canales otra vez.

## Consulta/respuesta

`POST /api/chat`, Bearer, JSON UTF-8, no-store. Forma autorizada:

```json
{"pregunta":"¿Cómo solicito el trámite?","conversationId":"UUID de backend","categoria":"Ecosistemas","historial":[{"pregunta":"Pregunta previa","respuesta":"Respuesta previa válida completa"}]}
```

Primera autorizada omite historial; siguiente envía hasta diez pares completos cronológicos. Anónima solo pregunta y categoría opcional; sin conversationId/historial/valoración. No `message`, `autorizo`, `history`, `provider`, `model` o `autoRoute`. Cuerpo≤131072 bytes; sin límite adicional arbitrario de2500 caracteres cliente, no truncar pregunta.

200: `{modo,tipo,respuesta,fuentes,conversationId?,responseId?}`. Modo conversación/anónima; tipo respondida/sin información/fuera de alcance/aclaración; fuentes `{id,nombre,enlace:https,fecha}`. ID respuesta solo autorizado y commit confirmado; respuesta sin ID por fallo de registro sigue visible, sin valoración. Cliente valida forma antes de usar; nunca muestra meta/proveedor/modelo/SQL/errores técnicos.

Un intento guarda payload completo original en memoria. Estado pendiente se establece síncronamente antes de fetch y bloquea campo/envío hasta respuesta/fallo. Región status estable anuncia «Geobot está buscando en la información institucional…» en≤500 ms sin mover foco; animación se reduce con prefers-reduced-motion conservando texto. No polling de indexación con textos técnicos.

## Fallos y plazo

Reloj45 s cubre fetch/lectura/validación desde envío, no se reinicia por ocultar, obtener cabeceras o dialogar. C3 mantiene≤40 s. AbortController cancela al límite; guardas epoch+sequence descartan callbacks/JSON/errores tardíos. Entre45–46 s se muestra literal «En este momento no puedo responder. Puede intentarlo de nuevo o comunicarse por los canales oficiales.» y canales recepción del snapshot; sin valoración.

Error catálogo003/002 mapeado por cliente: VALIDACION→fallo sin Reintentar; SERVICIO_NO_DISPONIBLE/ERROR_INTERNO/no interpretable/HTTP502HTML→fallo recuperable. Otros rechazos de perímetro/401 se tratan seguros sin revelar cuerpo y sin auto-generación;429 respeta Retry-After al habilitar nuevo intento, sin superar dos reintentos manuales. No inferir éxito de HTTP200 si estructura/cuerpo faltan.

«Reintentar» copia pregunta/categoría/ID/pares del payload previo al fallo. Máximo dos después del inicial; cada uno45 s. No duplicar pregunta visible por reintento ni añadir errores al historial. Éxito crea un único par; sin información/fuera de alcance/aclaración válidos son respuestas, no fallos de servicio. Nueva pregunta independiente inicia otro presupuesto, solo sin intento activo. Reinicio cancela/descarta todo anterior.

## Presentación segura

Parser Markdown AST+GFM, sin ejecutar HTML ni dangerouslySetInnerHTML. Convertir AST a nodos React con allowlist exacta `p br strong em ul ol li table thead tbody tr th td h3 h4 a`. Atributos: a href(https)/target(_blank)/rel(noopener noreferrer)/aria-label; th scope(col); atributos de idioma/accesibilidad necesarios controlados por renderer, nunca de entrada. Ningún evento/estilo/src/atributo arbitrario de C3.

H1/H2 normalizar a h3; H5/H6 a h4. Código inline/bloque conservar como texto sin code/pre; reglas horizontales omitir. HTML bruto no se interpreta: eliminar nodos HTML, incluido contenido ejecutable, sin renderizar etiquetas. Preservar texto Markdown normal, énfasis/listas/tablas/citas. Límites sintácticos malformados no abren superficies HTML. Consultas renderizar como string React sin parser.

ExternalLink aplica a política/citas/canales. Dentro contenido restringido usar solo `a` (nombre accesible incluye sufijo) y marcador visual de apertura externa como texto, sin svg/span en subtree de respuesta. CSS no agrega colores fuera de guía. Fuera respuesta puede usar icono decorativo. No mailto/tel/http ni javascript/data: valores de teléfono/correo se presentan legibles como texto, WhatsApp/PQRSD y enlaces oficiales solo HTTPS validados. No inventar otro canal al convertir enlace. URL inválida se elimina como enlace; no modificar cita/fecha inventando datos.

Contenedor scroll de tablas pertenece a shell del renderer fuera de contenido permitido; tabla semántica conserva th scope. Si hay varias tablas, gestionar wrappers de presentación separados fuera de cada subtree de contenido y comprobar allowlist en todos. Texto/historial permanece en iframe, sin URL/storage ni mensajes al host.
