# Implementation Plan: Base de conocimiento institucional (Bloque 1)

**Branch**: `001-base-conocimiento-bloque1` (se integra en `develop`) | **Date**: 2026-10-07 |
**Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-base-conocimiento-bloque1/spec.md`

## Summary

**Requisitos**: los 15 del bloque 1 (RF-C3-IV-01 a IV-12, RNF-C3-IV-01 a IV-03). Hoy ninguno
se cumple por completo ([diagnóstico](./diagnostico.md)).

La base de conocimiento pasa a ser cerrada, versionada y vigilada:

**1. Adquisición (Python, `web_scraper`)**
- Se limita a las 4 fuentes autorizadas y agrega GT-P-029 y la nueva fuente
  observatorioenvigado.geotrends.co.
- Recorre GMAS2 solo hasta los vinculados de cada GT-P.
- Normaliza las tablas jqGrid antes de convertir a Markdown.
- Detecta derogados y estructura modificada sin sobrescribir lo anterior.
- En cada corrida emite un informe JSON.
- Corre cada semana con supercronic.

**2. Sincronización (TypeScript, nuevo servicio `kb-worker`)**
- Consume los informes y aplica las reglas de alcance y estado.
- Convierte a Markdown con OCR de Tesseract y confianza medida: descarta lo que tenga 80 %
  o menos.
- Arma las fichas de 10 campos y controla que los formatos estén en blanco.
- Persiste en PostgreSQL la matriz, las versiones, las verificaciones, el procesamiento y
  las notificaciones.
- Indexa en Qdrant: vectores denso + BM25 disperso, colección por construcción y cambio de
  alias atómico.
- Ofrece una CLI de operador: publicar, exportar .xlsx, auditar alcance, purgar con
  retención de 12 meses.

**3. Chat (backend)**
- Deja de construir y guardar el índice en memoria y consulta el alias de Qdrant.
- Conserva intactos la fusión RRF, el reranker y la diversificación (bloque 2).

## Technical Context

**Language/Version**:
- TypeScript 5.6 sobre Node.js 22: backend y `kb-worker`.
- Python 3.12: scraper, proceso offline (constitución).

**Primary Dependencies**:
- Existentes: Express 4, `@huggingface/transformers` (e5-small local), `pdf-parse`,
  `mammoth`, `xlsx` (SheetJS, también para la exportación), BeautifulSoup + lxml +
  markdownify, Playwright.
- Nuevas: `pg`, `@qdrant/js-client-rest`, supercronic (binario en la imagen del scraper).
- Sistema: `tesseract-ocr` (spa/eng) y `poppler-utils` (`pdftoppm`). `ocrmypdf` y `unpaper`
  se retiran de la imagen.

**Storage**:
- PostgreSQL 16: esquema `kb` con matriz, versiones, registros y notificaciones
  ([data-model](./data-model.md)).
- Qdrant `v1.19.2-unprivileged` (tag verificado; mínimo 1.10 por `modifier: idf`), con
  `@qdrant/js-client-rest` de la misma versión menor: alias `kb_chunks` sobre
  `kb_chunks_<marca>`
  ([contrato](./contracts/qdrant-coleccion.md)).
- El volumen de datos queda como área de adquisición. El volumen `geobot-runs`, de escritura
  para `scraper` y `kb-worker`, guarda los informes de corrida.

**Testing**:
- Backend: `node:test`, unitarias y de integración contra PostgreSQL y Qdrant reales.
- Scraper: `unittest`, con fixtures HTML reales de GMAS2.
- Retrieval: `eval:retrieval` con el conjunto de oro re-basado.
- CI de GitHub Actions con *service containers*.

**Target Platform**: Linux en contenedores Docker, sobre AWS, desplegado con Dokploy.

**Project Type**: aplicación web (backend Express + frontend Next.js) más procesos offline
(scraper y `kb-worker`).

**Performance Goals**:
- Ingesta completa en menos de 2 h (RNF-C3-IV-01).
- 100 % de consultas sin error durante la reindexación (RNF-C3-IV-02).
- La latencia de búsqueda no debe empeorar frente al índice en memoria; se mide con
  `bench:stages`.

**Constraints**:
- OCR y embeddings 100 % locales.
- Ningún endpoint de administración sin autenticación: solo CLI hasta el bloque 7.
- Una verificación como máximo cada 7 días.
- Retención mínima de 12 meses.
- Sin interrupción del chat.

**Scale/Scope**:
- ~420 elementos: 31 de GMAS2, ~140 PDF y ~250 páginas de ambientometro, 4 de
  envigado.gov.co, más observatorioenvigado.geotrends.co.
- ~10 consultas/min en el pico (memoria del proyecto).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Evaluación | Resultado |
|---|---|---|
| I. Orientación preliminar | No cambia el comportamiento conversacional. | ✅ N/A |
| II. Anclaje documental | Las citas siguen saliendo de los fragmentos recuperados. El payload lleva nombre, enlace y fecha, lo que habilita RF-C3-DI-07. `documentLinks` lee solo códigos publicados. | ✅ |
| III. Base cerrada y validada | Este es su núcleo: alcance por matriz (R10, R16), hosts permitidos en un archivo versionado (R11), pendiente → publicado (FR-017), derogado excluido, última versión validada preservada (R2), reindexación atómica (R4), formatos en blanco (R12). | ✅ |
| IV. Privacidad por diseño | Los formatos diligenciados se rechazan (R12). OCR y embeddings siguen siendo locales. Las notificaciones y los registros no llevan datos personales. | ✅ |
| V. Proveedor único | No toca los proveedores LLM. | ✅ N/A (deuda nº 1 intacta, no empeora) |
| VI. Falla segura | La verificación fallida conserva la versión anterior y notifica. Una indexación fallida no mueve el alias. Qdrant caído produce `SERVICIO_NO_DISPONIBLE`, nunca "sin información". Las notificaciones se agrupan, viven solo en el sistema y el vigilante detecta corridas atrasadas. | ✅ |
| VII. Seguridad del perímetro | No hay endpoints nuevos. PostgreSQL y Qdrant solo están en la red interna. Rol `app_reader` de solo lectura para el chat. Las acciones de la CLI quedan en `kb_auditoria`. La exportación neutraliza la inyección de fórmulas. | ✅ |
| VIII. Experiencia accesible | No hay interfaz nueva. El chat deja de detenerse durante la reindexación. | ✅ |
| IX. Trazabilidad cerrada | Cada decisión de [research](./research.md) cita su RF/RNF. Dos elementos sin ID propio: FR-017 (pendiente → publicado), que sale del principio III y prepara RF-C3-AD-21, y la retirada de `ocrmypdf`, que es infraestructura de RF-C3-IV-07. | ✅ |
| X. Pruebas obligatorias | Pruebas por requisito con fixtures reales, integración contra PostgreSQL y Qdrant, re-base del conjunto de oro. CI ampliada a Python y a integración, con disparadores en `develop`, `prod_test` y `main`. | ✅ |
| Stack | TypeScript en lo que atiende; Python solo en el scraper offline; PostgreSQL + Qdrant; embeddings locales; Docker y Dokploy. | ✅ |
| Deuda de migración | Reduce la nº 2 (índice en memoria → Qdrant; la matriz pasa a PostgreSQL; el CSV de interacciones queda para el bloque 5) y la nº 3 (corpus fuera de alcance). No amplía ninguna. | ✅ |

**Gate inicial**: aprobado. **Re-evaluación tras el diseño (Fase 1)**: aprobado. El diseño no
introdujo endpoints, proveedores ni almacenamiento fuera de lo previsto. Los servicios nuevos
se justifican abajo.

## Project Structure

### Documentation (this feature)

```text
specs/001-base-conocimiento-bloque1/
├── spec.md
├── diagnostico.md           # estado actual por requisito
├── plan.md                  # este archivo
├── research.md              # Fase 0 (R1–R19)
├── data-model.md            # Fase 1
├── quickstart.md            # Fase 1, validación por criterio de éxito
├── contracts/
│   ├── run-report.md        # scraper → kb-worker
│   ├── encabezados-markdown.md
│   ├── qdrant-coleccion.md  # kb-worker → backend del chat
│   ├── matriz-xlsx.md
│   └── kb-cli.md            # CLI del operador y servicio interno
├── checklists/requirements.md
└── tasks.md                 # Fase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
web_scraper/
├── scraper/
│   ├── sources.py           # sin concejo y ministerios; + GT-P-029; + observatorio_geotrends; recorrido GMAS2 acotado
│   ├── gmas2.py             # NUEVO: metadatos estructurados (código, versión, fecha, estado, dependencia, vinculados)
│   ├── html_parser.py       # normalización de jqGrid y tablas anidadas, eliminación de ruido
│   ├── crawler.py           # derogado registrado (no descartado), estructura_modificada, sin sobrescritura en error
│   └── run_report.py        # NUEVO: informe de corrida (escritura atómica)
├── tests/
│   ├── fixtures/gmas2/      # HTML real de GT-P-004, GT-P-021, un vinculado y un derogado
│   └── test_*.py
├── crontab                  # NUEVO: SCRAPER_CRON
└── Dockerfile               # + supercronic; ENTRYPOINT programado

