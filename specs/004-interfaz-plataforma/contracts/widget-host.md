# Contrato del Observatorio, launcher e iframe

RF-C4-UI-01/02, RNF-C4-UI-01/02/04 y RNF-C4-IN-01/02. Diseño objetivo.

## Instalación y descarga

Launcher fuente TypeScript independiente, compilado/minificado a `frontend/public/embed/geobot-launcher.js`; sin React, Next, imports dinámicos, CSS externo, fuentes, analytics, preconnect/prefetch ni imágenes remotas antes de primera activación. CSS mínimo y etiqueta Geobot incluidos en el artefacto; medir contenido descargado sin comprimir ≤10.000 bytes. Configuración por atributos de script: URL HTTPS iframe `/chat`, origen exacto del host oficial y ajustes geométricos de separación de controles acordados con portal, sin texto/IDs/contactos. El launcher genera botón nativo fixed inferior derecho y área contenedora aislada con estilos prefijados, sin CSS global al portal.

Primera activación crea un único iframe; posteriores ocultan/muestran el mismo nodo sin cambiar src, recargar, desmontar ni resetear sesión. Antes del clic, ninguna petición a dominio de Geobot salvo script. Medir tres sesiones con caché vacía e inspección network de página REAL. Logo/colores del botón provienen de guía oficial: resolver logo inline solo si cabe presupuesto, sin descarga pre-clic; el encabezado dentro iframe siempre usa logo oficial después de clic.

Ruta `/chat` exportable Next, API relativa al origen Geobot. Evitar rutas de fallback nginx que resuelvan accidentalmente a página heredada. Iframe `title="Conversación con Geobot"`, sin sandbox que convierta origen a null o bloquee enlaces/requests necesarios. Seguridad mediante CSP, aislamiento origen y renderer; no habilitar permisos de cámara, geolocalización ni micrófono que no exige spec.

## Geometría y foco

- Ancho host `<768`: overlay ocupa100 % del área visible; cierre siempre visible y campo dentro área con teclado. `>=768`: inferior derecho400 px, altura min(640 px,0.85×alto ventana), sin scroll horizontal del panel.
- Usar `visualViewport` DEL HOST (resize/scroll/offset) para geometría móvil/teclado, no confiar en la medición del iframe. Fallback window innerWidth/innerHeight. Clamp a área visible y safe-area; preservar regla contractual en escritorio y verificar dispositivos reales.
- Host transmite tamaño visual al iframe para su layout flexible, no texto. Encabezado fijo, historial flexible con scroll vertical, entrada sin desaparecer; solo contenedor de tabla permite scroll horizontal.
- Desktop: región no modal; Tab puede salir hacia Observatorio sin quedar atrapado. Al abrir por interacción, focus hacia inicio accesible en iframe cuando listo; no robar foco por respuestas o status. Cerrar restaura foco al botón.
- Móvil fullscreen: host actúa como diálogo modal accesible que contiene iframe, marca contenido externo inert mientras abierto y restaura exactamente sus estados al cerrar. Contener foco con coordinación host/iframe y probar teclado externo/VoiceOver/TalkBack; no convertir desktop en modal por conveniencia.
- Confirmación de nueva conversación es diálogo modal DENTRO iframe, foco inicial en Cancelar, Tab contenido, Escape cancela y devuelve foco a Nueva conversación. Confirmar reinicia y enfoca apertura/consentimiento nuevo.
- Hidden quita iframe de foco/árbol accesible, pero no aborta consultas. Botón informa aria-expanded y controla contenedor. Escape/cierre respetan nivel de diálogo: primero cancelar confirmación, luego ocultar panel.
- Detectar convivencia con controles del mapa en instalación y fixture; acordar separación/bottom-right gutter conservando anclaje. No cambiar z-index/CSS del mapa ni guardar su estado desde widget.

## Protocolo postMessage

Version1, mensaje `{namespace:"geobot-widget",version:1,type:...,payload:...}`. Tipos permitidos:

| Dirección | type | payload |
| --- | --- | --- |
| iframe→host | READY | vacío |
| iframe→host | CLOSE | vacío |
| host→iframe | VISIBILITY | visible boolean |
| host→iframe | FOCUS_START | vacío |
| host→iframe | VIEWPORT | width/height/offsetTop/offsetLeft números finitos no negativos; width/height positivos |
| iframe→host | FOCUS_BOUNDARY | dirección forward/backward solo para modalidad móvil |

Host valida event.origin == origen iframe configurado Y source==iframe.contentWindow; iframe valida origin==`https://observatorioenvigado.geotrends.co` Y source==parent; validar versión/type/tamaño/esquema, ignorar todo ajeno. Nunca `targetOrigin="*"`, nunca recibir origen permitido desde querystring de iframe. No texto de conversación, token, categoría, policyDecision o IDs en mensajes, DOM del host, storage o URL.

READY no concede autorización de datos. CLOSE solo oculta. VISIBILITY solo modifica foco/visibilidad, no reinicia. Datos de configuración oficiales se solicitan dentro iframe únicamente después de creación.

## Cabeceras y entorno

Nginx sirve `/chat` y su HTML exportado con `Content-Security-Policy: frame-ancestors https://observatorioenvigado.geotrends.co` real, sin wildcard/self/http/subdominios adicionales. Configurar también otras directivas según bundle Next estático: evitar recursos remotos no requeridos, scripts/controladores inline inseguros y peticiones a otros proveedores. Si export Next contiene scripts inline, usar hashes generados por build y verificar cabecera efectiva; no suponer que añadir script-src self basta. No usar X-Frame-Options SAMEORIGIN/DENY conflictivo con host externo. Cabeceras de Express no sustituyen cabecera del HTML de nginx; frame-ancestors no se configura en meta ni se hereda de default-src.

Test local de flujo utiliza variante de configuración separada para fixture host localhost; jamás añade localhost al origen producción. Pruebas CSP de origen EXACTO se hacen con resolución/harness de host oficial en entorno de aceptación y en móviles, incluyendo dos válidas/tres inválidas más inspección. No cambiar orígenes mediante panel ciudadano.

## Identidad

Guía futura `guia-estilo.md` en carpeta004: URL/fecha/hash de CSS/logo oficial, selector/valor fuente → token widget, hexadecimales/familias/tamaños/pares y ratios de contraste. 100 % colores/fuentes registrados y coincidentes; diez elementos inspeccionados y logo Geobot. Prohibido usar avatar actual como logo institucional sin evidencia. Entrega de guía/assets es tarea de implementación, no una guía inventada en diseño.
