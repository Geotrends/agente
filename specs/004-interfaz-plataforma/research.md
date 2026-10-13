# Investigación y decisiones — SPEC004

Fecha2026-10-08. Fase0 completada. Investigación de agentes despachada por instrucción de `speckit-plan`: interfaz/portal y contratos/persistencia. Se combinaron lectura del repositorio y documentación técnica primaria. No se instaló ni implementó software.

## R01 — Una sola interfaz conversacional y contrato español

**Decision**: Adoptar contrato002 y GET /api/chat/config, ejecutar experiencia003 dentro layout real `frontend/app`, `chat`, `shared`, `smart`, sin árbol alterno `frontend/src` ni controladores paralelos.
**Rationale**: 003 describe campos/rutas distintos del objetivo002; ruta activa todavía legacy. Reducer/cliente único evita consentimientos, bienvenidas o contextos divergentes. RF-C4-DC-01..04, IN-01/02/06.
**Alternatives considered**: Traducir en backend ambos contratos (perpetúa acceso legacy); reimplementar shell completo separado (duplica estado). Actualizar tabla de equivalencias003 antes de sus tareas, sin cambiar alcance funcional.
**Evidence**: [diagnóstico](diagnostico.md), contrato002, archivos routes/chat/chatConfig y SmartAgentPanel.

## R02 — Launcher independiente e iframe persistente

**Decision**: Build esbuild de launcher TypeScript sin React; ≤10.000 bytes sin comprimir, CSS mínimo inline y sin assets/fuentes externos antes del clic. Iframe se crea una vez y se oculta sin unmount.
**Rationale**: Cumple0 requests previas salvo script y conserva memoria. RF-C4-UI-01, RNF-C4-UI-01 y RNF-C4-IN-01. No prefetch/preconnect desde loader.
**Alternatives considered**: Montar Next widget directo (descarga framework antes de apertura), crear iframe anticipadamente con loading lazy (no garantiza cero solicitudes), desmontar al cerrar (pierde conversación).

## R03 — Geometría móvil y mensajes mínimos

**Decision**: Launcher mide VisualViewport de ventana SUPERIOR, comunica únicamente geometría/visibilidad/foco/cierre mediante postMessage validando origin/source/esquema. No texto ni IDs. Desktop400/min640,85 %; mobile fullscreen dentro viewport visible.
**Rationale**: El teclado cambia área visible; viewport del iframe no basta para inferir geometría del host. RF-C4-UI-02 y RNF-C4-IN-01/02. [MDN VisualViewport](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport) explica diferencia entre viewport visual/layout. [MDN postMessage](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage) fundamenta origen exacto y verificación del emisor.
**Alternatives considered**: Solo100vh del iframe (campo puede quedar cubierto), enviar conversación al host (privacidad), targetOrigin wildcard (riesgo de origen).

## R04 — Foco y accesibilidad

