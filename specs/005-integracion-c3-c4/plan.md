# Implementation Plan: SPEC005 — Integración C3–C4

**Branch**: `develop` (rama Git real) | **Date**: 2026-10-10 | **Spec**: [spec.md](spec.md)

**Input**: `specs/005-integracion-c3-c4/spec.md`. El setup devuelve selector lógico `005-integracion-c3-c4`; no creó esa rama. Feature activa: `specs/005-integracion-c3-c4`.

## Summary

Consolidar los 30 requisitos activos del Bloque 5 y documentar RNF-C3-IN-09 descartado. Construir sobre SPEC001–004: una API española, una persistencia, un flujo de autorización y un iframe existentes. Corregir origen/preflight, cuota de consultas y resolución de IP, identidad IAM exclusiva, plazo desde recepción, duración registrada, avisos de registro, retención fiel y caché en intermediarios. Completar un arnés verificable de aceptación y medir producción/AWS/portal/móviles reales sin presentar simulación como aceptación.

[Diagnóstico](diagnostico.md) y [research](research.md) distinguen código reutilizable, contradicciones y nuevas brechas del arnés. Los artefactos son diseño: no declaran ejecución ni aceptan hitos.

## Technical Context

**Language/Version**: TypeScript con versión fijada por lockfile; Node.js 22 de Docker/CI; Express 4 en backend, Next.js/React existentes con salida estática en frontend. Python 3.12 solo scraper/evaluación offline. No actualización general de dependencias.

**Primary Dependencies**: `pg`, Qdrant client, AWS SDK v 3 `client-bedrock-runtime` y proveedores de credenciales existentes; Transformers.js local. Frontend conserva renderer AST y Playwright/Vitest/axe. Elegir proveedor explícito de rol EC2 y confirmar su exportación en la versión instalada antes de editar imports; agregar dependencia directa específica solo si el paquete actual no lo expone. No incorporar otra cola, base, proveedor o servicio público.

**Storage**: PostgreSQL16 con esquemas `kb`, `chat`, `admin` y roles existentes; Qdrant 1.19 por alias publicado. Interacciones en `chat.interaction`, anonimato en `chat.anonymous_usage`, valoración en `chat.valoracion`. Conservar `row_id` interno sin duplicar UUID público. Estado ciudadano y credencial técnica solo memoria del iframe. Avisos pendientes solo metadatos seguros en memoria operativa existente.

**Testing**: `node:test`/tsx y arnés DI/UI con PostgreSQL/Qdrant reales aislados; frontend Vitest/Playwright y revisión manual WCAG. Extender pruebas existentes y nueva suite `backend/test/in-integracion/` para recepción/error/proxy/retención/carga/no degradación. CI mantiene tipos, unitarias, auditoría sin vulnerabilidades altas y builds de imágenes; agrega integración IN. Dobles exclusivamente en pruebas, nunca habilitados por una solicitud ciudadana ni en producción.

**Target Platform**: Linux AWS EC2 con rol exclusivo, Docker/Dokploy/nginx. El runtime usa metadatos de rol de instancia; no perfiles locales, proceso externo, SSO, credenciales por variables ni llaves estáticas. No migrar a ECS en este alcance. Configuración productiva y entornos controlados separados.

**Project Type**: Aplicación web existente con API, iframe, panel mínimo autenticado y worker KB independiente.

**Performance Goals**: Recepción→entrega completa p95 ≤20 s; error terminal C3≤40 s incluido cuerpo/cola/persistencia; intento C4≤45 s y salida 45–46 s. Contactos≤2 s, cliente≤5 s. 25 simultáneas sin errores/pérdidas. Observatorio/Geoportal p95 bajo carga≤1, 2×referencia con cero errores.

**Constraints**: Solo dos modelos Bedrock habilitados, `bedrock:InvokeModel` sobre sus ARN exactos sin comodines, misma región configurada; máximo 10 pares, 60 consultas/min/IP, 131072 bytes, retención 12 meses+24 h. Origen del ChatBot exacto obligatorio; frame-ancestors solo Observatorio oficial. No-store también en rechazos tempranos/nginx. No secretos ni texto anónimo en evidencias.

**Scale/Scope**: 16RF+14RNF activos; 1RNF descartado. Dos días distintos:100 secuenciales 40/30/30 con 10 historiales efectivos y 10 respuestas largas verificadas; 3×25/día, pausas 2 min, 15 autorizadas de 5 conversaciones+10 anónimas por oleada. No degradación:180 muestras (30×2 destinos×3 condiciones). Dependencias externas son prerequisitos de ejecución; no decisiones de diseño pendientes.

## Constitution Check

Evaluación previa fase 0 y posterior fase 1: **PASS de diseño para I–X**, sin excepciones. Los hallazgos de código actual son trabajo obligatorio de corrección, no dispensas constitucionales. Ningún gate declara conformidad de la implementación.

