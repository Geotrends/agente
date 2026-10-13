---

description: "Lista de tareas: Base de conocimiento institucional (Bloque 1)"
---

# Tasks: Base de conocimiento institucional (Bloque 1)

**Input**: documentos de diseño en `specs/001-base-conocimiento-bloque1/`:

- [plan.md](./plan.md), [spec.md](./spec.md) y [diagnostico.md](./diagnostico.md)
- [research.md](./research.md): las decisiones R1–R19
- [data-model.md](./data-model.md)
- [contracts/](./contracts/)
- [quickstart.md](./quickstart.md)

**Tests**: obligatorios. El principio X de la constitución exige que todo cambio de
comportamiento tenga pruebas automatizadas que verifiquen el criterio del RF/RNF que toca, y
que pasen en CI. En cada historia, las pruebas van antes que la implementación.

**Trazabilidad**: cada tarea cita entre paréntesis el requisito del documento C3–C4 que cubre
o sostiene (principio IX), seguido, si aplica, de la decisión de [research](./research.md)
(R#).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: puede ejecutarse en paralelo (archivos distintos, sin dependencias pendientes).
- **[Story]**: historia de la spec (US1 a US6).
- Rutas relativas a la raíz del repositorio. Backend en `backend/`, scraper en `web_scraper/`.

---

## Phase 1: Setup (infraestructura compartida)

**Purpose**: dependencias, servicios del compose, configuración y CI.

- [X] T001 Agregar las dependencias `pg`, `@qdrant/js-client-rest` (misma versión menor que
  la imagen de Qdrant de T002) y `@types/pg` (dev) en `backend/package.json`, y reemplazar el
  script `index` por `kb` (`node --import tsx src/kb/cli.ts`) (RF-C3-IV-11, RNF-C3-IV-01;
  R13).
- [X] T002 [P] Modificar `docker-compose.yml`:
  - agregar el servicio `postgres` (imagen `postgres:16`, volumen `geobot-pg`, sin `ports`,
    healthcheck `pg_isready`);
  - agregar el servicio `qdrant` (imagen `qdrant/qdrant:v1.19.2-unprivileged`, tag
    verificado, mínimo 1.10 por `modifier: idf`; volumen `geobot-qdrant`; sin `ports`);
  - agregar el servicio `kb-worker` (imagen `geobot-backend:latest`, comando
    `["node","dist/kb/worker.js"]`, volumen de datos en `/app/data:ro`, volumen `geobot-var`,
    `depends_on: postgres, qdrant` en estado healthy);
  - crear el volumen `geobot-runs`, montado en lectura-escritura en `/data/runs` del
    `scraper` y en `/app/data/runs` del `kb-worker`; el resto de `/app/data` sigue en solo
    lectura;
  - quitar el servicio `indexer`;
  - en `backend`, agregar `QDRANT_URL` y `APP_DATABASE_URL` y quitar el volumen
    `geobot-cache` del índice.
  (RF-C3-IV-02, RNF-C3-IV-01, RNF-C3-IV-02; R1, R5, R13)
- [X] T003 [P] Actualizar `.env.example`:
  - agregar las variables documentadas `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`,
    `KB_DATABASE_URL`, `APP_DATABASE_URL`, `QDRANT_URL`, `SCRAPER_CRON`,
    `OCR_MIN_CONFIDENCE=80`, `KB_RETENCION_MESES=13`, `KB_SONDEO_MS=300000` y
    `KB_UMBRAL_ESTRUCTURA=0.3`;
  - dejar `SCRAPER_SOURCES=gmas2_envigado ambientometro envigado_com observatorio_geotrends`;
  - quitar `INDEX_REVALIDATE_*` y `OCR_DESKEW`/`OCR_RETRY_ENABLED` con sus comentarios.
  (RF-C3-IV-01, RF-C3-IV-02, RF-C3-IV-07, RNF-C3-IV-03; R5, R6, R14, R16)
- [X] T004 [P] Actualizar `Makefile`:
  - agregar el objetivo `kb` (`docker compose exec kb-worker node dist/kb/cli.js $(CMD)`);
  - hacer que `scrape` lance una corrida manual con
    `docker compose run --rm scraper python main.py --output /data --manual`;
  - eliminar los objetivos `cache` y `require-index`;
  - ajustar `check-env` para exigir `POSTGRES_PASSWORD`.
  (RF-C3-IV-12, RNF-C3-IV-02; contracts/kb-cli.md)
- [X] T005 [P] Agregar `poppler-utils` al `apt-get install` de `backend/Dockerfile` y cambiar
  `NODE_OPTIONS` a `--max-old-space-size=1024`, actualizando el comentario de C-2
  (RF-C3-IV-07, RNF-C3-IV-02; R6, R17).
- [X] T006 [P] Modificar `.github/workflows/ci.yml`:
  - disparadores `push` en `develop`, `prod_test` y `main`, más `pull_request`;
  - nuevo job `scraper` (Python 3.12, `pip install -r web_scraper/requirements.txt`,
    `python -m unittest discover -s web_scraper/tests`);
  - nuevo job `kb-integracion` con *service containers* `postgres:16` y la misma imagen de
    Qdrant de T002, que ejecuta `npm run test:kb-integracion`;
  - agregar `poppler-utils` a la verificación de herramientas del job `imagen`.
  (verificación en CI de RF-C3-IV-01 a IV-12 y RNF-C3-IV-01 a IV-03; R18)
- [X] T007 [P] Registrar en `backend/src/services/settings.ts` los ajustes:
  - `ocrMinConfidence` (entero, por defecto 80, **mínimo 80**);
  - `kbRetencionMeses` (por defecto 13, **mínimo 12**);
  - `kbSondeoMs` (por defecto 300000);
  - `kbUmbralEstructura` (por defecto 0,3; entre 0 y 1).
  Un valor fuera de rango se recorta al mínimo o máximo con aviso, según la convención de
  `config.ts`: nunca aborta el arranque. `indexRevalidateMs` e
  `indexRevalidateMaxHeapFraction` se retiran en T022, y `ocrRetryEnabled` y `ocrDeskew` en
  T057, junto con el código que los usa. Ajustar `backend/test/settings.test.ts`.
  (RF-C3-IV-04, RF-C3-IV-07, RNF-C3-IV-03; R6, R14)

---

## Phase 2: Foundational (prerrequisitos bloqueantes)

**Purpose**: confirmación del mapa, esquema, configuración, frontera scraper → kb-worker,
notificaciones, Qdrant y migración de la búsqueda del chat.

**⚠️ CRITICAL**: ninguna historia puede empezar antes de completar esta fase.

- [X] T008 Crear `web_scraper/scripts/capture_fixtures.py`, que renderiza con Playwright y
  guarda el HTML:
  - en `web_scraper/tests/fixtures/gmas2/`, el `#area` de GT-P-004 (`0000010207`), GT-P-021
    y GT-P-029 (`0000004622`); el vinculado GT-F-011 (`0000013830`); MG-P-003
    (`0000002961`); una norma vinculada; un documento con estado "Derogado";
  - en `web_scraper/tests/fixtures/observatorio/`, la página completa de
    `https://observatorioenvigado.geotrends.co/observatorio` y la portada de
    `https://ambientometroenvigado.com/`.
  Registrar en `web_scraper/tests/fixtures/README.md` el host final de cada captura tras las
  redirecciones (host canónico) y si la página necesita JS. Ejecutar el script y versionar
  las fixtures (RF-C3-IV-01, RF-C3-IV-03, RF-C3-IV-09; R8, R10, R11).
- [X] T009 Pedir al Líder de Proyecto la confirmación del mapa por sección de research R11 y
  registrar el resultado en `specs/001-base-conocimiento-bloque1/research.md` (cambiar
  "(confirmar)" por "Confirmado AAAA-MM-DD", con las correcciones si las hay) (RF-C3-IV-11;
  R11).
- [X] T010 Crear `backend/config/base-conocimiento.json` con:
  - `procedimientos`: `GT-P-004 → gestion_ambiental`; `GT-P-011`, `GT-P-020`, `GT-P-021` y
    `GT-P-027 → bienestar_animal`; `GT-P-029 → ecosistemas`;
  - `secciones`: el mapa confirmado en T009;
  - `fuentes_observatorio`: `ambientometro → "Ambientómetro"`,
    `envigado_com → "Envigado.gov.co"`, `observatorio_geotrends → "Observatorio Geotrends"`;
  - `hosts_permitidos`: `envigado.gov.co` (dominio con subdominios),
    `www.concejoenvigado.gov.co`, `observatorioenvigado.geotrends.co` y
    `ambientometroenvigado.com` (hosts exactos), más la variante `www.` de los hosts cuyo
    canónico registrado en T008 sea `www.`.
  Crear `backend/src/kb/config.ts`, que lo carga y valida al arrancar. Las direcciones deben
  ser exactamente `ecosistemas | bienestar_animal | gestion_ambiental | secretaria_general`;
  si no, falla con un mensaje claro (RF-C3-IV-01, RF-C3-IV-11; R11).
- [X] T011 Crear `backend/src/kb/db.ts`: pool `pg` sobre `KB_DATABASE_URL` y un runner de
  migraciones que aplica `backend/migrations/*.sql` en orden, cada uno en una transacción,
  y registra los aplicados en `schema_migrations(nombre, aplicada_en)`. Debe ser idempotente
  (RF-C3-IV-11, RNF-C3-IV-03; R13).
- [X] T012 Crear `backend/migrations/001_esquema_kb.sql` con el esquema `kb` de
  [data-model.md](./data-model.md):
  - **Enums**:
    - `tipo_elemento ('procedimiento','formato','norma','pagina','documento')`;
    - `estado_elemento ('pendiente_aprobacion','publicado','derogado','vencido')`;
    - `direccion ('ecosistemas','bienestar_animal','gestion_ambiental','secretaria_general')`;
    - `origen_elemento ('scraper','manual')`;
    - `estado_detectado ('vigente','derogado','no_aplica')`;
    - `resultado_verificacion ('sin_cambios','cambio_detectado','nuevo','error')`;
    - `tipo_error ('inaccesible','http','estructura_modificada','timeout','fuera_de_alcance')`;
    - `decision_procesamiento ('cargado','descartado_ocr','formato_diligenciado','fallo_extraccion')`;
    - `tipo_notificacion` con los 9 valores del data model;
    - `estado_notificacion ('no_revisada','revisada')`.
  - **Tablas**:
    - `kb_elemento`: `clave` UNIQUE; `fecha_carga timestamptz NOT NULL`;
      CHECK `cardinality(procedimientos_origen) > 0`; CHECK que `codigo`,
      `version_documento` y `fecha_actualizacion` solo sean `NULL` si
      `fuente <> 'gmas2_envigado'`;
    - `kb_version`: UNIQUE `(elemento_id, hash_contenido)`;
    - `kb_procesamiento`: CHECK `confianza_ocr between 0 and 100`;
    - `kb_corrida`, `kb_verificacion` (`codigo_http smallint NULL`), `kb_notificacion`,
      `kb_indexacion`, `kb_auditoria` y `kb_purga`.
  - **Índices únicos parciales**:
    - `kb_notificacion(tipo, objeto) WHERE estado = 'no_revisada'`;
    - `kb_indexacion((true)) WHERE estado = 'en_curso'`.
  - **Vistas**:
    - `v_matriz`: 12 columnas, con "N/A" solo en código, versión y fecha de actualización
      del contenido del Observatorio;
    - `v_codigos_publicados`: `codigo` y `url_origen` de los elementos `publicado` con
      código.
  - **Roles y permisos**: `kb_writer` con DML sobre `kb`; `app_reader` con `SELECT` solo
    sobre `kb.v_codigos_publicados`.
  (RF-C3-IV-11, RNF-C3-IV-03; R13)
- [X] T013 [P] Crear `web_scraper/scraper/run_report.py`:
  - clase `RunReport` que acumula objetos `Enlace` con los campos de
    [contracts/run-report.md](./contracts/run-report.md);
  - escritura atómica: primero `/data/runs/<run_id>.json.tmp` y después `rename`;
  - `schema_version: 1`.
  Integrarlo en `web_scraper/main.py`: genera el `run_id` (uuid4), recibe el flag `--manual`
  (`programada=false`; por defecto `true`), marca `completa=false` si hubo una excepción o
  `KeyboardInterrupt` y escribe el informe al terminar (RF-C3-IV-02; R1).
- [X] T014 [P] Crear `backend/src/kb/runReport.ts`: lee y valida un informe de corrida contra
  el contrato, rechaza `schema_version` desconocido, normaliza las fechas y devuelve tipos
  estrictos (`Enlace`, `MetadatosGmas`). Prueba en `backend/test/kb-runreport.test.ts` con
  un informe válido, uno sin `run_id`, uno con `resultado` desconocido y uno `.tmp`
  ignorado (RF-C3-IV-02; R1).
- [X] T015 [P] Crear `backend/src/kb/notifications.ts` con
  `notificar(tipo, objeto, descripcion)`:
  - mientras exista una notificación `no_revisada` con el mismo `tipo` y `objeto`, hace un
    upsert sobre el índice parcial que incrementa `repeticiones` y actualiza `ultima_en`;
  - la `descripcion` se sanitiza: sin rutas absolutas, trazas ni datos personales, con
    `pii.ts`.
  `marcarRevisada(id, actor)` fija `revisada_por` y `revisada_en`. Las notificaciones
  **NUNCA** se envían por canales externos (RF-C3-IV-03, RF-C3-IV-04, RF-C3-IV-07; FR-018).
- [X] T016 [P] Crear `backend/src/kb/audit.ts` con
  `registrarAccion(actor, accion, objeto, resultado)` sobre `kb_auditoria`, sin contenido de
  documentos (RF-C3-IV-11, anticipa RF-C3-AD-41; principio VII).
- [X] T017 [P] Crear `backend/src/kb/sparse.ts` con
  `vectorBm25(texto, avgdl): { indices: number[], values: number[] }`:
  - usa `terms()` de `backend/src/services/retrievalMath.ts`;
  - hash estable de 32 bits por término (FNV-1a);
  - valores = tf saturado BM25 con k1 = 1,2 y b = 0,75;
  - colisiones de hash combinadas sumando;
  - para la consulta, `vectorConsulta(WeightedQuery)` aplica los pesos de
    `weighQueryTerms`.
  Prueba en `backend/test/kb-sparse.test.ts`: determinismo, colisiones, efecto de `avgdl`
  (RNF-C3-IV-01; R3).
- [X] T018 [P] Crear `backend/src/services/qdrant.ts`: cliente compartido con
  `@qdrant/js-client-rest` sobre `QDRANT_URL`, timeout de 5 s y la constante de alias
  `kb_chunks` (RNF-C3-IV-01; contracts/qdrant-coleccion.md).
- [X] T019 Crear `backend/src/kb/indexer.ts` con:
  - `asegurarColeccion()`: si el alias `kb_chunks` no existe, crea
    `kb_chunks_<yyyymmddHHMMss>` con el vector `dense` (384 dimensiones, Cosine) y el
    disperso `bm25` (`modifier: idf`), índices de payload keyword para `elemento_id`,
    `estado` y `direccion`, y apunta el alias;
  - `indexarVersion(version, elemento)`: `chunkDocument` (de
    `backend/src/services/chunking.ts`), `embed(…, 'passage')` en lotes de 8,
    `vectorBm25` y upsert con id `uuidv5(version_id + nº de fragmento)` y el payload
    completo del contrato, incluido `url_padre` (la página que enlaza un PDF o descarga, o
    `null`), con `estado: "publicado"`;
  - `borrarPuntosVersion(versionId)` y `borrarPuntosElemento(elementoId)`.
  (RNF-C3-IV-01, RNF-C3-IV-02; R3, R4)
- [X] T020 Crear `backend/src/kb/service.ts` con `estadoBase()` (alias, colección, conteos
  por estado, última corrida, última indexación) y `aplicarMigraciones()`. Crear
  `backend/src/kb/cli.ts`, que despacha los subcomandos de
  [contracts/kb-cli.md](./contracts/kb-cli.md) (por ahora `migrar` y `estado`) con códigos
  de salida 0, 1 y 2. Crear `backend/src/kb/worker.ts`: aplica migraciones al arrancar,
  llama a `asegurarColeccion()`, deja un bucle vacío cada `kbSondeoMs` y apaga
  ordenadamente con SIGTERM (RF-C3-IV-11, RNF-C3-IV-02; R1).
- [X] T021 Re-basar la línea base de recuperación antes de migrar la búsqueda:
  - el conjunto de oro anterior no tiene ningún caso factual dentro del alcance (sus 14
    factuales son del Concejo y de MinAmbiente), así que **filtrarlo no alcanza**;
  - se creó `backend/test/fixtures/golden-set-acotado.json`: 14 preguntas factuales sobre los
    6 GT-P, una norma y las páginas del Observatorio, más los 24 casos de abstención
    anteriores. Se identifica por URL de origen (`identificador: "url"`), que es igual antes
    y después de Qdrant. Los casos factuales están **pendientes de revisión humana** y son
    una línea base relativa, no el conjunto de oro de RF-C3-DI-05;
  - con el índice en memoria actual sobre el corpus local acotado se midió y guardó
    `backend/test/fixtures/baseline-acotado.json`: recall@8 78,6 %, MRR 0,714,
    nDCG@8 0,733;
  - `backend/scripts/eval-retrieval.ts` acepta `--guardar-baseline=` y `--baseline=` (sale
    con 1 si recall@8 baja más de 2 puntos) y deduplica los hits por URL.
  (RF-C3-IV-01, RNF-C3-IV-01; R17)
- [X] T022 Migrar `hybridSearch` en `backend/src/services/search.ts` a Qdrant:
  - embebe la consulta (`'query'`) y lanza dos consultas top-40 sobre el alias: `dense`, y
    `bm25` con `vectorConsulta`, aplicando el peso de la pregunta previa;
  - ambas con el filtro `estado = "publicado"`;
  - fusiona con `reciprocalRankFusion` (k = 60) y conserva sin cambios el reranker,
    `rankAndFilterByRelevance` y `diversify`;
  - arma cada hit con el mapeo explícito de contracts/qdrant-coleccion.md: `path ← url`,
    `sourceUrl ← url`, `sourcePageUrl ← url_padre` (se omite si es `null`),
    `title ← titulo`, `category ← direccion`, `page ← pagina`, `chunk ← fragmento`,
    `snippet ← texto`. Así siguen funcionando `answerQuestion.ts:81-91` y
    `chatLog.ts:152-181`;
  - eliminar `buildIndex`, `getIndex`, `prepareIndex`, el tipo `Index` y la caché por
    documento;
  - `retrievalStatus.state` pasa a reflejar `ready` o `error` según la existencia del alias.
  Actualizar `backend/src/services/retrievalWorker.ts` (el `warmup` ya no prepara el
  índice), `backend/src/services/retrievalClient.ts` y `backend/src/routes/health.ts`
  (`/ready` falso si Qdrant o el alias no están disponibles) (RF-C3-IV-01, RF-C3-IV-03,
  RNF-C3-IV-01; R3, R17; principio VI).
- [X] T023 Retirar `backend/src/services/indexSnapshot.ts` y `backend/src/indexDocuments.ts`,
  y el uso de `sourceMetadata.ts` en la búsqueda. Eliminar o reescribir las pruebas
  obsoletas `backend/test/index-snapshot.test.ts`,
  `backend/test/chunk-cache-prune.test.ts` y `backend/test/vector-scan.test.ts`. Quitar de
  `backend/package.json` los scripts `probe:rebuild` y `bench:worker`, que dependían del
  índice en memoria (RNF-C3-IV-01, RNF-C3-IV-02; R17).
- [X] T024 Modificar `backend/src/services/documentLinks.ts`: `loadDocumentCodeIndex()` lee
  `select codigo, url_origen from kb.v_codigos_publicados` con un pool de solo lectura sobre
  `APP_DATABASE_URL`, memoizado con TTL de 5 minutos. Si PostgreSQL falla, conserva el
  último índice y, sin índice, devuelve un mapa vacío: los códigos quedan como texto.
  Ajustar `backend/test/document-links.test.ts` (RF-C3-IV-01, RF-C3-IV-03; R17).
- [X] T025 Crear la prueba de integración `backend/test/kb-integracion/busqueda.test.ts`
  contra PostgreSQL y Qdrant reales:
  - indexa 3 versiones de prueba;
  - verifica que `hybridSearch` recupera por términos exactos (bm25) y por significado
    (dense), y que nunca devuelve puntos con `estado != publicado`;
  - verifica que cada hit trae `sourceUrl === url`, que el de un PDF trae `sourcePageUrl`, y
    que el contexto que arma `answerQuestion` incluye la línea "URL original:";
  - con el alias inexistente, `/ready` responde 503.
  Agregar el script `test:kb-integracion` en `backend/package.json` (RF-C3-IV-03,
  RNF-C3-IV-01; R3, R18).

**Checkpoint**: el chat consulta Qdrant (vacío hasta la primera publicación), el esquema
existe, el mapa de direcciones está confirmado y el scraper escribe informes de corrida.

---

## Phase 3: User Story 1 - Base acotada y trazable con matriz documental (Priority: P1) 🎯 MVP

**Goal**: la base contiene solo los 6 GT-P, sus vinculados, los MG citados y las fuentes del
Observatorio autorizadas. Todo figura en la matriz con sus 12 campos y nada fuera de ella es
recuperable (RF-C3-IV-01, IV-11; FR-001 a FR-005, FR-017).

**Independent Test**: corrida manual → `kb sincronizar` → `kb publicar --todos-pendientes`
→ `kb auditar-alcance`. Termina con código 0, la matriz coincide 1 a 1 con lo cargado y no
hay contenido del Concejo ni de los ministerios (quickstart §2).

### Tests for User Story 1

- [X] T026 [P] [US1] Prueba `web_scraper/tests/test_sources_scope.py`:
  - `SOURCES` contiene exactamente `gmas2_envigado`, `ambientometro`, `envigado_com` y
    `observatorio_geotrends`;
  - `GMAS2_DOCUMENT_IDS` incluye `0000004622`;
  - un enlace a un host fuera de la lista permitida se reporta con
    `error.tipo = "fuera_de_alcance"` y no se descarga;
  - `HOSTS_PERMITIDOS` de Python es idéntica a `hosts_permitidos` de
    `backend/config/base-conocimiento.json` (la prueba lee el JSON).
  (RF-C3-IV-01, anticipa RF-C3-AD-15)
- [X] T027 [P] [US1] Prueba `web_scraper/tests/test_gmas2_crawl.py` con la fixture de
  GT-P-004:
  - `gmas.vinculados` contiene GT-F-011, GT-F-012, MG-P-003, MG-F-002 y MG-F-051;
  - desde un vinculado (GT-F-011) solo se encola la descarga de `downloadFile.public` y
    nunca otro `VisualizacionDocumento`;
  - `gmas` trae código, nombre, `version="06"`, `fecha_actualizacion="2022-09-12"`,
    `estado="Vigente"` y la dependencia.
  (RF-C3-IV-01, RF-C3-IV-05)
- [X] T028 [P] [US1] Prueba `backend/test/kb-scope.test.ts`:
  - cada GT-P recibe su dirección del mapa;
  - un vinculado hereda la dirección de su GT-P;
  - un vinculado con dos orígenes de direcciones distintas toma la del primero por código y
    lista ambos en `procedimientos_origen`;
  - una página casa con el prefijo más largo;
  - un PDF hereda la sección de su página padre;
  - lo que no casa con nada queda en `secretaria_general`;
  - el contenido del Observatorio recibe como `procedimientos_origen` el nombre de su
    fuente;
  - un MG que ningún GT-P cita es rechazado por la regla de alcance.
  (RF-C3-IV-01, RF-C3-IV-11)
- [X] T029 [P] [US1] Prueba de integración `backend/test/kb-integracion/sincronizar.test.ts`
  con un informe de corrida fixture:
  - crea los elementos en `pendiente_aprobacion` con `fecha_carga` ya fijada y los 12 campos
    de `v_matriz`;
  - "N/A" solo en código, versión y fecha de actualización del contenido del Observatorio;
    su procedimiento de origen es el nombre de la fuente;
  - `publicar` los indexa sin cambiar `fecha_carga`;
  - `auditar-alcance` devuelve 0;
  - un segundo informe **completo**, con GT-P-004 visitado sin error y sin un vinculado, lo
    elimina de la matriz, borra sus puntos y emite `fuera_de_alcance`;
  - si falta uno de los 6 GT-P en un informe completo, se emite `procedimiento_faltante`.
  (RF-C3-IV-01, RF-C3-IV-11)

### Implementation for User Story 1

- [X] T030 [P] [US1] Modificar `web_scraper/scraper/sources.py`:
  - eliminar las definiciones `concejo_envigado`, `minambiente` y `minagricultura` y sus
    constantes (`ALLOWED_PATHS_CONCEJO`, `MIN*_HIGH_PRIORITY`, `MIN*_BLACKLIST`,
    `SOURCE_DELAYS`);
  - agregar `"0000004622"` a `GMAS2_DOCUMENT_IDS`;
  - agregar la fuente `observatorio_geotrends` (`start_urls`
    `https://observatorioenvigado.geotrends.co/observatorio`, `allowed_domains` con su host
    canónico de T008, `mode="general_observatory"`, `render_js` según el registro de T008);
  - agregar la lista `HOSTS_PERMITIDOS`, idéntica a la de
    `backend/config/base-conocimiento.json`.
  Actualizar `web_scraper/main.py` (descripción y `print_report` sin secciones de concejo y
  ministerios) y `web_scraper/README.md` (RF-C3-IV-01; R16).
- [X] T031 [US1] Diagnosticar con la fixture de GT-P-004 por qué hoy no se descargan MG-P-003,
  MG-F-002 ni MG-F-051. Las hipótesis de R10 son `allowed_paths`, el selector de estado y la
  profundidad. Corregir la causa en `web_scraper/scraper/crawler.py` y/o
  `web_scraper/scraper/html_parser.py`, y documentar la causa en un comentario junto a la
  corrección (RF-C3-IV-01; R10).
- [X] T032 [US1] Implementar la regla de recorrido de GMAS2 en
  `web_scraper/scraper/crawler.py`:
  - desde una semilla GT-P se encolan sus vinculados (profundidad 1);
  - desde un vinculado solo se encolan las URLs `downloadFile.public`;
  - se reemplaza `max_depth=10` de `gmas2_envigado` en `sources.py`;
  - todo enlace cuyo host no esté en `HOSTS_PERMITIDOS` se registra en el informe con
    `error.tipo="fuera_de_alcance"` sin descargarlo.
  (RF-C3-IV-01; R10)
- [X] T033 [P] [US1] Crear `web_scraper/scraper/gmas2.py` con
  `extraer_metadatos(soup) -> dict`, que extrae:
  - código, nombre, versión ("Versión: 06" → "06"), fecha ("Fecha: 12-09-2022" →
    "2022-09-12"), estado (`.estado`) y dependencia (fila "DEPENDENCIAS");
  - los `vinculados` de las rejillas "Documentos Referencia", "Documentos Transversales",
    "Registros" y "Relaciones": código, nombre, id, URL absoluta y `grupo`;
  - la `descarga` absoluta de `javascript:downloadFile`.
  Usarlo desde `web_scraper/scraper/crawler.py` para poblar `Enlace.gmas` (RF-C3-IV-05;
  R9).
- [X] T034 [US1] Hacer que `web_scraper/scraper/crawler.py` registre en `RunReport` un
  `Enlace` por cada página o descarga visitada:
  - `rol`: procedimiento, vinculado, descarga, página o documento;
  - `padre`, `fuente`, `fecha_hora`, `estado_detectado`, `hash_contenido`, `archivo`,
    `archivo_original` y `hash_original`;
  - `resultado` = `nuevo`, `sin_cambios` o `cambio_detectado`, comparando con el hash previo
    de esa URL en `MetadataStore`.
  Al terminar cada fuente, emitir además `resultado="error"`
  (`error.tipo="inaccesible"`, `detalle="no alcanzado"`) por cada URL previa de
  `MetadataStore` de esa fuente que no se visitó (regla 6 del contrato) (RF-C3-IV-02,
  RF-C3-IV-04).
- [X] T035 [US1] Crear `backend/src/kb/scope.ts`:
  - `esDelAlcance(enlace, contextoCorrida)`: GT-P semilla; vinculado de un GT-P con código
    `-F-`, `-N-` o `MG-P`/`MG-F`; fuente del Observatorio autorizada; host en la lista
    permitida;
  - `direccionPara(elemento)`: mapa GT-P, herencia, prefijo de sección más largo, herencia
    del padre para PDF, `secretaria_general` como valor final;
  - `procedimientosOrigenPara(elemento)`: los códigos GT-P padres o, en el contenido del
    Observatorio, `[fuentes_observatorio[fuente]]`. Nunca vacío;
  - `tipoPara(codigo|rol)`: `procedimiento | formato | norma | pagina | documento`.
  (RF-C3-IV-01, RF-C3-IV-11; R9, R11)
- [X] T036 [US1] Crear `backend/src/kb/conversion.ts` con
  `convertir(archivo) -> { contenidoMd, caracteresNativos, ocrAplicado, formatoOriginal, decision }`,
  sobre `backend/src/services/documentPreprocessor.ts` (extracción nativa; la decisión de
  OCR se completa en US3). Registra cada conversión en `kb_procesamiento` con
  `clave_elemento`, `formato_original`, `caracteres_nativos`, `ocr_aplicado`, `decision`,
  `duracion_ms` y `fecha` (RF-C3-IV-08).
- [X] T037 [US1] Crear `backend/src/kb/sync.ts` con `procesarInforme(ruta)`:
  - en una transacción, registra `kb_corrida`;
  - por cada enlace del alcance, hace upsert de `kb_elemento` por `clave` (código o URL
    normalizada) con `nombre`, `tipo`, `direccion`, `url_origen` (solo https y host
    permitido), `fuente`, `origen='scraper'`, `procedimientos_origen` (de
    `procedimientosOrigenPara`), `version_documento` y `fecha_actualizacion` (de `gmas`; si
    no hay, `NULL`, solo en el contenido del Observatorio), y `fecha_carga = now()` **solo
    al insertar**;
  - si `resultado` es `nuevo` o `cambio_detectado`, crea una `kb_version`
    (`hash_contenido` char(64), `contenido_md` con el encabezado mínimo de
    contracts/encabezados-markdown.md, `fecha_acceso`, `metadatos_gmas`) y la deja como
    `version_pendiente_id`; un elemento nuevo queda `pendiente_aprobacion`;
  - si el informe es `completa=true`: elimina un vinculado solo si **todos** sus GT-P de
    origen aparecen en el informe con `resultado != error` y ninguno lo lista en
    `gmas.vinculados` (borra sus puntos, notifica `fuera_de_alcance`, audita). Si algún
    padre dio error, el vinculado se conserva. Además emite `procedimiento_faltante` por
    cada uno de los 6 GT-P ausentes.
  (RF-C3-IV-01, RF-C3-IV-04, RF-C3-IV-11; FR-017; contrato regla 7)
- [X] T038 [US1] Implementar en `backend/src/kb/service.ts`:
  - `publicar(claves | todosPendientes, actor)`: indexa la versión pendiente, después borra
    los puntos y la fila de la versión publicada anterior, mueve `version_publicada_id`,
    pone `estado='publicado'` y audita. **No** modifica `fecha_carga`;
  - `listarPendientes()`;
  - `auditarAlcance()`: puntos sin fila, filas publicadas sin puntos, elementos que no
    cumplen `esDelAlcance`, número de filas = elementos;
  - `recalcularDirecciones(actor)`: vuelve a aplicar `direccionPara` a todos los elementos,
    actualiza `direccion` en Qdrant con `set_payload` filtrado por `elemento_id` y audita.
  Exponerlos en `backend/src/kb/cli.ts` como `sincronizar`, `pendientes`, `publicar`,
  `auditar-alcance` y `recalcular-direcciones` (RF-C3-IV-01, RF-C3-IV-11; FR-005, FR-017;
  R2, R4, R11).
- [X] T039 [US1] Hacer que `backend/src/kb/worker.ts` procese los informes de
  `/app/data/runs/*.json` (ignorando `.tmp`) en orden de `iniciada_en`:
  - vigila el directorio con `fs.watch` para procesar un informe en cuanto aparece como
    `.json`, y además sondea cada `kbSondeoMs` como respaldo;
  - mueve cada informe procesado a `/app/data/runs/procesados/`;
  - mueve un informe inválido a `/app/data/runs/rechazados/` y notifica
    `verificacion_fallida` con el nombre del archivo.
  (RF-C3-IV-02, RF-C3-IV-03; R5)

**Checkpoint**: la base acotada está cargada, publicada y auditada; el chat responde solo
con contenido de la matriz (MVP).

---

## Phase 4: User Story 2 - Contenido fiel: fichas, páginas, tablas y formatos en blanco (Priority: P1)

**Goal**: fichas con 10 campos, páginas con URL, fecha de acceso y huella estable, tablas de
GMAS2 íntegras y formatos sin datos personales (RF-C3-IV-05, IV-06, IV-09, IV-10;
FR-007 a FR-010).

**Independent Test**: `kb exportar-fichas` y comparación con GMAS2 de las tablas de GT-P-004
y GT-P-021. Una copia diligenciada de GT-F-011 queda rechazada (quickstart §3).

### Tests for User Story 2

- [X] T040 [P] [US2] Prueba `web_scraper/tests/test_gmas2_tables.py` con las fixtures de
  GT-P-004 y GT-P-021:
  - la tabla "Flujos de trabajo y actividades" de GT-P-004 sale como una tabla Markdown con
    las columnas `No | DESCRIPCIÓN | RESPONSABLE | TIEMPO` y las filas 1 a 5 (p. ej. la
    fila 2 con responsable "Profesionales Universitarios, Técnico Operativo" y tiempo
    "20 días");
  - ninguna celda contiene `| --- |`;
  - no aparecen "Cargando...", "Vista Completa", "Acordeón" ni "Pestañas";
  - las columnas `tipoRegistro` y `Acciones` no aparecen.
  (RF-C3-IV-09)
- [X] T041 [P] [US2] Prueba `web_scraper/tests/test_page_hash.py`:
  - la misma página renderizada dos veces con distinto ruido dinámico ("Cargando...", fecha
    del pie) produce el mismo `hash_contenido`;
  - un cambio en un párrafo produce otro hash.
  (RF-C3-IV-06; SC-013)
- [X] T042 [P] [US2] Prueba `backend/test/kb-fichas.test.ts`:
  - la ficha de GT-P-004 tiene exactamente los 10 campos del contrato, con
    `formatos_vinculados` ⊇ [GT-F-011, GT-F-012, MG-F-002, MG-F-051] y las normas
    clasificadas por `-N-`;
  - una lista vacía se escribe `[]`;
  - la página tiene `url_origen`, `fecha_acceso` y `hash_contenido`, y este coincide con
    `kb_version.hash_contenido`;
  - cambiar `fecha_acceso` no cambia el hash.
  (RF-C3-IV-05, RF-C3-IV-06; SC-003, SC-013)
- [X] T043 [P] [US2] Prueba `backend/test/kb-blank-forms.test.ts` con textos fixture en
  `backend/test/fixtures/formatos/`:
  - el texto real extraído de GT-F-011 está en blanco;
  - copias con `NOMBRE: Juan Pérez`, `CÉDULA: 1036123456`, un correo y un teléfono se
    rechazan;
  - etiquetas seguidas de `____`, `....` o espacios no se rechazan.
  (RF-C3-IV-10)

### Implementation for User Story 2

- [X] T044 [US2] Implementar en `web_scraper/scraper/html_parser.py` una normalización previa
  a `markdownify`, solo para el contenido de `#area` de GMAS2:
  - unir `.ui-jqgrid-htable` y `.ui-jqgrid-btable` en una `<table>` con `<thead>` y
    `<tbody>`;
  - descartar las columnas ocultas (`display:none`) y las técnicas (`tipoRegistro`,
    `Acciones`, el contador `Ítem` cuando vale 0);
  - desenvolver las tablas de maquetación que contienen otra tabla;
  - eliminar "Cargando...", "Vista Completa", "Acordeón", "Pestañas" y las anclas `#tab-*`.
  Ajustar los selectores a lo observado en las fixtures de T008 (RF-C3-IV-09; R8).
- [X] T045 [US2] Calcular `content_hash` en `web_scraper/scraper/html_parser.py` sobre el
  texto normalizado **después** de eliminar el ruido de T044, y propagarlo a
  `Enlace.hash_contenido` (RF-C3-IV-06; regla 4 del contrato de corrida).
- [X] T046 [P] [US2] Crear `backend/src/kb/fichas.ts`:
  - `fichaProcedimiento(version, elemento)`: encabezado YAML con los 10 campos en el orden
    del contrato; listas desde `metadatos_gmas.vinculados`, clasificadas por letra de tipo;
    `MG-P` excluido de ambas listas; listas vacías como `[]`;
  - `encabezadoPagina(version)`: `url_origen`, `fecha_acceso`, `hash_contenido` y `titulo`;
  - `encabezadoMinimo()` para formatos, normas y documentos.
  El hash se calcula solo sobre el cuerpo (RF-C3-IV-05, RF-C3-IV-06).
- [X] T047 [P] [US2] Crear `backend/src/kb/blankForms.ts` con
  `formatoEnBlanco(texto): { enBlanco: boolean, motivos: string[] }`:
  - patrones de `backend/src/services/pii.ts` (cédula, teléfono, correo);
  - etiquetas NOMBRE, CÉDULA, DIRECCIÓN, TELÉFONO, CELULAR, CORREO, FIRMA y BARRIO seguidas
    en la misma línea de un valor que no sea vacío, `_`, `.` ni espacios.
  (RF-C3-IV-10; R12)
- [X] T048 [US2] Integrar en `backend/src/kb/sync.ts`:
  - usar `fichaProcedimiento` para los elementos `procedimiento` y `encabezadoPagina` para
    `pagina` al crear `kb_version.contenido_md`;
  - para `formato`, aplicar `formatoEnBlanco` al texto convertido; si no está en blanco,
    registrar `decision='formato_diligenciado'`, no crear versión publicable y notificar
    `formato_con_datos_personales` con el código.
  `publicar()` debe rechazar un `formato` cuya versión no tenga `decision = cargado`
  (RF-C3-IV-05, RF-C3-IV-06, RF-C3-IV-10).
- [X] T049 [US2] Agregar a `backend/src/kb/service.ts` y `backend/src/kb/cli.ts` el comando
  `exportar-fichas [--salida <dir>]`, que escribe un `.md` por ficha y por página publicada
  (nombre = código o slug de la URL) en `/app/var/exports/fichas/` por defecto, y audita
  (RF-C3-IV-05, RF-C3-IV-06).
- [X] T050 [US2] Revisión manual del 100 % de los formatos cargados (GT-F y MG-F):
  - obtener la lista con `make kb CMD="exportar-matriz"` filtrando `Tipo = Formato`;
  - abrir cada archivo original y verificar que nombres, documentos de identidad,
    direcciones, teléfonos, correos y firmas estén vacíos;
  - registrar código, revisor, fecha y resultado en
    `specs/001-base-conocimiento-bloque1/evidencias/formatos-revision.md`.
  (RF-C3-IV-10; SC-005)

**Checkpoint**: las fichas y las páginas son fieles al original y verificables contra GMAS2.

---

## Phase 5: User Story 3 - Documentos escaneados confiables (Priority: P2)

**Goal**: OCR solo cuando corresponde (menos de 80 caracteres nativos o imagen); se carga solo
lo que supera el 80 % de confianza media, y cada descarte queda registrado y notificado
(RF-C3-IV-07, IV-08; FR-011 a FR-013).

**Independent Test**: suite `kb-ocr` con fixtures y `sincronizar --completa --medir` sobre el
lote real. Cargados + descartados = total (quickstart §4).

### Tests for User Story 3

- [X] T051 [P] [US3] Crear las fixtures en `backend/test/fixtures/ocr/`:
  - `escaneo-legible.pdf` (1 página, texto impreso a 300 dpi);
  - `escaneo-ilegible.pdf` (ruido o manuscrito);
  - `nativo-79.pdf` y `nativo-80.pdf` (exactamente 79 y 80 caracteres no blancos);
  - `docx-escaneado.docx` (solo una imagen con texto);
  - `imagen.png`.
  Documentar en `backend/test/fixtures/ocr/README.md` cómo se generaron (RF-C3-IV-07,
  RF-C3-IV-08).
- [X] T052 [P] [US3] Prueba `backend/test/kb-ocr.test.ts`:
  - `nativo-79.pdf` pasa por OCR y `nativo-80.pdf` no;
  - `imagen.png` y `docx-escaneado.docx` pasan por OCR;
  - XLSX y DOC nunca;
  - `escaneo-legible.pdf` queda `cargado` con confianza > 80;
  - `escaneo-ilegible.pdf` queda `descartado_ocr` con confianza ≤ 80;
  - un PDF de ≥ 80 caracteres con texto basura queda `cargado` con
    `calidad_nativa_baja=true`;
  - la confianza se calcula como la media por palabra con `conf >= 0` (TSV sintético).
  (RF-C3-IV-07, RF-C3-IV-08)
- [X] T053 [P] [US3] Prueba de integración
  `backend/test/kb-integracion/descarte-ocr.test.ts`:
  - un informe con un PDF ilegible genera una fila en `kb_procesamiento` (código o URL,
    `confianza_ocr`, `fecha`), una notificación `descarte_ocr` y ningún elemento
    publicable;
  - si el elemento ya estaba publicado, sigue sirviendo su versión anterior.
  (RF-C3-IV-07; SC-006)

### Implementation for User Story 3

- [X] T054 [P] [US3] Crear `backend/src/kb/ocr.ts`:
  - `ocrPdf(ruta)`: `pdftoppm -r 300 -png` a un directorio temporal y `tesseract <img> <out>
    -l spa+eng txt tsv` por página;
  - `ocrDocx(ruta)`: extrae `word/media/*` del ZIP;
  - `ocrImagen(ruta)`;
  - devuelven `{ texto, confianzaMedia }`. La confianza es la media de `conf` de las palabras
    con `conf >= 0`; sin palabras, 0. Los temporales se borran en `finally`. Timeout por
    página: 120 s.
  (RF-C3-IV-07; R6)
- [X] T055 [US3] Completar la decisión de OCR en `backend/src/kb/conversion.ts`:
  - contar los caracteres nativos sin blancos ni separadores `-- N of M --` sobre el
    documento completo;
  - PDF o DOCX con menos de 80 → OCR; imágenes (`.png`, `.jpg`, `.jpeg`, `.tif`, `.tiff`)
    → OCR siempre; el resto nunca;
  - si se aplicó OCR y `confianzaMedia <= setting('ocrMinConfidence')`, la decisión es
    `descartado_ocr`;
  - con ≥ 80 caracteres y `looksLikeGarbage`, `calidad_nativa_baja=true` y notificación
    `texto_nativo_ilegible`;
  - registrar `confianza_ocr` en `kb_procesamiento`.
  (RF-C3-IV-07, RF-C3-IV-08; R7)
- [X] T056 [US3] Integrar en `backend/src/kb/sync.ts`: con la decisión `descartado_ocr` no se
  crea versión pendiente y se notifica `descarte_ocr`, con objeto = código o URL y la
  confianza en la descripción. La versión publicada previa, si existe, se mantiene
  (RF-C3-IV-07).
- [X] T057 [US3] Retirar de `backend/src/services/documentPreprocessor.ts` el camino
  `ocrmypdf` (`runOcr`, `alternateOcrArgs`, `extractPdf` con OCR y el respaldo que indexa
  texto nativo que no pasó el control). Dejar solo la extracción nativa y `looksLikeGarbage`
  como señal. Quitar `ocrmypdf` y `unpaper` de `backend/Dockerfile` y del job `imagen` de
  `.github/workflows/ci.yml`, y agregar la verificación de `pdftoppm`. Ajustar
  `backend/test/garbage-detection.test.ts` (RF-C3-IV-07; R6).
- [X] T058 [P] [US3] En `web_scraper/scraper/utils.py` y `web_scraper/scraper/downloader.py`,
  permitir `.png`, `.jpg`, `.jpeg`, `.tif` y `.tiff` como documentos **solo** cuando llegan
  como enlace explícito (`<a href>`) del contenido principal de GMAS2 o del Observatorio,
  nunca desde `<img>`. Agregar `CATEGORY_BY_EXTENSION → "imagen"`. Agregar la prueba en
  `web_scraper/tests/test_scraper.py` (RF-C3-IV-08).

**Checkpoint**: ningún escaneo ilegible entra a la base y cada descarte es visible para el
administrador.

---

## Phase 6: User Story 4 - Vigilancia automática de las fuentes (Priority: P2)

**Goal**: verificación cada ≤ 7 días sin intervención; derogados marcados y excluidos; fallas
notificadas sin perder la versión validada; cambios en pendiente (RF-C3-IV-02, IV-03, IV-04;
FR-014 a FR-017).

**Independent Test**: dos ciclos programados en intervalo corto; derogado de prueba; host
caído; página alterada (quickstart §5).

### Tests for User Story 4

- [X] T059 [P] [US4] Prueba `web_scraper/tests/test_derogado.py` con la fixture "Derogado":
  el enlace queda en el informe con `estado_detectado="derogado"`, sin `archivo`, sin
  descargas y sin hijos encolados (RF-C3-IV-03; R10).
- [X] T060 [P] [US4] Prueba `web_scraper/tests/test_estructura.py`:
  - una página GMAS2 sin `.estado` o sin código produce `resultado="error"` con
    `tipo="estructura_modificada"`;
  - una página con contenido útil < 30 % de la extracción previa produce el mismo error;
  - un HTTP 503 produce `tipo="http"` y `codigo_http=503`;
  - en los tres casos el archivo previo en disco no se modifica;
  - una URL conocida de `MetadataStore` que no se visitó aparece con
    `detalle="no alcanzado"`.
  (RF-C3-IV-04)
- [X] T061 [P] [US4] Prueba de integración `backend/test/kb-integracion/vigilancia.test.ts`:
  - **derogado**: un elemento publicado con `estado_detectado=derogado` queda `derogado`,
    con `derogado_en`, 0 puntos y notificación `documento_derogado`; si es un GT-P, sus
    vinculados sin otro GT-P vigente salen con `fuera_de_alcance`;
  - **error**: un enlace con error notifica `verificacion_fallida` (objeto = URL, tipo de
    error) y la búsqueda sigue devolviendo la versión publicada;
  - **padre con error**: GT-P-004 con `resultado=error` en un informe completo deja sus
    vinculados publicados, con 0 notificaciones `fuera_de_alcance` y una sola
    `verificacion_fallida`;
  - **cambio**: `cambio_detectado` deja `version_pendiente_id` sin tocar la publicada;
  - **agrupación**: dos errores seguidos del mismo enlace dan una sola notificación con
    `repeticiones=2`;
  - **vigilante**: sin corrida programada en más de 7 días se emite
    `verificacion_atrasada`;
  - **registro**: cada enlace del informe genera una fila en `kb_verificacion`.
  (RF-C3-IV-02, RF-C3-IV-03, RF-C3-IV-04; SC-007, SC-008)

### Implementation for User Story 4

- [X] T062 [US4] En `web_scraper/scraper/crawler.py` y `web_scraper/scraper/html_parser.py`,
  reemplazar el descarte silencioso de `require_selector_text`. Una página con estado
  distinto de "Vigente" se registra en el informe con `estado_detectado="derogado"`, sin
  guardar el Markdown, sin descargar y sin seguir enlaces (RF-C3-IV-03; R10).
- [X] T063 [US4] Implementar en `web_scraper/scraper/crawler.py` la detección de error sin
  pérdida:
  - inaccesible, timeout o HTTP ≥ 400 → `resultado="error"` con el tipo de error;
  - GMAS2 sin código, estado o tabla de cabecera → `estructura_modificada`;
  - página cuyo contenido útil cae por debajo de `KB_UMBRAL_ESTRUCTURA` (0,3) del tamaño
    previo de esa URL (guardado en `MetadataStore`) → `estructura_modificada`.
  En todos los casos **no** se escribe ni sobrescribe el archivo y `archivo=null`. Corregir
  la rama `existing_url_path` de `_save_page`, que hoy sobrescribe (RF-C3-IV-04;
  diagnóstico).
- [X] T064 [P] [US4] Programar el scraper:
  - crear `web_scraper/scraper/cron_check.py`, que rechaza un `SCRAPER_CRON` cuyo campo de
    día del mes o de mes no sea `*` (solo así se garantiza como máximo 7 días entre
    corridas), con prueba en `web_scraper/tests/test_cron_check.py`;
  - crear `web_scraper/entrypoint.sh`, que valida con `cron_check.py`, genera
    `/tmp/crontab` desde `SCRAPER_CRON` (por defecto `0 2 * * 0`, `TZ=America/Bogota`) con
    `python main.py --output /data` y ejecuta `supercronic /tmp/crontab`;
  - en `web_scraper/Dockerfile`, instalar supercronic (versión fijada con checksum SHA-1) y
    usar `entrypoint.sh` como `ENTRYPOINT`;
  - en `docker-compose.yml`, el servicio `scraper` sale del profile `setup` y queda con
    `restart: unless-stopped`.
  (RF-C3-IV-02; R5)
- [X] T065 [US4] Extender `backend/src/kb/sync.ts`:
  - registrar en `kb_verificacion` cada enlace del informe (`url`, `elemento_id`,
    `fecha_hora`, `estado_detectado`, `resultado`, `tipo_error`, `codigo_http`,
    `hash_contenido`);
  - **derogado** → `estado='derogado'`, `derogado_en=now()`, `borrarPuntosElemento`,
    notificar `documento_derogado` (documento, fecha y hora);
  - si el derogado es un GT-P, quitar su código de `procedimientos_origen` de sus vinculados
    y eliminar con `fuera_de_alcance` los que queden sin origen;
  - **error** → notificar `verificacion_fallida` y no tocar versiones;
  - **derogado que vuelve a vigente** → `pendiente_aprobacion`.
  (RF-C3-IV-02, RF-C3-IV-03, RF-C3-IV-04; data-model transiciones)
- [X] T066 [US4] Implementar el vigilante en `backend/src/kb/worker.ts`: en cada ciclo, si
  `max(kb_corrida.terminada_en) where programada` tiene más de 7 días (o no hay ninguna
  pasadas 7 días desde la primera migración), notificar `verificacion_atrasada`
  (RF-C3-IV-02; R5).
- [X] T067 [US4] Agregar a `backend/src/kb/service.ts` y `backend/src/kb/cli.ts` los
  comandos `notificaciones [--todas] [--json]` y `revisar <id>`, que llaman a
  `notifications.marcarRevisada` y auditan (RF-C3-IV-03, RF-C3-IV-04, RF-C3-IV-07;
  FR-018).

**Checkpoint**: la base se vigila sola cada semana y las fallas no degradan las respuestas.

---

## Phase 7: User Story 5 - Reindexación sin interrupción y en tiempo acotado (Priority: P3)

**Goal**: la reindexación completa no corta el chat, un fallo nunca deja resultados parciales
y la ingesta completa termina en menos de 2 h (RNF-C3-IV-01, IV-02; NFR-001, NFR-002).

**Independent Test**: sonda de una consulta cada 30 s durante `sincronizar --completa`, con y
sin fallo forzado (quickstart §6).

### Tests for User Story 5

- [X] T068 [P] [US5] Prueba de integración `backend/test/kb-integracion/reindexacion.test.ts`:
  - durante `reconstruirColeccion()`, consultas concurrentes cada 200 ms responden siempre
    sin error y con resultados completos;
  - al terminar, el alias apunta a la colección nueva y la anterior ya no existe;
  - con `KB_FALLO_FORZADO_EN=50%` (solo en `NODE_ENV=test`), la indexación queda `fallida`,
    el alias sigue en la anterior, la colección nueva se borra y se notifica
    `indexacion_fallida`;
  - un segundo inicio con una indexación `en_curso` se rechaza (índice único parcial).
  (RNF-C3-IV-02; SC-009)

### Implementation for User Story 5

- [X] T069 [US5] Implementar `reconstruirColeccion({ medir })` en `backend/src/kb/indexer.ts`:
  - insertar `kb_indexacion` (`tipo='completa'`, `estado='en_curso'`);
  - crear `kb_chunks_<marca>` y calcular `avgdl` sobre las versiones publicadas;
  - indexar todas las versiones publicadas;
  - verificar `puntos_indexados = puntos_esperados`;
  - `update_aliases` atómico y borrar la colección anterior;
  - marcar `terminada`.
  Ante cualquier error, borrar la colección nueva, marcar `fallida` y notificar. Con
  `medir`, reconvertir desde los archivos (conversión y OCR de US3) y guardar
  `duracion_etapas_ms` `{conversion, ocr, embeddings, indexacion}` (RNF-C3-IV-01,
  RNF-C3-IV-02; R4, R19).
- [X] T070 [US5] Exponer en `backend/src/kb/cli.ts` el comando
  `sincronizar --completa [--medir]` y auditarlo. Cuando la publicación incremental es
  masiva (`publicar --todos-pendientes` con más de 50 elementos), delegar en
  `reconstruirColeccion()` para que el cambio sea atómico (RNF-C3-IV-02).
- [X] T071 [P] [US5] Crear `backend/scripts/sonda-chat.sh <segundos>`: envía cada N segundos
  una consulta fija a `/api/chat` con el flujo de sesión actual y registra la hora, el
  código HTTP y la latencia en `stdout`. Lo usan quickstart §6 y la medición de
  RNF-C3-IV-02 (RNF-C3-IV-02).

**Checkpoint**: reindexar es una operación segura en horario de servicio.

---

## Phase 8: User Story 6 - Exportación de la matriz y retención de registros (Priority: P3)

**Goal**: matriz exportable a .xlsx y registros conservados durante al menos 12 meses
(RF-C3-IV-12, RNF-C3-IV-03; FR-006, FR-019).

**Independent Test**: el .xlsx abre en Excel y en LibreOffice con 12 columnas; las filas de 11
meses siguen tras la purga (quickstart §2 y §7).

### Tests for User Story 6

- [X] T072 [P] [US6] Prueba `backend/test/kb-export.test.ts`:
  - el .xlsx generado tiene una hoja `Matriz documental` con las 12 columnas en el orden y
    con los nombres de [contracts/matriz-xlsx.md](./contracts/matriz-xlsx.md);
  - número de filas = elementos;
  - "N/A" solo en las columnas 1, 7 y 8, y solo en filas del contenido del Observatorio;
  - la columna 12 de esas filas lleva el nombre de la fuente;
  - la columna 11 nunca está vacía;
  - una celda que empieza por `=` sale con apóstrofo;
  - fechas en `America/Bogota`.
  (RF-C3-IV-11, RF-C3-IV-12; SC-011)
- [X] T073 [P] [US6] Prueba de integración `backend/test/kb-integracion/retencion.test.ts`:
  - con filas sembradas de 11 y 14 meses en `kb_verificacion`, `kb_procesamiento` y
    `kb_notificacion` (revisadas y no revisadas), `purgarRetencion()` conserva las de 11
    meses, borra las de 14 revisadas y **nunca** las no revisadas;
  - registra la ejecución en `kb_purga` con el conteo por tabla;
  - `KB_RETENCION_MESES=11` se recorta a 12 con aviso y la purga respeta 12 meses.
  (RNF-C3-IV-03; SC-012)

### Implementation for User Story 6

- [X] T074 [P] [US6] Crear `backend/src/kb/exportMatrix.ts` con `exportarMatriz(salida?)`:
  - lee `kb.v_matriz`;
  - genera con `xlsx` (SheetJS) la hoja `Matriz documental` con los encabezados del
    contrato;
  - antepone `'` a las celdas que empiezan por `=`, `+`, `-` o `@`;
  - escribe `/app/var/exports/matriz-documental-<yyyy-mm-dd>.xlsx`.
  Exponerlo como `exportar-matriz` en `backend/src/kb/cli.ts` con auditoría (RF-C3-IV-12).
- [X] T075 [P] [US6] Crear `backend/src/kb/retention.ts` con `purgarRetencion()`:
  - borra las filas de `kb_verificacion` y `kb_procesamiento` con fecha anterior a
    `now() - kbRetencionMeses`;
  - borra solo las `kb_notificacion` con `estado='revisada'` y `revisada_en` anterior a esa
    fecha;
  - borra los archivos de `/app/data/runs/procesados/` y `/app/data/runs/rechazados/`
    (volumen `geobot-runs`) anteriores a la misma fecha;
  - inserta `kb_purga`.
  (RNF-C3-IV-03; R14)
- [X] T076 [US6] En `backend/src/kb/worker.ts`, ejecutar `purgarRetencion()` una vez al día
  (marca de la última ejecución en `kb_purga`) y exponer `purgar-retencion` en
  `backend/src/kb/cli.ts` (RNF-C3-IV-03).

**Checkpoint**: las seis historias funcionan; la base es exportable y sus registros
auditables durante 12 meses.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [X] T077 Comparar la recuperación:
  - `npm run eval:retrieval -- --golden test/fixtures/golden-set-acotado.json --baseline
    test/fixtures/baseline-acotado.json` con Qdrant;
  - bloquear el cierre si recall@8 baja más de 2 puntos;
  - registrar el resultado en `specs/001-base-conocimiento-bloque1/quickstart.md` §8.
  (RF-C3-IV-01, RNF-C3-IV-01; R17)
- [X] T078 [P] Guarda de no regresión de la latencia del chat tras migrar la búsqueda: adaptar
  `backend/scripts/bench-stages.ts` a Qdrant, medir con `npm run bench:stages` y documentar
  en `docs/arquitectura-sistema.md` la comparación con la medición previa (~350 ms por
  consulta de recuperación). La medición formal es del bloque 5 (RNF-C3-IN-02, p95 ≤ 20 s).
- [X] T079 [P] Actualizar `README.md`:
  - servicios `postgres`, `qdrant`, `kb-worker` y el scraper programado;
  - volúmenes `geobot-pg`, `geobot-qdrant` y `geobot-runs`;
  - flujo `make scrape` → `make kb CMD="sincronizar"` → `publicar`;
  - eliminación de `make cache`;
  - variables nuevas;
  - advertencia de no usar `docker compose down -v`, extendida a los volúmenes nuevos.
  (RNF-C3-IV-01, RNF-C3-IV-02, RF-C3-IV-02; Gobernanza, guía operativa)
- [X] T080 [P] Actualizar `docs/arquitectura-sistema.md`: diagramas de componentes y de flujo
  con el informe de corrida, el `kb-worker`, PostgreSQL, Qdrant con alias y la CLI; quitar
  el índice en memoria y el snapshot (RNF-C3-IV-01, RNF-C3-IV-02; Gobernanza, guía
  operativa).
- [X] T081 [P] Revisión de seguridad:
  - verificar que `postgres` y `qdrant` no publican puertos en `docker-compose.yml`;
  - verificar que `app_reader` solo puede leer `kb.v_codigos_publicados` (prueba en
    `backend/test/kb-integracion/permisos.test.ts`);
  - verificar que ninguna descripción de notificación ni fila de auditoría contiene rutas
    absolutas o datos personales (búsqueda por patrón en la misma prueba).
  (RF-C3-IV-10, RF-C3-IV-11; principios IV y VII)
- [ ] T082 Ejecutar la validación completa de [quickstart.md](./quickstart.md) §1–§8 en un
  entorno limpio y dejar la evidencia (salidas de comandos y capturas del .xlsx) en
  `specs/001-base-conocimiento-bloque1/evidencias/` (RF-C3-IV-01 a IV-12, RNF-C3-IV-01 a
  IV-03; SC-001 a SC-013).
- [ ] T083 Medir RNF-C3-IV-01 tres veces en el entorno de producción definido en C6 con
  `make kb CMD="sincronizar --completa --medir"` y registrar las tres duraciones (deben
  ser menores de 2 h) en `specs/001-base-conocimiento-bloque1/evidencias/rnf-c3-iv-01.md`
  (RNF-C3-IV-01; SC-010).
- [X] T084 Documentar en `specs/001-base-conocimiento-bloque1/evidencias/limpieza-corpus.md`
  la limpieza opcional de las carpetas `concejo_envigado/`, `minambiente/` y
  `minagricultura/` del volumen de datos, una vez confirmado con `kb auditar-alcance` que
  la colección servida no las contiene (RF-C3-IV-01, FR-002; R16).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sin dependencias.
- **Foundational (Phase 2)**: depende de Setup y **bloquea todas las historias**.
  - T008 (fixtures) antes de las pruebas del scraper y de T010 (hosts canónicos).
  - **T009 (confirmación del mapa) antes de T010.**
  - T011 → T012 → T020.
  - T017 y T018 → T019 → T022 y T025.
  - **T021 (re-base del conjunto de oro) debe completarse antes de T022**: mide con el índice
    en memoria.
- **US1 (Phase 3)**: depende de Foundational. Es la base de las demás historias, porque
  introduce `sync.ts`, `scope.ts`, `conversion.ts` y `publicar()`.
- **US2 (Phase 4)**: depende de US1 (T037, T038); extiende `sync.ts`. T050 (revisión manual)
  requiere T048 y T074 (exportación); si US6 no está, se usa `kb pendientes --json`.
- **US3 (Phase 5)**: depende de US1 (T036); extiende `conversion.ts` y `sync.ts`.
- **US4 (Phase 6)**: depende de US1 (T034, T037). Es independiente de US2, US3, US5 y US6.
- **US5 (Phase 7)**: depende de Foundational (T019) y de US1 (T038); usa la conversión de US3
  solo con `--medir`.
- **US6 (Phase 8)**: depende de US1 para la exportación (`v_matriz` con datos). La retención
  depende solo de Foundational.
- **Polish (Phase 9)**: depende de las historias que se entreguen.

### User Story Dependencies

```text
Setup → Foundational → US1 ─┬─► US2
                            ├─► US3 ──► (US5 --medir)
                            ├─► US4
                            ├─► US5
                            └─► US6
```

- Después de US1, las historias US2 a US6 pueden avanzar en paralelo, salvo los archivos
  compartidos:
  - `backend/src/kb/sync.ts`: T048, T056 y T065, en ese orden si se trabajan a la vez;
  - `backend/src/kb/cli.ts` y `backend/src/kb/service.ts`.
- **Cambio de comportamiento entre historias**: T070 (US5) modifica el comportamiento de
  `publicar --todos-pendientes` implementado en T038 (US1). Antes de US5, la publicación
  masiva es incremental, sin cambio de alias.

### Within Each User Story

- Las pruebas se escriben primero y deben fallar antes de implementar (principio X).
- Primero la adquisición (Python) y el contrato, después la sincronización (TypeScript) y
  por último la CLI.
- La historia queda cerrada cuando pasa su checkpoint.

### Parallel Opportunities

- **Setup**: T002 a T007 en paralelo.
- **Foundational**: T013 a T018 en paralelo, tras T012 para las que tocan la base de datos.
- **Pruebas [P] de cada historia**: en paralelo entre sí.
- **US2**: T046 y T047 en paralelo. **US3**: T054 y T058. **US6**: T074 y T075.
- **Polish**: T078 a T081 en paralelo.

---

## Parallel Example: User Story 1

```bash
# Pruebas de US1 en paralelo:
Task: "T026 Prueba web_scraper/tests/test_sources_scope.py"
Task: "T027 Prueba web_scraper/tests/test_gmas2_crawl.py"
Task: "T028 Prueba backend/test/kb-scope.test.ts"
Task: "T029 Prueba de integración backend/test/kb-integracion/sincronizar.test.ts"

# Implementación en paralelo (archivos distintos):
Task: "T030 Fuentes acotadas en web_scraper/scraper/sources.py"
Task: "T033 Metadatos GMAS2 en web_scraper/scraper/gmas2.py"
```

## Parallel Example: User Story 2

```bash
Task: "T040 Prueba web_scraper/tests/test_gmas2_tables.py"
Task: "T042 Prueba backend/test/kb-fichas.test.ts"
Task: "T043 Prueba backend/test/kb-blank-forms.test.ts"
Task: "T046 Fichas en backend/src/kb/fichas.ts"
Task: "T047 Control de formatos en backend/src/kb/blankForms.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 (Setup) y Phase 2 (Foundational), incluidos la confirmación del mapa (T009) y el
   re-base del conjunto de oro (T021) antes de migrar la búsqueda.
2. Phase 3 (US1): base acotada, matriz, publicación y auditoría de alcance.
3. **Detenerse y validar**: quickstart §1–§2 y `eval:retrieval` (T077 adelantado).
4. Promover `develop` → `prod_test` para la revisión con las Direcciones (hito H1-C3 /
   H3-C3 parcial).

### Incremental Delivery

1. **US1 + US2** (ambas P1): base cerrada y fiel. Se puede firmar la matriz documental y las
   fichas.
2. **US3 + US4** (P2): OCR confiable y vigilancia semanal. Desde aquí la base se mantiene
   sola.
3. **US5 + US6** (P3): reindexación sin corte, exportación y retención. Cierra
   RNF-C3-IV-01 a IV-03.
4. **Polish**: medición en producción (C6) y evidencias para el acta.

### Notas

- [P] = archivos distintos y sin dependencias pendientes.
- Hacer un commit por tarea o grupo lógico en `develop`, sin líneas de coautoría.
- Las tareas que dependen de algo externo son T009 (confirmación del mapa, bloquea
  Foundational), T050 (revisión manual de formatos) y T083 (entorno de producción C6, cierre
  del hito).

---

## Phase 10: Convergence

- [X] T085 Confirmar con el Líder de Proyecto la dirección de las cuatro secciones del Observatorio asignadas por analogía (`/fauna-domestica` → Bienestar Animal; `/fauna-silvestre`, `/monitoreo-de-biodiversidad` y `/recurso-hidrico` → Ecosistemas) en `backend/config/base-conocimiento.json`; si cambia alguna, corregir el JSON y correr `kb recalcular-direcciones`; dejar la confirmación en `research.md` R11 per FR-004 (partial)
- [X] T086 Hacer revisar por una persona las 14 preguntas factuales de `backend/test/fixtures/golden-set-acotado.json` (pregunta, URL de origen esperada y su vigencia) antes de ejecutar T077, y registrar el revisor y la fecha en `quickstart.md` §8, para que la guarda de no regresión de recall@8 no se apoye en casos sin validar per RF-C3-IV-01 / T021 (partial)

## Phase 11: Convergence

- [X] T087 Corregir el healthcheck del servicio `kb-worker` en `docker-compose.yml`: hereda el `HEALTHCHECK` del backend (`http://127.0.0.1:4000/health`) y el worker no atiende HTTP, así que aparece `unhealthy` (más de 300 fallos seguidos). Reemplazarlo por una comprobación propia (p. ej. latido reciente en la base o archivo de vida) o desactivarlo explícitamente, para que Dokploy no marque el servicio de vigilancia como caído per plan: servicio `kb-worker` / RNF-C3-IV-02 (partial)
- [X] T088 Hacer idempotente el registro de `kb_procesamiento` por corrida y elemento (índice único o upsert) y depurar las filas duplicadas que dejó el doble procesamiento watcher + `kb sincronizar` (hallazgo 2 de `evidencias/quickstart/RESULTADO.md`), con prueba de integración que procese dos veces el mismo informe y verifique que cargados + descartados = total del lote per FR-012 / FR-013 / SC-006 (partial)
- [X] T089 Corregir `quickstart.md` §1 (línea 20: "alias todavía sin colección", pues el `kb-worker` crea la colección vacía al arrancar) y dejar en `quickstart.md` §6 la aclaración de `KB_FALLO_FORZADO_EN` solo con `NODE_ENV=test` en el kb-worker, según los hallazgos 3 y de §1 de `RESULTADO.md` per plan: quickstart de validación por criterio de éxito (partial)
- [X] T090 Revisar y justificar o retirar el código muerto del Concejo en el scraper (`CONCEJO_FOLDER_BY_TYPE`, `infer_concejo_document_type`, `concejo_folder_for_type` en `web_scraper/scraper/relevance.py` y su rama `document_folder_mode == "document_type"` en `web_scraper/scraper/crawler.py`), ya que ninguna fuente autorizada lo usa, y ajustar `web_scraper/tests/test_scraper.py` per FR-002 / plan: sources sin concejo y ministerios (unrequested)
- [X] T091 Registrar a qué requisito o spec responden `backend/src/services/alerts.ts` (webhook `ALERT_WEBHOOK_URL`), `backend/src/services/circuitBreaker.ts` y `frontend/shared/chatErrors.ts`, que no figuran en spec, plan ni tareas de este bloque; si pertenecen a otro bloque, sacarlos de esta rama o citar su RF/RNF, y confirmar que el webhook no transporta las notificaciones del kb (FR-018 / Constitución VI) per Constitution IX (unrequested)

## Phase 12: Convergence

- [X] T092 CRITICAL: Retirar el webhook `ALERT_WEBHOOK_URL` de `backend/src/services/alerts.ts` (invocado desde `backend/src/index.ts`, `retrievalClient.ts` y `chatTraffic.ts` para `retrieval_degraded`, `daily_quota`, `index_unavailable`), de modo que las degradaciones solo se notifiquen en el panel, o dejar por escrito en `evidencias/alcance-adicional.md` la decisión del Líder de Proyecto de enmendar la Constitución VI (hoy el canal sigue activo con la variable definida y la decisión quedó como "si el Líder lo considera") per Constitution VI (contradicts)

## Phase 13: Convergence

- [X] T093 Incluir en el alcance de T092 el cuarto punto de emisión del webhook, `backend/src/services/processGuards.ts` (importa `notifyOps` de `services/alerts.ts`), y verificar con `grep -rn "notifyOps\|ALERT_WEBHOOK_URL" backend/src .env.example backend/test` que, al cerrar T092, no queda ningún emisor ni variable `ALERT_WEBHOOK_URL`; ajustar `backend/test/alerts.test.ts` y el párrafo de `evidencias/alcance-adicional.md` ("No se retiran") para que no contradigan la decisión per Constitution VI (partial)
