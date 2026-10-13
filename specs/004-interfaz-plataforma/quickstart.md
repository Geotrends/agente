# Guía de validación — SPEC004

Esta guía describe ejecución futura después de implementar tasks. Scripts/rutas nuevos aquí no existen aún; no se han corrido ni se consideran aceptación. No contiene implementación o migraciones completas.

## Prerequisitos

1. Dependencias de002: contrato español operativo, Bedrock exclusivo, publicaciónKB001, contactos oficiales editables, conversaciones/registro confirmado/privacidad/perímetro/purga. Flujo003 único con políticas/consentimiento/categoría/emergencia.
2. PostgreSQL/Qdrant de prueba aislados, sin tocar volúmenes del usuario. Configuración/rolAWS autorizados únicamente para verificación integrada, sin secretos en comandos/logs. Datos sintéticos.
3. Launcher/export frontend construido, `/chat` servido por nginx con cabecera CSP final, API mismo origen Geobot. Fixture host local y variante CSP de test separados de producción.
4. Acceso al portal para revisión/instalación autorizada en fase implementación; evidencia de CSS/logo/fuente oficial. Dispositivos ChromeAndroid/SafariiOS y escritorio Chrome/Firefox/Edge; lector escritorio+móvil.

## Preparación reproducible

Desde raíz del proyecto. Instalar dependencias con lockfile vigente tras actualizarlo en implementación:

```sh
npm --prefix frontend ci
npm --prefix backend ci
npm --prefix frontend run typecheck
npm --prefix backend run typecheck
npm --prefix frontend run build:widget
npm --prefix frontend run build
```

Scripts frontend propuestos por plan: `typecheck`, `build:widget`, `test:ui`, `test:ui:e2e`; build actual permanece. `build:widget` genera launcher independiente y falla si>10.000 bytes; build de producción exporta con NEXT_OUTPUT=export por Docker. Pruebas locales sirven export real, no confundir nextdev con cabecerasnginx.

Instalación de browsers Playwright se hace durante preparaciónCI/entorno en implementación; versiones fijadas por lockfile. Registrar coste/descarga como entorno, no ejecutarlo para crear plan.

## Verificaciones automatizadas

```sh
npm --prefix frontend run test:ui
npm --prefix frontend run test:ui:e2e
npm --prefix backend run test:ui-integration
npm --prefix backend test
npm --prefix backend run test:di-integration
npm --prefix backend run test:kb-integracion
npm --prefix frontend audit --audit-level=high
npm --prefix backend audit --omit=dev --audit-level=high
```

`test:ui`: reducer/cliente45 s/epoch/retry/renderer/links/consentimiento/valoración con fixtures. `test:ui:e2e`: host+iframe exportados, requests/bytes/DOM/foco/storage y axe por estado; configuración local separada. `test:ui-integration`: `node --import tsx --test --test-concurrency=1 test/ui-integracion/*.test.ts` contra PostgreSQL real y proveedor doble marcado controlled; IDs/valoración/contactos/permisos/migración/purga. Estas tres interfaces se incorporarán en tareas antes de ejecutar guía; no son resultados disponibles hoy.

Regresiones002/001 preservan gates; usar arnés DB/variables de sus quickstarts en bases aisladas. CI debe fijar contextofrontend/backend adecuado, construir ambas imágenes y ejecutar tipos/unitarias/integración/auditoría. No desactivar pruebas para obtener verde.

## Recorridos y resultados

1. **Carga e integración (U01/U02/N01/P02)**: vaciar caché tres veces, comprobar solo launcher antes del clic. Abrir y completar dos consultas; cinco hide/show conservan transcripción. Medir cinco anchos, inspeccionar400/min640,85 %, mapa sin colisión; dispositivos reales con teclado. Revisar política y seis incrustaciones del contrato.
2. **Flujo/privacidad (I01/I02/P01)**: Autorizo genera unID, doce consultas envían diez pares en última. No autorizo no emiteID ni manda historial; inspeccionar todos storages/URL/logs. Reiniciar/recargar generaID nuevo solo después de autorizar.
3. **Respuestas/enlaces (U03/U04/N03)**: nueve formatos, diez citas+aviso datos, diezmaliciosas y tres preguntas con marcado. Confirmar allowlist final, th scope, scroll tablas y navegación pestaña nueva sin alterar mapa.
4. **Espera/fallo/contactos (U07/U08/I03/I04/I06/B10)**: delays5 s,40 s,50 s; cero envíos mientras espera, fallo45–46 s/tardía excluida. Seisfallas, dosreintentos, mismo payload; contactos precargados no generan requestextra. Cuatrofallas de contactos y tresllamadas servicio reales.
5. **Reinicio (U05)**: seis recorridos, diálogo literal/cancelación/reinicio, orden de flujo y cero historial. Añadir reinicio mientras consulta/valoración pendientes y cancelación con respuesta llegando.
6. **Valoración (U06/I05/B09)**: diez valoraciones autorizadas, tres anónimas y seis variantesID; doceenvíos servicio, inválidos sin filas, concurrentes una sola fila y pérdidaacuse sin falsoéxito. Verificar purga/permisos/migración en volumen existente.
7. **Accesibilidad/guía (N02/N04)**: [lista de estados](contracts/acceptance.md), axe cero y100 % manual con doslectores/teclado/zoom200 %. Guía oficial completa y10 elementos computados; contrastes medidos.

## Aceptación integrada y evidencia

Usar [matriz](contracts/acceptance.md) como contrato22casos, sin reducir muestras. CI con dobles verifica regresión; después probar mismo bundle/export contra C3/DB/KB y portal reales, sin proveedor heredado. Emulación no acredita ChromeAndroid/SafariiOS ni lector real.

Guardar manifest, resultados por caso, vídeos/capturas/HAR sanitizado y hallazgos bajo `evidencias/aceptacion/`; no capturar conversaciones personales ni secretos. Registrar revisión/corpus/bundle/imagen/CSS/contactos y adapter. Corregir hallazgosREAL y reejecutar matriz completa; si cambianprompt/corpus/recuperación, matriz002 ambosmodelos también. No marcar tareas001–003 completas solo porque una prueba UI pase.

Cierre:12UI+8C4-IN+2servicios con evidencia, cero pendientes contractuales, guía y revisiónportal. Informe para Bloque6; firma/aceptaciónformal se realiza allí. Si faltan entorno/activos/dispositivos/servicios reales, registrar pendiente con propietario, no simular aceptación.

## Estado de los scripts (actualizado en T007)

| Comando | Estado |
| --- | --- |
| `npm --prefix frontend run typecheck` | implementado (`tsc --noEmit`) |
| `npm --prefix frontend run test:ui` | configurado (Vitest/jsdom, `frontend/vitest.config.ts`); sin pruebas hasta T008+ |
| `npm --prefix frontend run test:ui:e2e` | configurado (Playwright, `frontend/playwright.config.ts`, hosts de `test/helpers/hostServer.ts`); sin specs hasta US1 |
| `npm --prefix frontend run build:widget` | **preparado, no implementado**: `frontend/scripts/build-widget.mjs` se crea en T027 |
| `npm --prefix backend run test:ui-integration` | configurado; sin pruebas hasta T008 (harness en `backend/test/ui-integracion/harness.ts`) |
| `npm --prefix frontend test` | pruebas heredadas `test/di-*` (node:test) |