| Principio | Gate previo | Verificación posterior al diseño |
| --- | --- | --- |
| I Orientación preliminar | Conservar alcance/leyenda y apertura | Contrato reutiliza SPEC002/003, inyección 9/9; no nuevas decisiones ni trámites |
| II Anclaje | Usar base publicada y contactos oficiales | Fuentes cruzadas registro/entrega, contacto único, 9 inyecciones, matriz SPEC002 ambos modelos |
| III Base cerrada | No alterar corpus ni publicación | IN-13 ejecuta reindexación SPEC001 atómica, conserva última base válida |
| IV Privacidad | No historial/ID/texto anónimo persistido | Modelo define seis campos anónimos, retención exacta, memoriaiframe, caché/PII/avisos sin contenido |
| V Proveedor controlado | Un runtime Bedrock con dosmodelos | Rol EC2 exclusivo, InvokeModel exacto, sin cadena predeterminada ni nuevas credenciales; denegaciones reales |
| VI Falla segura | Error acotado y orientación sin registro | Presupuesto recepción→error, escritura cancelable/bounded, episodio con modo, contactos/fallos, reranker degradado |
| VII Perímetro | Proteger antes de CORS/cuerpo/sesión/modelo | Origin explícito, preflight, cuota solo consultas, proxy confiable 128 KiB, no-store/CSP, permisos existentes |
| VIII Experiencia | Mantener interfaz/portal accesibles | Reusar SPEC004 con teclado/lector/móviles reales y carga del anfitrión≤120%; no texto técnico nuevo |
| IX Trazabilidad | Mantener IDs y muestras sin cierres ficticios | 31 casos, 30 activos+1 descartado, evidencia de versión, REAL y repetición matriz congelada |
| X Pruebas | Automatizar cada corrección y mantener CI | Regresiones DI/UI/KB+IN, ninguna desactivación para origin/retención; manual expreso |

## Project Structure

### Documentation (this feature)

```text
specs/005-integracion-c3-c4/
├── spec.md
├── diagnostico.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── integration-api.md
│   ├── runtime-security.md
│   ├── acceptance.md
│   └── performance-evidence.md
├── checklists/requirements.md
└── evidencias/
    ├── requisitos-pdf.txt
    ├── validacion-spec.md
    └── validacion-plan.md
```

`tasks.md` corresponde a la siguiente invocación; no se genera aquí.

### Source Code (repository root)

```text
backend/
  src/index.ts
  src/routes/{auth,chat,conversations,chatConfig,feedback}.ts
  src/chat/{deadline,perimeter,handleChat,records,retention,runtime,db}.ts
  src/admin/{operations,db}.ts
  src/bedrock/client.ts
  src/services/{diConfig,settings,chatTraffic}.ts
  migrations/chat/                         # 001–007 existentes; siguiente número libre si necesario
  scripts/{eval-di-load,eval-di-host,report-in}.ts # últimos dos propuestos
  scripts/lib/{loadRunner,hostRunner}.ts    # hostRunner propuesto
  test/{di-integracion,ui-integracion,kb-integracion}/
  test/in-integracion/                      # propuesto
frontend/
  chat/                                    # flujo/reinicio/errores/estado existentes
  shared/{chatClient,chatContracts,session,feedbackClient}.ts
  widget/{launcher,protocol}.ts
  nginx.conf
  scripts/{build-csp,report-ui}.mjs
  test/                                    # extender sin duplicar frontend/src
.github/workflows/ci.yml
.env.example
docker-compose.yml
```

**Structure Decision**: Cambios en módulos responsables actuales, nueva suite de integración y medición offline. No reconstruir componentes ni nombres físicos por diseños antiguos. Las migraciones aplicadas no se reescriben; cualquier cambio de esquema usa siguiente número disponible y permisos mínimos.

## Execution Design

| Fase | Trabajo y salida | Dependencia |
| --- | --- | --- |
| F0 Inventario | Hashes/commit+cambios, contratos/evidencia anterior y manifiesto 31 casos; elegir base/destinos oficiales/versiones | Ninguna; revisión inicial |
| F1 Perímetro/identidad | Origen antes de CORS, no-store temprano, preflight válido, cuota consulta, proxy confiable, rol EC2/política sin secretos; corregir arneses con Origin | F0 |
| F2 Plazo/registro | Deadline en recepción, operaciones acotadas/canceladas, fecha/duración común, PII, avisomodo/recuperación, retención fuentes | F1 |
| F3 Recorrido ciudadano | Contratos autorizados/anónimos, 10 pares, tipos/fuentes, valoración/rollback/memoria, contactos/error 45 s/CSP | F2, capacidad 003/004 existente |
| F4 Medición/CI | Runner secuencial y oleadas correcto, cotejo de BD, no degradación por 180 muestras, generador de informe 31 casos, regresiones/CI/builds | F3 |
| F5 Aceptación real | AWS/IAM, matrizdeinyección, portal/Chrome y Firefox/móviles ylectores, 100+75 por cada 2 días, 180 muestras anfitrión | F4 y acceso/configuración reales |
| F6 Hallazgos/cierre | Correcciones REAL, regresiones y matriz congelada íntegra al cambiarmodelo/base/prompt, 30/30 evidencia activa+1 descartada, informe/handoff | F5 |

