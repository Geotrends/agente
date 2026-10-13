# Implementation Plan: SPEC007 — Administración C3–C4

**Branch**: `develop` (rama Git real) | **Feature key**: `007-administracion-c3-c4` | **Date**: 2026-10-10 | **Spec**: [spec.md](spec.md)

**Input**: `specs/007-administracion-c3-c4/spec.md`, Bloque 7 de `DOCUMENACION_C3_C4.pdf`, y continuidad SPEC001–006.

## Summary

Completar los 53 RF y 9 RNF de Administración, H6-C3/H5-C4, ampliando el panel mínimo y los servicios actuales. Conservar autenticación, contactos y estado de SPEC002, escritor/base/documentos de SPEC001, registro/valoración/retención de SPEC004/005 y evidencia/validación de SPEC006. Construir las pantallas y acciones faltantes sin otro registro de conversaciones, otra base o proveedor.

Publicación y reindexación pasan a operación durable por etapas: preparación de colección completa separada, commit autoritativo SQL de generación/metadata, alias reconciliable y limpieza acreditada. Nunca exponer pendientes/parciales ni borrar la colección activa al fallar una fase posterior. Mejoras se relacionan con interacciones autorizadas sin copiar preguntas; se conserva purga y se separan estados estrictos del caso administrativo de reapertura de hallazgos006. Cuatro tableros entregan solo cifras agregadas; exportación XLSX mantiene filtro y enmascaramiento.

La [investigación](research.md) identifica brechas reales y decisiones; [modelo](data-model.md), [contratos](contracts/admin-api.md), [matriz de aceptación](contracts/acceptance.md) y [quickstart](quickstart.md) fijan alcance ejecutable para tareas. Este comando termina con diseño: no implementa producto ni genera tasks.

## Technical Context

**Language/Version**: TypeScript según lockfiles; Node 22; Express 4 backend y Next/React existentes con export estático. Python 3.12 únicamente scraper/evaluación offline existentes. Sin actualización general de dependencias.

**Primary Dependencies**: pg/PostgreSQL 16, cliente Qdrant 1.19, argon2, decimal.js, Transformers.js/OCR locales y SDK Bedrock existentes; Vitest/Playwright/axe actuales. Busboy 1.6.0 directo para multipart streaming y ExcelJS 4.4.0 para XLSX streaming de 100.000 filas como dependencias nuevas justificadas por superficie/volumen; fijar versiones compatibles, lockfiles y auditoría al implementar. SheetJS de matriz001 se conserva; sin broker/Redis/ORM ni servicio adicional.

**Storage**: PostgreSQL existente esquemas kb/admin/chat; Qdrant físico por generaciones y kb_chunks espejo. Metadata vigente/candidata, operación/manifest/limpieza, enlaces/propuestas/tombstones y campos administrativos incrementales. Casos FK a interacción, transiciones sin texto duplicado. Archivos de carga privados y derivados administrados; export temporal efímero durante petición, eliminación/verificación en todos los desenlaces. Evidencia006 offline conserva hashes/resultados seguros, no copias antiguas prohibidas.

**Testing**: node:test/tsx con pruebas nuevas admin y arneses PG/Qdrant reales aislados; rutas mismas createApp/proveedor doble, rollback/corte/reinicio/cleanup/concurrencia/retención. Frontend Vitest y Playwright admin dedicado, axe por pantalla/estado y manual teclado/lector. Regresiones KB/DI/UI/IN y validación006; producción C6 para rendimiento y cuentas/recuperación, sin usar dobles como evidencia real.

**Target Platform**: Linux AWS/Docker/Dokploy existentes, rol IAM exclusivo de SPEC005, frontend estático/nginx, escritor KB offline. Roles DB existentes y rol operativo contractor_recovery reservado fuera del runtime. Producción y pruebas aisladas identificadas; no despliegue ni carga real durante plan.

