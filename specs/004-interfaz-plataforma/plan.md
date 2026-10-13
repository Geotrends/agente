# Implementation Plan: SPEC004 — Interfaz de la plataforma Geobot

**Branch**: `develop` | **Date**: 2026-10-08 | **Spec**: [spec.md](spec.md)

**Input**: `specs/004-interfaz-plataforma/spec.md`. Setup devolvió `BRANCH=004-interfaz-plataforma` como identidad de feature; Git continúa en `develop`. No se creó rama. Fase de diseño, sin implementación ni despliegue.

## Summary

Completar los 8 RF y 4 RNF de interfaz del Bloque 4 con un launcher TypeScript independiente y pequeño, panel Next/React exportado estáticamente en iframe persistente y un solo estado conversacional volátil. Adaptar renderer y cliente actuales, integrar consentimiento/categoría/emergencia de SPEC003 con el contrato español de SPEC002 y agregar el servicio de valoración pendiente. Conservar KB publicada de SPEC001. Las ocho dependencias C4-IN y servicios C3-IN-09/10 se verifican antes del cierre; el panel o el backend heredados no constituyen integración terminada.

El [diagnóstico](diagnostico.md) identifica siete UI parciales, cuatro ausentes y uno sin identidad acreditada. La planificación no marca tareas previas ni requisitos implementados. [Investigación](research.md), [modelo](data-model.md) y [matriz de aceptación](contracts/acceptance.md) definen decisiones y evidencia exigible.

## Technical Context

**Language/Version**: TypeScript según lockfiles actuales; Node 22 del proyecto. Next/React del lockfile vigente; launcher TypeScript compilado a JavaScript independiente. No Python para servicios online.

**Primary Dependencies**: Reutilizar Next, React, Express, pg y contratos/autenticación existentes. Añadir parser Markdown AST con GFM y renderizado React restringido; `remark-parse`, `remark-gfm`, `unified`. `esbuild` para launcher. Vitest/jsdom/Testing Library para estado/componentes; Playwright y axe-core para navegador. Versiones compatibles fijadas y auditadas en implementación, sin actualizar stack global.

**Storage**: Estado ciudadano exclusivamente memoria del iframe; launcher no recibe conversación. PostgreSQL16 para valoración asociada a interacción autorizada y servicio de contactos. Qdrant/KB no cambian. No localStorage/sessionStorage/IndexedDB/cookies/URL para texto o IDs; token técnico también solo memoria conforme plan002. No nuevo historial servidor.

**Testing**: Unitarias de estado/renderer y contratos cliente; backend `node:test`+tsx con PostgreSQL real para unicidad/autorización/purga; Playwright con fixture host, respuestas controladas y axe por estado; Chrome/Firefox/Edge escritorio y Chrome Android/Safari iOS reales para aceptación. Emulación/WebKit CI no sustituye dispositivos ni lector real.

**Target Platform**: Observatorio `https://observatorioenvigado.geotrends.co/observatorio` y dominio HTTPS de Geobot configurado al instalar. Export Next servido con nginx; backend Express; AWS/Docker/Dokploy existentes. Integración al portal se prepara como artefacto revisable y se instala en entorno autorizado durante implementación.

**Project Type**: Aplicación web existente frontend/backend más artefacto estático de integración al portal; sin nuevo servicio web.

**Performance Goals**: Launcher ≤10 KB (criterio conservador ≤10.000 bytes sin comprimir); antes del clic cero requests a dominio Geobot salvo launcher. Indicador ≤500 ms. Panel <768 px fullscreen; ≥768 px 400 px × min(640 px,85 % alto). Contactos C3≤2 s/cliente≤5 s; C3 consulta≤40 s/cliente≤45 s por intento, fallo observado 45–46 s. Mantener objetivos previos p95≤20 s/25 concurrentes sin redefinir aceptación UI.