F1/F2 requieren trabajo coordinado sobre middleware/errores; no se paralelizan cambios al mismo archivo. Historias US1–US6 son verificables por separado en sus pruebas, pero aceptación integrada requiere F5/F6 completas. Los requisitos P1 de capacidad/seguridad no se posponen indefinidamente por un MVP visual.

### Responsabilidad y evidencia compartida

- SPEC001 conserva base/reindexación; SPEC005 corrige/verifica integración y recursos compartidos IN-13, sin aceptar ingesta T082/T083.
- SPEC002 conserva respuesta/Bedrock/panel/consumo. SPEC005 es propietario de correcciones IN en esos módulos; evidencia real puede enlazarse a T092–T098 sin cerrar sus obligaciones DI adicionales.
- SPEC003 conserva textos y decisión/categoría/emergencia; SPEC005 verifica compatibilidad de contrato, no crea endpoint separado ni `autorizo` ciudadano nuevo.
- SPEC004 conserva iframe/render/reinicio/reintento/valoración. SPEC005 verifica extremo a extremo y puede referenciar casos I01..I06/P01/P02/B09/B10; las 22 pruebas UI y revisiones propias siguen requeridas.
- Una corrección tiene un propietario técnico, una prueba y evidencias con IDs compartidos; tareas anteriores solo se cierran mediante verificación completa de su propio criterio.

### Trazabilidad completa

El manifiesto y la [matriz de aceptación](contracts/acceptance.md) tienen un caso por ID. Ningún caso activo se cierra con un archivo existente o una corrida incompleta.

| ID | Fases | Contrato |
| --- | --- | --- |
| RF-C3-IN-01 | F2/F3/F5 | integration-api; C301 |
| RF-C3-IN-02 | F1/F3/F5 | integration-api; C302 |
| RF-C3-IN-03 | F2/F3/F5 | integration-api; C303 |
| RF-C3-IN-04 | F1/F2/F3/F5 | integration-api/runtime-security; C304 |
| RF-C3-IN-05 | F2/F3/F4/F5 | data-model/performance-evidence; C305 |
| RF-C3-IN-06 | F2/F3/F5 | data-model; C306 |
| RF-C3-IN-07 | F2/F3/F4/F5 | data-model; C307 |
| RF-C3-IN-08 | F2/F3/F5 | data-model/integration-api; C308 |
| RF-C3-IN-09 | F3/F5 | integration-api; C309 |
| RF-C3-IN-10 | F2/F3/F5 | integration-api; C310 |
| RF-C4-IN-01 | F3/F5 | integration-api; C401 |
| RF-C4-IN-02 | F3/F5 | integration-api; C402 |
| RF-C4-IN-03 | F2/F3/F5 | integration-api; C403 |
| RF-C4-IN-04 | F1/F3/F5 | integration-api; C404 |
| RF-C4-IN-05 | F3/F5 | integration-api; C405 |
| RF-C4-IN-06 | F2/F3/F5 | integration-api; C406 |
| RNF-C3-IN-01 | F2/F5 | data-model; N301 |
| RNF-C3-IN-02 | F2/F4/F5 | performance-evidence; N302 |
| RNF-C3-IN-03 | F1/F4/F5 | performance-evidence; N303 |
| RNF-C3-IN-04 | F1/F5 | runtime-security; N304 |
| RNF-C3-IN-05 | F1/F4/F5 | runtime-security; N305 |
| RNF-C3-IN-06 | F1/F2/F5 | runtime-security; N306 |
| RNF-C3-IN-07 | F1/F5 | runtime-security; N307 |
| RNF-C3-IN-08 | F1/F5 | runtime-security; N308 |
| RNF-C3-IN-09 | F0/F6 | runtime-security; N309 descartado |
| RNF-C3-IN-10 | F1/F5 | runtime-security; N310 |
| RNF-C3-IN-11 | F3/F5/F6 | runtime-security; N311 |
| RNF-C3-IN-12 | F1/F2/F3/F5 | runtime-security; N312 |
| RNF-C3-IN-13 | F4/F5 | performance-evidence; N313 |
| RNF-C4-IN-01 | F3/F5 | integration-api; N401 |
| RNF-C4-IN-02 | F1/F3/F5 | runtime-security; N402 |

## Complexity Tracking

No hay violaciones constitucionales propuestas ni excepciones. Se mantiene el stack y las capacidades existentes. Worker separado, metadatos operativos en memoria, arnés offline y migración incremental si necesaria sostienen requisitos explícitos; no autorizan almacenamiento de texto perdido ni nuevas funciones de administración.