backend/
├── config/base-conocimiento.json   # NUEVO: mapa GT-P → dirección, mapa por sección, hosts permitidos
├── migrations/                     # NUEVO: 001_esquema_kb.sql, …
├── src/
│   ├── kb/                         # NUEVO: dominio del kb-worker
│   │   ├── worker.ts               # proceso de larga duración (sondeo, purga diaria, vigilante)
│   │   ├── cli.ts                  # CLI del operador
│   │   ├── service.ts              # funciones reutilizables por el bloque 7
│   │   ├── db.ts                   # pool pg y runner de migraciones
│   │   ├── runReport.ts            # validación del informe de corrida
│   │   ├── scope.ts                # reglas de alcance (IV-01) y direcciones (R11)
│   │   ├── conversion.ts           # conversión a Markdown y decisión de OCR (IV-07, IV-08)
│   │   ├── ocr.ts                  # Tesseract TSV y confianza media
│   │   ├── fichas.ts               # encabezados de fichas y páginas (IV-05, IV-06)
│   │   ├── blankForms.ts           # control de formatos en blanco (IV-10)
│   │   ├── indexer.ts              # Qdrant: colección, alias, upsert y borrado (RNF-IV-01, 02)
│   │   ├── sparse.ts               # vector BM25 disperso desde terms()
│   │   ├── notifications.ts        # alta y agrupación
│   │   ├── retention.ts            # purga (RNF-IV-03)
│   │   └── exportMatrix.ts         # .xlsx (IV-12)
│   ├── services/
│   │   ├── search.ts               # hybridSearch sobre Qdrant (se retira buildIndex)
│   │   ├── qdrant.ts               # NUEVO: cliente compartido
│   │   ├── chunking.ts             # sin cambios; lo usa kb/indexer
│   │   ├── documentPreprocessor.ts # PDF/DOCX/DOC/XLSX nativos; el OCR pasa a kb/ocr
│   │   ├── documentLinks.ts        # índice código → URL desde kb.v_codigos_publicados
│   │   ├── indexSnapshot.ts        # SE RETIRA
│   │   └── sourceMetadata.ts       # SE RETIRA de la ruta de búsqueda
│   └── indexDocuments.ts           # SE RETIRA (lo reemplaza kb sincronizar --completa)
├── test/
│   ├── kb-*.test.ts                # unitarias por requisito
│   └── kb-integracion/             # contra PostgreSQL y Qdrant
└── Dockerfile                      # + poppler-utils; − ocrmypdf/unpaper; NODE_OPTIONS 1024