**Project Type**: Ampliación de aplicación web y worker existentes, nuevos contratos administrativos privados. Ningún selector público de modelo/proveedor o servicio SQL público.

**Performance Goals**: RNF-C3-AD-08 p95≤3s en cada pantalla contractual, 1.000 documentos/100.000 interacciones/10.000 auditorías, veinte cargas por pantalla en cada uno de dos días. AD48 cinco degradaciones visibles<60s. Consultas cada 30 s sin errores durante indexación/reindexación, conservar RNF-IV01<2h y límites C3≤40s/C4≤45s, p95 ciudadano≤20s. Automatización no acredita cifras de producción.

**Constraints**: Dos perfiles exactos,≥1 técnico activo, contraseñas≥12 caracteres/argon2id/sal única, bloqueo cuenta5/IP20 en15min→15min, sesión30min sin requests. UI no perpetúa sesión por polling. No contenido pendiente/derogado/vencido recuperable; un único reintento de indexación y retiro físico confirmado. Canales obligatorios, inmediato≥1/description≤120, nuevas tarifas USD >0/≤4 decimales y costos previos intactos. Texto autorizado solo durante 12 meses calendario, anónimo sin textos/IDs/categoría/valoración/caso. Auditoría append-only y avisos solo panel. Sin edición de hosts/prompt/modelos, sin actasAD inventadas.

**Scale/Scope**: Siete historias, todos los 62 requisitos obligatorios. Ocho pantallas explícitas RNF08→320 muestras mínimas en dos fechas, más accesibilidad de todas las rutas y estados. US7 P2 es orden de entrega, no exclusión de Importantes. Necesidades externas de producción/revisores no son decisiones pendientes: ejecución bloqueada hasta acceso real, tooling local puede avanzar.

## Constitution Check

Evaluación previa a investigación y repetida después del diseño. PASS significa conformidad del **diseño**, no del código actual; brechas existentes tienen corrección asignada, no excepción tolerada.

| Principio | Gate previo | Gate posterior y evidencia de diseño |
| --- | --- | --- |
| I — orientación y límites | PASS: administración sin nuevas acciones ciudadanas | PASS: métricas privadas no dan análisis/predicción a Geobot; no radicación/decisión. |
| II — anclaje/canales | PASS: preservar DI y registro administrable | PASS: metadata vigente por request, invalidación/exclusión, mismo registro de contactos; documento pendiente no habilita dato. |
| III — base cerrada | PASS: carga/publicación controladas | PASS: corpus y hosts independientes, generación candidata no recuperable, limpieza/estado/validez autoritativos. |
| IV — privacidad | PASS: reutilizar registros005 | PASS: casos por FK sin copia, export efímero, estadísticas allowlist, anonimato/purga respetados. |
| V — proveedor | PASS: dos Bedrock actuales | PASS: no nueva inferencia/selector/proveedor; tarifas solo modelos activos, credenciales IAM005 intactas. |
| VI — falla segura | PASS: avisos panel/salida existente | PASS: fallo DB no ausencia factual ni overlay de acceso; estado/avisos/reconciliación seguros, cero webhook. |
| VII — acceso | PASS: dos perfiles/autenticación | PASS: backend permisos/CSRF/proxy, último administrador, recuperación separada, auditoría/revocación; corrección bootstrap y contadores concurrentes. |
| VIII — accesibilidad | PASS: metodología 004 | PASS: todas las pantallas A/AA/teclado/lector y guía institucional, no solo widget. |
| IX — trazabilidad | PASS: 62 IDs fuente | PASS: acceptance 62/62, REAL antes de corrección, evidencia006 vigente/reejecuciones y estados de mejora distintos. |
| X — pruebas | PASS: pruebas automatizables+manuales previstas | PASS: suites nuevas/regresiones/CI completos, rendimiento C6/manual con evidencia, sin tests vacíos ni sustitución por fixtures. |