**Decision**: Desktop región no modal; mobile overlay modal con coordinación host/iframe y restauración inert/foco; diálogo de reinicio nativo/controlado dentro iframe, Cancelar inicial, Escape cancela. Status estable sin mover foco; animación respeta reduced-motion. Tablas th scope y scroll de tabla propio.
**Rationale**: Preserva uso del mapa y navegación inclusiva. RF-C4-UI-01..05/07 y RNF-C4-UI-02. [W3C patrón diálogo](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) fundamenta foco contenido/restaurado; [WCAG2.1](https://www.w3.org/TR/WCAG21/) es la norma contractual, no reemplazarla con solo score automático.
**Alternatives considered**: Atrapar foco en desktop (impide mapa), autoscroll/foco a cada respuesta (interrumpe lectura), usar axe como aceptación completa (no acredita teclado/lectores).

## R05 — Parser AST y renderer React por allowlist

**Decision**: Reemplazar parser regex interno manteniendo interfaz ChatMarkdown por unified+remark-parse+remark-gfm y visitor React estricto. HTML bruto eliminado, nodos desconocidos normalizados/omitidos y URL solohttps. Shell tabla fuera del contenido validado; respuestas sin span/svg/code/hr/pre/h1/h2/h5/h6.
**Rationale**: Parser actual no reconoce todo énfasis, corta enlaces con paréntesis y deja elementos fuera de lista. AST con renderers controlados evita HTML generado sin validar y permite estructura exacta de UI-03/RNF-UI-03. [remark-parse](https://github.com/remarkjs/remark/tree/main/packages/remark-parse), [remark-gfm](https://github.com/remarkjs/remark-gfm), [unified](https://github.com/unifiedjs/unified) documentan parser/plugins.
**Alternatives considered**: Mantener regex (complejidad y brechas de gramática); react-markdown+rehype-sanitize (válido, pero sanitizador extra no reemplaza controlar tags/atributos de componentes finales); raw HTML+sanitización general (más superficie innecesaria). Versiones se fijan/auditan al implementar.

## R06 — ExternalLink único y contactos sin esquemas prohibidos

**Decision**: Nueva pestaña/rel exactos/nombre accesible+indicador textual en respuesta; solohttps. Teléfonos/correos se muestran legibles como texto; links oficiales HTTPS se mantienen. Fallback a página oficial de contacto configurada institucionalmente y validada, sin números de reserva.
**Rationale**: Satisface simultáneamente UI-04 y RNF-UI-03; no introducir mailto/tel al renderer ni contactos inferidos. Snapshot disponible se usa aunque C3 esté caído; ausente aplica IN-06.
**Alternatives considered**: Aceptar http o mailto por conveniencia (contradice lista del documento), usar valores hardcoded de emergencia (contradice fuente administrable).

## R07 — Epoch, intentos y vencimiento

**Decision**: epoch/sequence técnicos exclusivamente locales; AbortController+guards sobre lectura y callbacks; reloj45 s independiente desde envío. Payload original congelado, un envío activo y máximo dos reintentos manuales. Reinicio primero invalida epoch, luego aborta/limpia. Ocultar no reinicia reloj.
**Rationale**: Evita tardías en nueva conversación, errores en historial y solicitudes duplicadas. RF-C4-UI-05/07/08 e IN-02/03/04. [MDN AbortController](https://developer.mozilla.org/en-US/docs/Web/API/AbortController) describe cancelación; guards adicionales protegen carreras posteriores.
**Alternatives considered**: Solo AbortController (no invalida respuestas ya resueltas), timeout backend únicamente (caída de conexión puede quedar silenciosa), reintentos automáticos (superan presupuesto y duplican turnos).

## R08 — Sesión técnica no equivale a autorización

**Decision**: Token en memoria, no renovación automática con reenvío de consulta tras401. Si nuevo portador no demuestra continuidad con conversación, conservar texto visible pero bloquear reutilización del ID/contexto; iniciar nuevo flujo confirmado/autorizado. Cada ID pertenece a sesión verificada backend.
**Rationale**: session.ts guarda token en sessionStorage y renovación puede cambiar sub. Adoptar token nuevo con UUID previo puede ligar contexto incorrectamente. RF-C4-IN-01/02, DC-02 y privacidad002.
**Alternatives considered**: Reasociar UUID libremente (no acredita propiedad), pasar historial anterior a nueva autorización silenciosa (cambia consentimiento), refresh nuevo sin diseño de identidad (incompatible).

## R09 — Valoración transaccional como trabajo004

**Decision**: POST /api/ratings, UNIQUE por interaction_row_id interno, FK/permiso mínimo, valor/motivo validados, responseId confirmado y propiedad al portador. Duplicado sigue VALIDACION; UI solo agradece201 commit.
**Rationale**:002 excluye valoración/analítica, UI-06 necesita registro real. IN-09 exige rechazo segunda valoración. FK interna permite purgar IDs públicos/textos conservando estadísticas sin vínculos ciudadanos. [PostgreSQL restricciones](https://www.postgresql.org/docs/16/ddl-constraints.html) sustenta unicidad/FK/check; concurrencia se prueba realmente.
**Alternatives considered**: Bloquear solo botones (no evita bypass/concurrencia); guardar UUID ciudadano duplicado (entorpece depuración); convertir duplicado en éxito idempotente (contradice IN-09).

## R10 — Migraciones compatibles con catálogo real

**Decision**: Reconciliar pendientes002 con `backend/migrations/chat` y `chat.schema_migrations`; agregar valoración tras conversaciones/interacciones/purga con siguiente ordinal libre. Sin cambiar aplicadas ni tocar KB.
**Rationale**: Runner actual recorre subcarpeta chat; tareas002 describen rutas distintas aún futuras. RF-C3-IN-05/09 y RNF-C3-IN-01; preservación001.
**Alternatives considered**: Hardcodear siguiente003 hoy (colisiona al completar002), duplicar esquema/registro migraciones (desvía roles/persistencia), resetear volúmenes (destruye evidencia y base).

## R11 — Export estático, CSP en servidor y pruebas reales

**Decision**: Mantener Next output export/nginx; cabeceras en HTML /chat, frame-ancestors origen exacto; hashes de scripts inline calculados si se restringe script-src. Playwright/axe para regresión; móviles/browsers y lectores reales para aceptación contractual.
**Rationale**: Headers del backend no protegen página estática. [Next export](https://nextjs.org/docs/app/guides/static-exports) no ofrece headers dinámicos; [MDN frame-ancestors](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors) exige cabecera efectiva. [Playwright browsers](https://playwright.dev/docs/browsers) y [emulación](https://playwright.dev/docs/emulation) distinguen motor/emulación de dispositivos.
**Alternatives considered**: CSP solo meta (no aplica frame-ancestors), SAMEORIGIN conflictivo (bloquea Observatorio externo), reportar WebKit CI como Safari iOS (no prueba teclado real).

## R12 — Identidad oficial con evidencia, no valores inventados

**Decision**: Obtener y versionar guía/asset del portal oficial; usar tokens trazados al CSS con medición computed style/contraste. La guía final se produce en implementación tras verificar100 % valores y10 elementos.
**Rationale**: Lectura pública en investigación identificó [página oficial](https://observatorioenvigado.geotrends.co/observatorio), [CSS observatorio](https://observatorioenvigado.geotrends.co/css/observatorio.css), [CSS analítica](https://observatorioenvigado.geotrends.co/css/analitica/analitica.css) y [logo](https://observatorioenvigado.geotrends.co/img/logo_env.png). CSS declara Poppins,sans-serif y reglas con #ffffff,#0c342c,#076653; observaciones no acreditan carga efectiva de fuente ni todos los estados. No fijar avatar existente como logo ni paleta completa a partir de tres valores. RNF-C4-UI-04/02.
**Alternatives considered**: Inventar branding (incumplimiento), copiar transparencias sobre mapa (contraste variable). Si fuente declarada no carga, verificar fuente computada y resolver junto a estilo oficial antes de aceptación.

## Cierre de investigación

Todas las decisiones técnicas abiertas tienen resolución y alternativas. Insumos de ejecución (entorno portal autorizado, activos/guía completa, dispositivos/lectores, contactos oficiales y servicios002) son prerequisitos de aceptación documentados, no ambigüedades funcionales pendientes. Gate I–X final: PASS de diseño; no acredita runtime ni autoriza instalación/publicación en esta fase.