**Constraints**: Lista HTML/atributos y https exactos del spec; WCAG2.1 A/AA (texto4,5:1; controles/grande3:1); único frame-ancestors oficial, postMessage sin datos/IDs y con origin/source/schema validados; dos reintentos manuales; sin selección de modelo ni exposición técnica. Una valoración autorizada por respuesta; anonimato sin registro/historial. Imágenes/fuentes del widget solo después del primer clic.

**Scale/Scope**: Cinco historias, doce UI + ocho dependencias C4-IN + servicios directos C3-IN-09/10 y preservación DC-01..04. Panel administrativo completo, cambios de prompt/corpus/recuperación y aceptación global Bloque6 fuera de alcance. Dependencias previas pueden construirse con su propietario, pero ninguna queda implícita para el cierre.

## Constitution Check

Gate inicial antes de investigación: **PASS de diseño** para I–X. Revisión posterior a fase1: **PASS de diseño**, respaldada por contratos/estado/aceptación. No declara conforme el runtime actual.

| Principio | Control inicial | Verificación posterior al diseño | Resultado |
| --- | --- | --- | --- |
| I Orientación | Un único flujo institucional, sin nuevos trámites/decisiones | Apertura DC-01 desde configuración, consentimiento/categoría/emergencia previos, sin bienvenida heredada | PASS |
| II Anclaje | C3 conserva responsabilidad de evidencia y canales | Cliente español preserva respuesta/fuentes/fechas; contactos administrables, no reconstruir citas o números | PASS |
| III Base cerrada | Reutilizar alias publicado001 | Sin cambios de matriz/indexación; casos reales usan documentos publicados y continuidad | PASS |
| IV Privacidad | Estado volátil, IDs solo backend | Transcripción distinta de pares enviados, generación local técnica no expuesta, nueva conversación y anonimato, valoración con FK y retención | PASS |
| V Proveedor | No mantener proveedores heredados para integrar | Cliente sin modelo/provider, dependencia002 Bedrock exclusiva antes de entrega ciudadana | PASS |
| VI Falla segura | Toda espera termina con salida/canales | 45 s cancelable, tardías descartadas, IN-06 fallback oficial, dos reintentos; degradaciones panel002, no webhook nuevo | PASS |
| VII Seguridad | HTTPS/lista HTML/origen y autorización real | Renderer AST restringido, CSP nginx del iframe, mensajes mínimos, valoración por propietario y perímetro; administración permanece002 | PASS |
| VIII Experiencia | Portal no descarga app antes de activación | Launcher acotado/iframe persistente, guía oficial, contraste, teclado/lectores/mapa y móvil | PASS |
| IX Trazabilidad | 12 UI y dependencias con evidencia | Matriz completa de cantidades, versión/hash/REAL; repetir tras cambio relevante, no confundir mocks con aceptación | PASS |
| X Pruebas | Automatización y manual explícitos | Suites de estado/renderer/servicios, axe por estado, CI tipos/auditoría/build/imágenes y revisión real | PASS |

**Deuda**: Renderer http/elementos no permitidos, sesión persistida y errores técnicos se migran en superficies UI tocadas. Proveedores/registro C3 dependen de completar002; no se habilita uso ciudadano usando la ruta multivendor heredada como atajo. Administración completa pendiente no se amplía. Sin excepción constitucional.

## Project Structure

### Documentation (this feature)

```text
specs/004-interfaz-plataforma/
├── spec.md
├── diagnostico.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── widget-host.md
│   ├── citizen-api.md
│   ├── feedback-api.md
│   └── acceptance.md
├── checklists/requirements.md
└── evidencias/                 # extracto; ejecución futura en aceptacion/
```

`tasks.md` se generará con `$speckit-tasks`; no es salida de esta fase.

### Source Code (repository root)