No gate fallido ni aclaración de diseño pendiente. Deuda encontrada: publicación temprana, metadata candidata mezclada, bootstrap amplio, ausencia de aviso de bloqueo y owner de carga, overlay desactualizado, polling indefinido. Plan corrige en dueños actuales antes de declarar aceptación. Los restos legacy/proveedores/tráfico pendientes de002/005 no se dan por resueltos desde007; regresión y precondiciones verifican su estado.

## Project Structure

### Documentation (this feature)

```text
specs/007-administracion-c3-c4/
├── spec.md / continuidad.md
├── plan.md / research.md / data-model.md / quickstart.md
├── contracts/
│   ├── admin-api.md
│   ├── documents-sources.md
│   ├── operations-contacts.md
│   ├── interactions-statistics.md
│   ├── ui-validation.md
│   └── acceptance.md
├── evidencias/requisitos-pdf.txt / validacion-spec.md / validacion-plan.md
└── checklists/requirements.md
```

`tasks.md` corresponde al siguiente comando y no se crea en esta fase.

### Source Code (repository root)

```text
backend/
├── migrations/005_administracion_documental.sql                 # nueva; dueño KB
├── migrations/chat/009_admin_integration.sql                   # nueva; hooks autorizados/tarifas/grants
├── migrations/admin/001_management.sql                         # nueva; identidad/operación/casos
├── src/admin/{auth,sessions,passwords,contacts,audit,operations}.ts # ampliar
├── src/admin/{accounts,documents,links,improvements,interactions,statistics,tariffs,export,migrate}.ts # nuevos
├── src/routes/{adminAuth,adminContacts,adminOperations}.ts       # ampliar
├── src/routes/{adminAccounts,adminDocuments,adminLinks,adminData}.ts # nuevos
├── src/kb/{service,sync,indexer,worker,notifications,retention}.ts # ampliar
├── src/kb/{documentOperations,publicationManifest,managedLinks,removals,expiry}.ts # nuevos
├── src/services/{search,qdrant,documentLinks}.ts / src/chat/{sources,records,feedback,retention}.ts # adaptar
├── scripts/{migrate-admin,recover-admin,eval-admin-performance}.ts # propuestos, privados
└── test/admin-*.test.ts / test/admin-integracion/               # nuevas; regresiones existentes
frontend/
├── app/admin/{layout,login,password,contacts,notifications,status} # ampliar
├── app/admin/{accounts,documents,proposals,links,pending,audit,interactions,improvements,tariffs}/page.tsx # nuevas
├── app/admin/metrics/{usage,documents,ratings,consumption}/page.tsx # nuevas
├── admin/{AdminShell,AdminTable,AdminForm,AdminDialog,adminClient,contracts,sessionActivity}.tsx|ts # nuevos
└── test/admin/ / playwright.admin.config.ts                    # nuevos
web_scraper/scraper/{sources,crawler,metadata_store}.py           # snapshot dinámico controlado
.github/workflows/ci.yml / docker-compose.yml / docs/arquitectura-sistema.md # gates/config/manual
```

**Structure Decision**: Módulos junto a los servicios dueños existentes; no separación en microservicio ni repo nuevo. Nombres nuevos son diseño a implementar, no archivos ya disponibles. AdminSchema conserva owner NOLOGIN `chat_owner`, KB `kb_writer`; runner instala grants mínimos/ledgers sin credenciales de migración en HTTP. `005`, `009` y `001` son siguientes números observados; si trabajo concurrente los ocupa se asigna siguiente libre preservando orden/dependencias, nunca se edita aplicada.

## Execution Design

### Responsabilidad y migración

