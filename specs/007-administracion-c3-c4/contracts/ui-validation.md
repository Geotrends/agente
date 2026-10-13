# UI administrativa y validación — SPEC007

Todas las historias; RNF-C3-AD-08/09 y privacidad de vistas. Se amplía el shell estático actual de Next/React, identidad institucional y componentes/formularios accesibles de SPEC004.

## Pantallas y experiencia

Rutas estáticas `/admin/login`, `/admin/password`, `/admin/accounts`, `/admin/documents`, `/admin/proposals`, `/admin/links`, `/admin/contacts`, `/admin/notifications`, `/admin/pending`, `/admin/audit`, `/admin/status`, `/admin/interactions`, `/admin/improvements`, `/admin/metrics/usage`, `/admin/metrics/documents`, `/admin/metrics/ratings`, `/admin/metrics/consumption`, `/admin/tariffs`. Detalle/modal usa estado cliente; no IDs/textos ciudadanos en URL ni dynamicparams desconocidos al build.

Guard común carga sesión antes de mostrar datos, redirección login sin flash sensible, cambio obligatorio permite solo password/logout; navegación por perfil y APIs siempre verificadas. Gestor ve matriz/carga/propuestas propias/avisos propios/password. Técnico todas las aprobadas. Contadores avisos/pendientes/casos abiertos visibles en todas las pantallas autenticadas donde el perfil los autoriza; login no obtiene datos privados. Cambio obligatorio no hace sondeos de funciones prohibidas.

Confirmación retiro incluye nombre y motivo, cancelar sin mutación; publicación muestra progreso En curso y no proclama Publicado antes de operación conforme. Error por campo se asocia con aria-describedby y resumen enfocable; tablas con encabezados/filtros/paginación accesibles. Celdas vacías N/A/ninguno/depurada/costo no disponible son estados de negocio, no nombres DB/stack.

Gráficas opcionales tienen tabla equivalente y jamás transmiten texto para dibujar; tarifa se presenta USD por millón de tokens de entrada/salida. Canales vigentes se reutilizan, no colores/logos inventados. Enlaces HTTPS seguros en pestaña nueva conformeVIII; navegación de pantallas usa controles de navegación sin inventar excepción para enlaces de contenido. Pantallas no ofrecen acciones fuera de fuente.

## Automatización y verificaciones humanas

Config dedicada `frontend/playwright.admin.config.ts`, pruebas `frontend/test/admin/`, no cambiar fixturehost/CSP del widget para simular autenticación. CI usa API misma createApp con PG/Qdrant aislados y proveedor doble; aceptación real tiene base/servicios/roles/releases identificados. Guardar trace/capturas/headers saneados sin password/cookie/CSRF/preguntas reales.

Axe en cada pantalla/estado normal/vacío/error/modal/cambio obligatorio donde aplica; cero A/AA (tags WCAG2A/WCAG2AA). Manual100% criterios aplicables, teclado completo, foco/tablas/modal/status, lector identificado, zoom200%, contraste4.5:1 texto normal y3:1 grande/controles. AutomatedPASS no acredita todaWCAG. Lectores/dispositivos/revisores/versiones documentados, sin usar emulación como físico cuando revisión heredada lo requiere.

## Desempeño RNF08

Ocho pantallas contractuales: bandeja/pending, matriz/documents, notifications, audit, cuatro metrics. Dataset sintético exactamente1.000 documentos,100.000 interacciones,10.000 auditorías en C6producción autorizada, separado/etiquetado y sin datos personales reales. Las cien mil interacciones usan conversación/anonimato definidos sin crear IDs anónimos. Conservar conteos inicial/final y método de selección del dataset para no mezclar medición con basura histórica. Ninguna semilla productiva se ejecuta en fase de plan.

Veinte cargas por pantalla en cada uno de dos días civiles diferentes Bogotá:8×20×2=320muestras mínimas, más pantallas adicionales según objetivo. Medir navegación/acción hasta datos útiles listos incluyendo red/render; status/fallos/timeout se conservan, cero errores para afirmar aprobación. p95 nearest-rank por pantalla/día:20→posición19 ordenada; cada uno≤3s, no promedio ni agregado entre pantallas/días. Pruebas de estado separado exige cinco fallos visibles<60s. Evidence:{requirement,release,environment,browser,dates,screen,samples,measurementDefinition,p95,errors,dataCounts,reviewer,artifactsHash}. No declaración de cumplimiento por API rápida o localfixture.

## Regresión y evidencias

`contracts/acceptance.md` asigna los62 requisitos a dueños/casos/suites. Cambios de base/prompt/recuperación repiten matrices congeladas006 integrada y ambos modelos; C3/C4 repiteC4 completo y verificaciones invalidadas. No crear nuevas actasAD sin fuente ni usar firma 006 para evadir criterio individual. Puertas CI tipos/unitarias/integración/auditoría sin altas/build imágenes nativas antes de integración.