```text
frontend/
├── app/chat/page.tsx            # nueva ruta exportable del iframe
├── chat/                       # contexto/reducer y componentes del único flujo
├── widget/launcher.ts           # artefacto sin React ni imports de app
├── scripts/build-widget.mjs     # esbuild + medida bytes
├── public/embed/                # launcher generado; sin datos privados
├── public/brand/                # assets institucionales locales identificados
├── shared/                     # contracts/client/session/ExternalLink/Markdown
├── smart/SmartAgentPanel.tsx    # adaptar/delegar en flujo único; sin segundo estado
├── test/                       # unitarias, e2e y fixture host
├── playwright.config.ts
├── nginx.conf                  # CSP /chat y cache de API
└── package.json                # scripts nuevos de test/build widget
backend/
├── src/routes/feedback.ts       # nuevo endpoint protegido
├── src/chat/feedback.ts         # validación/repositorio transaccional
├── src/chat/                   # contratos002/conversaciones/interacciones previas
├── migrations/chat/            # nueva migración con siguiente ordinal libre
└── test/ui-integracion/         # valoración/propiedad/purga/contactos reales
.github/workflows/ci.yml         # ampliar sin retirar gates existentes
```

**Structure Decision**: Extender layout real (`frontend/app`, `shared`, `smart`, `backend/src/routes`, `src/chat`). Alinear destinos propuestos en003 (`frontend/src/components`, controladores alternos) mediante tabla de equivalencias documental antes de implementación. No duplicar shells, contexto o endpoints de emergencia. Mantener migrador chat separado del catálogo KB; no copiar numeración obsoleta de002 sobre migraciones existentes.

## Execution Design

1. **F0 — Base y convergencia**: inventario Git/lockfiles y servicios reales; tabla de mapeo002/003; contrato ciudadano español; preparar harness aislado de portal/backend y marca `controlled`/`integrated`. Reutilizar avance local sin marcar tareas por existencia de archivo. Actualizar contratos/rutas documentales de003 antes de ejecutar su lista antigua.
2. **F1 — Dependencias compartidas**: verificar/completar configuración, sesión en memoria, emisión ID autorizada, historial por pares, respuesta/ID tras commit y servicio contactos002. Construir un único flujo003 con DC-01..04. Generar guía visual con assets/estilos oficiales y hashes; falta de insumo visual impide aceptar UI-04, no exige inventarlo para planificar.
3. **F2 — US1 apertura/adaptación**: launcher aislado, iframe creado una vez tras primer clic, hide/show sin unmount, mensajes de cierre/foco/viewport seguros, CSS responsive/áreas seguras, fixture de mapa. Medir bytes y red del artefacto exportado, no solo fuente TypeScript.
4. **F3 — US2 lectura/seguridad**: parser AST y allowlist final React, listas/tablas/th scope, tabla scroll; ExternalLink único para citas/política/canales y span accesible/indicador externo fuera del contenido restringido. Auditar todas las respuestas/mensajes fijos y texto plano ciudadano.
5. **F4 — US3 espera/fallo**: reducer de intentos y reloj 45 s desde envío de consulta, AbortController y descarte por epoch/attempt; campo/envío bloqueados; mensajes literales/canales; 2 reintentos manuales, sin errores en historial ni peticiones técnicas de indexación. IN-06 recupera contactos sin LLM.
6. **F5 — US4 reinicio**: diálogo confirmación accesible; nueva epoch cancela consulta/feedback obsoletos, limpia historial/consentimiento/categoría/ID, repite flujo. Cancelar preserva todo; hidden preserva solicitudes.
7. **F6 — US5 valoración**: nueva ruta/procedimiento/tabla con propiedad de conversación, validaciones, unicidad y retención. Confirmación solo tras commit; controles elegibles únicamente con consentimiento+responseId. Validar concurrencia y pérdida de acuse sin duplicados ni mensaje falso de éxito.
8. **F7 — Aceptación integrada**: tipos/unitarias/build/export/auditoría/imágenes y servicios reales; UI matriz completa controlada; portal integrado, cinco navegadores/dispositivos, teclado/lectores/zoom/guía/contraste; privacidad/perímetro/retención. Versionar evidencia y hallazgos REAL, repetir matriz relevante completa tras correcciones; cambios de prompt/corpus/recuperación repiten además matriz002 de ambos modelos.