1. Inventariar versión/cambios/pendientes001–006 y snapshots privados antes de migrar. Corregir en spec único inferencia de nombre único (RF05 exige solo correo único); no cambiar metas ni checklist de implementación.
2. Extender seguridad del panel/cuentas, migrador y recovery; login IP→cuenta bajo locks, notificación atómica, revocación y bootstrap limitado. Proteger datos antes de exponer nuevas pantallas.
3. Introducir metadata por versión, manifest y operaciones KB; bootstrap de active_generation desde colección y versiones actuales **verificadas** bajo pausa de escritores, sin cortar chat. Snapshot discrepante no migra como bueno. Cambiar todos los lectores al manifest, probar calibración/links/sources y gates001/002 antes de habilitar POSTpublish.
4. API crea comandos mediante función autorizada y actor de sesión; worker `kb_writer` procesa/idempotencia/reconcilia. SQL y Qdrant no transacción única: prepared/committed/cleaning verificables. Exclusión vigente inmediata en retiro/vencimiento; éxito solo tras limpieza. CLI usa misma entrada.
5. Propuestas/enlaces/snapshot de scraper y avisos propios/audit/pending unifican operación. Contactos existentes completan vacío/120/121, lista no vacía y lectura inmediata.
6. Interacciones/exports/casos/tableaus/tarifas son proyecciones/autorizaciones sobre chat existente. Trigger de caso en commit sin LLM/red; rendimiento registro/error/purga de005 no se rebaja. No copiar texto.
7. Guard frontend único y shell ampliado; UI se prueba incrementalmente con arnés real aislado, permisos backend y sesiones, no stubs como recepción. Todas las historias reciben evidencia de sus criterios originales.

### Dependencias de historias y entrega incremental

US1 establece seguridad común. US2 aporta operaciones/matriz; US3 reutiliza identidad/documentos y writer; US4 completa contactos existentes independiente del nuevo ciclo KB; US5 consolida avisos/estado/audit y consume operaciones; US6 usa registro/valoración005 y validación006; US7 consume registro/tarifas y consultas agregadas. Cada historia puede demostrar su propia prueba con precondiciones sintéticas autorizadas, pero cierre necesita integración real y las siete historias.

MVP: cuentas/acceso seguro y carga/matriz/publicación controlada US1+US2 sobre base vigente, sin declarar H6-C3/H5-C4 completo. Contactos y avisos existentes siguen operables. Paralelización futura solo en superficies separadas; migraciones/grants/app.ts/manifest/metadata/layout compartidos se coordinan.

### Pruebas y evidencia

[acceptance.md](contracts/acceptance.md) contiene 62 filas, prueba/suite/dueño y criterio fuente. Tipos/tests de contratos/seguridad/concurrencia/locks/permisos, PG/Qdrant reales con proveedor doble, E2E administrativas y regresiones001–006 van a CI; unitarias no espejo de implementación ni `passWithNoTests` para suite admin. Mantener CI vigente y ampliar job de administración/fixtures seguros; auditoría sin vulnerabilidades altas e imágenes nativas obligatorias.

Rendimiento por pantalla/día con 320 muestras y dataset C6; accesibilidad A/AA/manual 100%; producción Geotrends/Municipio/recovery sin llaves/contraseñas en evidencia. Corridas/documentos de prueba en copia aislada con retiro constatado. Revisión funcional y evidencia identifican release/entorno/fecha/persona/hashes. No reportar versión recibida con requisitos pendientes o datos hipotéticos.

Cambios relevantes registran AdjustmentEvent006 e invalidan evidencia correspondiente; C3 integrada y ambos modelos tras base/recuperación/prompt, C4 completa tras C3/C4, UI/carga invalidadas se renuevan. Estados administrativos no cierran hallazgos/actas006. Sin acceso/revisión/producción tarea queda pendiente, no se marca aceptación.

## Complexity Tracking

Sin excepciones a la constitución. Se elige cola SQL en worker existente y manifest autoritativo por consistencia, sin infraestructura nueva. Dos dependencias acotadas (multipart/XLSX) requieren versiones auditadas; reconstrucción completa puede costar más y se mide con metas heredadas. La recuperación auditada tras error requiere wrapper operativo restringido; no se promete persistencia de auditoría dentro de rollback. Estas decisiones soportan requisitos, no habilitan alcance extra.