docker-compose.yml   # + postgres, qdrant, kb-worker; scraper como servicio programado; − indexer
Makefile             # + make kb CMD=…; scrape lanza una corrida manual; − cache
.env.example         # variables nuevas; SCRAPER_SOURCES con 4 fuentes
.github/workflows/ci.yml  # disparadores develop/prod_test/main; jobs scraper y kb-integracion
```

**Structure Decision**:
- Se mantiene la estructura de aplicación web existente (`backend/`, `frontend/`,
  `web_scraper/`).
- El `kb-worker` vive dentro de `backend/src/kb/` y usa la misma imagen que el backend,
  con otro comando, igual que hacía el `indexer`. Así comparte la conversión, la
  fragmentación y los embeddings sin duplicar código.
- `frontend/` no cambia en este bloque.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Tres servicios nuevos en el compose (`postgres`, `qdrant`, `kb-worker`) y el scraper convertido en servicio programado | La constitución y RNF-C3-IV-01 fijan PostgreSQL y Qdrant. RF-C3-IV-02 exige verificar sin intervención manual. RNF-C3-IV-02 exige que la indexación no detenga el chat, así que debe correr fuera del backend. | Indexar dentro del backend mantiene la parada de `make cache` y la competencia por CPU (RNF-C3-IN-13). Un cron externo (Dokploy) deja la programación fuera del repositorio y sin pruebas. |
| Pipeline repartido en dos lenguajes con un informe JSON como frontera | El scraper de GMAS2 (renderizado JS, `downloadFile`, estados) ya está en Python. La conversión, el OCR y los embeddings ya están en TypeScript. La constitución restringe Python a procesos offline. | Reescribir el scraper en TypeScript duplica trabajo probado sin aportar a ningún requisito. Que Python escriba en PostgreSQL crea dos escritores de la matriz. |
| Tesseract directo en lugar de `ocrmypdf` | RF-C3-IV-07 exige la confianza media del motor, y `ocrmypdf` no la expone. | Leer los archivos temporales hOCR de `ocrmypdf` depende de un comportamiento interno no documentado. |