### Propietarios de dependencias y convivencia

| Superficie | Reutilizar de previos | Responsable de completar/verificar en004 |
| --- | --- | --- |
| Corpus/fechas | SPEC001 KB publicada/metadatos; SPEC002 T021/T076 | US2 consume y comprueba citas, sin cambiar corpus |
| Contrato/ID/registro/errores | SPEC002 T006/T013/T014/T043/T044/T063/T064/T070 | F1 contrato conjunto y gate real; no route legacy alternativa |
| Apertura/consentimiento/categoría/emergencia | SPEC003 T003..T025; SPEC002 T038/T048 | F1 mapeo a rutas reales + único estado/componentes003 |
| Renderer/panel | SPEC002 T026/T027; `ChatMarkdown` y `SmartAgentPanel` existentes | F3/F4 adaptan mismas superficies, no reconstrucción concurrente |
| Contactos/administración segura | SPEC002 T011/T035..T038/T069 | F1 disponibilidad/edición real; F4 usa snapshot/fallback |
| Valoración | RF-C3-IN-09 aún fuera de002 | F6 crea servicio/DB/tests en004, sin analítica/panel extra |
| Script/iframe/CSP/guía | Sin implementación completa previa | F2/F3/F7 en004 |

No exigir todo002 terminado para desarrollar UI con contratos/dobles. Sí exigir para habilitar entrega ciudadana las dependencias de privacidad, proveedor autorizado, contactos, registro/IDs y flujo003 reales, con evidencia. Desglosar estas puertas y responsables en tasks sin listar una dependencia vacía como «ya implementada».

### Trazabilidad de los requisitos

| ID | Fases | Contrato/aceptación |
| --- | --- | --- |
| RF-C4-UI-01 | F1/F2/F7 | widget-host; U01 |
| RF-C4-UI-02 | F2/F7 | widget-host; U02 |
| RF-C4-UI-03 | F3/F7 | citizen-api; U03 |
| RF-C4-UI-04 | F3/F7 | citizen-api; U04 |
| RF-C4-UI-05 | F5/F7 | data-model; U05 |
| RF-C4-UI-06 | F6/F7 | feedback-api; U06 |
| RF-C4-UI-07 | F4/F7 | citizen-api; U07 |
| RF-C4-UI-08 | F4/F7 | citizen-api; U08 |
| RNF-C4-UI-01 | F2/F7 | widget-host; N01 |
| RNF-C4-UI-02 | F1..F7 | acceptance; N02 |
| RNF-C4-UI-03 | F3/F7 | citizen-api; N03 |
| RNF-C4-UI-04 | F1/F2/F3/F7 | research/guía; N04 |
| RF-C4-IN-01 | F1/F5/F7 | citizen-api; I01 |
| RF-C4-IN-02 | F1/F4/F5/F7 | citizen-api; I02 |
| RF-C4-IN-03 | F4/F5/F7 | citizen-api; I03 |
| RF-C4-IN-04 | F4/F7 | citizen-api; I04 |
| RF-C4-IN-05 | F6/F7 | feedback-api; I05 |
| RF-C4-IN-06 | F1/F4/F7 | citizen-api; I06 |
| RNF-C4-IN-01 | F1/F2/F5/F7 | data-model; P01 |
| RNF-C4-IN-02 | F2/F7 | widget-host; P02 |
| RF-C3-IN-09 | F6/F7 | feedback-api; B09 |
| RF-C3-IN-10 | F1/F4/F7 | citizen-api; B10 |

## Complexity Tracking

Sin violaciones constitucionales. Launcher independiente evita descargar React antes del clic; tabla de valoración responde a IN-09 y no constituye nuevo servicio. Gate final revisado I–X: PASS del diseño, aceptación/implementación pendientes.
