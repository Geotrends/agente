# Research: Base de conocimiento institucional (Bloque 1)

**Feature**: [spec.md](./spec.md) · **Diagnóstico**: [diagnostico.md](./diagnostico.md)
**Fecha**: 2026-10-07

Cada decisión cita los requisitos que resuelve. Las marcadas **(confirmar)** necesitan el
visto bueno del Líder de Proyecto antes de la carga inicial.

---

## R1. Reparto del pipeline entre procesos

**Decision**: el trabajo se reparte en tres procesos con una frontera de datos explícita.

1. **Adquisición y verificación (Python, offline)**: el scraper existente.
   - Descarga, renderiza y extrae.
   - Por cada ejecución escribe un **informe de corrida** JSON
     ([contrato](./contracts/run-report.md)): un registro por enlace, con el estado detectado,
     el resultado, el hash y los metadatos GMAS2 estructurados.
   - No conoce la matriz ni la base de datos.
2. **Sincronización de la base (TypeScript, offline)**: un nuevo servicio `kb-worker` con la
   imagen del backend.
   - Consume los informes de corrida y aplica las reglas de alcance y estado.
   - Convierte a Markdown (OCR con confianza) y genera fichas.
   - Persiste la matriz, las versiones, los registros y las notificaciones en PostgreSQL.
   - Indexa en Qdrant.
   - Es el **único escritor** de la matriz y de Qdrant.
3. **Chat (TypeScript, en línea)**: el backend actual.
   - Solo lee la colección publicada de Qdrant y, desde PostgreSQL, el índice
     código → URL (`documentLinks`).

**Rationale**:
- La constitución permite Python solo en procesos offline y exige TypeScript en lo que
  atiende al ciudadano. El scraper ya resuelve GMAS2 (SPA, `downloadFile`, filtro de estado).
- La conversión, el OCR y los embeddings ya están en TypeScript (`documentPreprocessor.ts`,
  `embeddings.ts`).
- Un solo escritor de la matriz evita carreras y deja un único lugar donde aplicar
  RF-C3-IV-01, IV-03 e IV-04.
- Sacar la indexación del backend elimina la parada de `make cache` (RNF-C3-IV-02) y libera
  el heap de 4 GB que hoy ocupa el índice en memoria.

**Alternatives considered**:
- *El scraper escribe directo en PostgreSQL*: daría dos escritores de la matriz con reglas
  duplicadas en dos lenguajes. Rechazada.
- *La indexación sigue dentro del backend*: no se cumpliría RNF-C3-IV-02 en el flujo
  operativo y el chat seguiría compitiendo por CPU durante la ingesta (RNF-C3-IN-13).
  Rechazada.

---

## R2. Fuente de verdad del contenido y versiones

**Decision**: el Markdown de cada versión (pendiente o publicada) se guarda en PostgreSQL
(`kb_version.contenido_md`). Los archivos del volumen de datos quedan como área de
adquisición, no como base. Qdrant es un derivado reconstruible desde PostgreSQL. Cuando se
publica una versión nueva, se elimina la anterior: no se conserva copia, como prepara
RF-C3-AD-20.

**Rationale**:
- RF-C3-IV-04 exige mantener la última versión validada aunque el scraper sobrescriba el
  archivo, cosa que hoy ocurre (`crawler.py::_save_page`).
- Con el contenido en PostgreSQL, una reindexación completa no repite el OCR: solo
  fragmenta, embebe e indexa. Eso abarata el cumplimiento de RNF-C3-IV-01 y
  RNF-C3-IV-02.
- La base acotada (~420 elementos) cabe sin problema en PostgreSQL.

**Alternatives considered**:
- *Archivos direccionados por hash en el volumen*: obligaría a recolectar basura y a
  mantener la coherencia con la matriz. Rechazada.
- *Guardar el contenido solo en el payload de Qdrant*: perdería las versiones pendientes y
  la colección dejaría de ser desechable. Rechazada.

---

## R3. Búsqueda híbrida sobre Qdrant

**Decision**: una colección por construcción, `kb_chunks_<marca>`, servida a través del
alias `kb_chunks`.

- **Vectores densos**: `dense`, 384 dimensiones, coseno, del modelo actual
  `Xenova/multilingual-e5-small`, que se sigue ejecutando localmente con Transformers.js.
- **Vector disperso**: `bm25`, con `modifier: idf`. El cliente calcula los pesos de
  frecuencia de término con la saturación BM25 (k1 y b actuales) y el **mismo tokenizador**
  `terms()` de `retrievalMath.ts`. Qdrant aporta el IDF.
- **Consultas**: dos consultas top-40 (densa y dispersa) y la fusión RRF del lado del
  cliente con la función actual `reciprocalRankFusion`. Así el comportamiento de fusión,
  reranker y diversificación (bloque 2) no cambia.
- **Payload**: lleva lo necesario para citar (título, código, URL, fechas, dirección,
  página) y `estado=publicado`. Toda consulta filtra por ese estado como defensa en
  profundidad.

**Rationale**:
- RNF-C3-IV-01 nombra Qdrant y la constitución exige BM25 + vectorial + RRF.
- Con la parte léxica y la semántica en la misma colección, un único cambio de alias
  intercambia ambas a la vez: es atómico (RNF-C3-IV-02).
- El IDF del servidor se mantiene correcto con las publicaciones incrementales. La longitud
  media de documento (`avgdl`) se fija en cada construcción completa y se guarda en
  `kb_indexacion`. La deriva entre construcciones es despreciable con ~420 documentos.

**Alternatives considered**:
- *BM25 en memoria del backend, reconstruido desde los payloads*: mantiene un segundo
  índice que hay que sincronizar con el alias y rompe la atomicidad. Rechazada.
- *Fusión del lado del servidor con la Query API (`fusion: rrf`)*: es viable, pero cambia
  la k de RRF y el formato de los puntajes de diagnóstico que usa la calibración. Se deja
  como optimización posterior.

---

## R4. Reindexación sin interrupción

**Decision**: hay dos caminos.

- **Completa**: el `kb-worker` crea `kb_chunks_<marca>`, la llena desde las versiones
  publicadas en PostgreSQL, verifica el conteo de puntos contra el esperado y solo entonces
  mueve el alias en una operación `update_aliases`. Borra la colección anterior después
  del cambio.
  - Si algo falla antes del cambio, se borra la colección nueva, se registra la indexación
    como `fallida` y se notifica. El alias sigue en la anterior.
- **Incremental** (publicar o derogar un elemento):
  - Publicar: hace upsert de los puntos de la versión nueva en la colección del alias y
    después borra los puntos de la versión anterior.
  - Derogar: borra los puntos por `elemento_id`.

**Rationale**: satisface RNF-C3-IV-02, incluida la prueba con fallo forzado a mitad de la
indexación, y sienta la base de RF-C3-AD-47. En la publicación incremental, durante un
instante conviven la versión nueva y la vieja. Eso es preferible a un hueco sin ninguna
(RF-C3-AD-20).

**Alternatives considered**: *snapshots de Qdrant*: son más pesados y no aportan nada frente
al alias. Rechazada.

---

## R5. Programación de la verificación semanal

**Decision**:
- El contenedor `scraper` pasa a ser un servicio de larga duración que ejecuta
  **supercronic** con una entrada configurable: `SCRAPER_CRON`, por defecto domingo 02:00
  `America/Bogota`. El valor debe dar como máximo 7 días entre ejecuciones; un patrón
  semanal o más frecuente.
- El `kb-worker` vigila `/app/data/runs/` con `fs.watch` y procesa cada informe en cuanto
  aparece como `.json`. Un sondeo cada 5 minutos queda como respaldo. Los informes viven en
  el volumen `geobot-runs`, de escritura para `scraper` y `kb-worker`; el resto del volumen
  de datos sigue en solo lectura para el `kb-worker`.
- El `kb-worker` tiene además un **vigilante**: si la última corrida completa tiene más de
  7 días, emite la notificación `verificacion_atrasada`.

- Al arrancar, el contenedor del scraper valida `SCRAPER_CRON`: rechaza un patrón cuyo día
  del mes o mes no sea `*`, porque solo así se garantiza como máximo 7 días entre corridas.

**Rationale**:
- RF-C3-IV-02 pide verificaciones sin intervención manual y con un máximo de 7 días entre
  ellas.
- supercronic está pensado para contenedores (registra en stdout y se integra con las
  señales del contenedor).
- El vigilante convierte una programación caída en un fallo visible, no silencioso
  (principio VI).
- Dokploy despliega el mismo compose; no depende de funciones del orquestador.

**Alternatives considered**:
- *Cron de Dokploy*: deja la programación fuera del repositorio y sin pruebas. Rechazada.
- *El `kb-worker` lanza el scraper*: son imágenes y lenguajes distintos, y obligaría a montar
  el socket de Docker. Rechazada por seguridad.

---

## R6. OCR con confianza medida

**Decision**: reemplazar `ocrmypdf` por un flujo directo con **Tesseract**:

1. **PDF**: se rasteriza cada página con `pdftoppm -r 300` (`poppler-utils`, se añade a la
   imagen).
2. **DOCX**: se extraen las imágenes de `word/media/*` del contenedor ZIP.
3. **Imágenes** (`.png`, `.jpg`, `.jpeg`, `.tif`, `.tiff`): se procesan directamente.
4. Cada imagen se pasa a `tesseract <img> <out> -l spa+eng txt tsv`.
5. La **confianza media del documento** es la media de `conf` de todas las palabras con
   `conf >= 0` en el TSV, de todas las páginas o imágenes. Si no hay palabras, la confianza
   es 0.
6. Se carga si la confianza es mayor que `OCR_MIN_CONFIDENCE` (80, configurable, nunca
   menor que 80).

**Rationale**:
- RF-C3-IV-07 exige "la confianza media reportada por el motor de OCR". `ocrmypdf` no la
  expone. El TSV de Tesseract es la fuente directa.
- La media por palabra es la métrica estándar y es reproducible.

**Alternatives considered**:
- *Leer el hOCR temporal de `ocrmypdf --keep-temporary-files`*: depende de un detalle
  interno no documentado. Rechazada.
- *Mantener la heurística `looksLikeGarbage`*: no es una confianza del motor, y su respaldo
  (indexar el texto nativo que no pasó el control) contradice RF-C3-IV-07. Se retira de la
  decisión de carga. Se mantiene como señal de "texto nativo de baja calidad" (R7).

---

## R7. Cuándo aplicar OCR (umbral de 80 caracteres)

**Decision**:
- **Conteo nativo**: caracteres no blancos del texto extraído del documento completo, sin
  los separadores `-- N of M --` de `pdf-parse`. Se conserva la medida actual de
  `shouldUseOcr`.
- **PDF y DOCX**: se aplica OCR si el conteo es menor que 80; si es 80 o más, nunca.
- **Imágenes**: siempre.
- **XLSX, XLS, DOC, MD y TXT**: nunca. El requisito no los incluye.
- **PDF o DOCX con 80 o más caracteres y `looksLikeGarbage` verdadero**: se carga el texto
  nativo, se marca `calidad_nativa_baja` en el registro de procesamiento y se emite la
  notificación `texto_nativo_ilegible`. Es el caso límite acordado en la spec.

**Rationale**:
- RF-C3-IV-08 dice "ninguno con 80 o más".
- Contar sin blancos evita que un PDF escaneado de muchas páginas supere el umbral solo con
  saltos de línea. Ese defecto ya está documentado en el código con un caso real.

---

## R8. Tablas anidadas del visor GMAS2

**Decision**: normalizar el HTML de GMAS2 **antes** de `markdownify`, en `html_parser.py`,
con un paso específico de la fuente que se activa con `content_selectors=("#area",)`.

1. **Rejillas jqGrid**: se unen la tabla de encabezados (`.ui-jqgrid-htable`) y la de cuerpo
   (`.ui-jqgrid-btable`) en una sola `<table>` con `<thead>` y `<tbody>`.
2. **Columnas**: se descartan las ocultas (`display:none`) y las técnicas (`tipoRegistro`,
   `Acciones`, el contador `Ítem` cuando es 0).
3. **Tablas de maquetación** que contienen otra tabla: se desenvuelven, emitiendo las tablas
   internas como bloques independientes.
4. **Ruido de interfaz**: se eliminan "Cargando...", "Vista Completa / Acordeón / Pestañas" y
   las anclas `#tab-*`.

Las pruebas usan **HTML real capturado** de GMAS2 (GT-P-004 y GT-P-021) como fixtures
congeladas.

**Rationale**:
- RF-C3-IV-09: en Markdown solo se puede reconstruir la tabla con el DOM disponible.
- Las clases de jqGrid son estándar de esa biblioteca.
- La estructura exacta se confirma con las fixtures capturadas en la primera tarea de
  implementación. Si difiere, se ajustan los selectores, no la estrategia.

**Alternatives considered**: *reparar el Markdown ya aplanado*: es ambiguo e irreversible.
Rechazada.

---

## R9. Metadatos estructurados de GMAS2 y fichas

**Decision**:
- Por cada página de GMAS2, el scraper extrae en el informe de corrida:
  - código, nombre, versión ("Versión: 06"), fecha de actualización ("Fecha: 12-09-2022",
    normalizada a ISO) y estado (`.estado`);
  - dependencia (fila "DEPENDENCIAS");
  - los documentos vinculados de las rejillas (Documentos Referencia, Documentos
    Transversales, Registros, Relaciones), cada uno con código, nombre, URL e ID.
- El `kb-worker` arma la **ficha** (RF-C3-IV-05) con el encabezado YAML de 10 campos del
  [contrato](./contracts/encabezados-markdown.md) y el cuerpo Markdown ya normalizado (R8).
- La dirección responsable sale del mapa de R11.
- Los vinculados se clasifican por la letra de tipo de su código:
  - `-P-` → procedimiento;
  - `-F-` → formato;
  - `-N-` → norma, sin importar el prefijo de proceso (GT, CS, IV), según el supuesto de
    la spec.

**Rationale**: los criterios de RF-C3-IV-05 se verifican comparando directamente contra
GMAS2. Extraer del DOM es más fiable que hacerlo con expresiones regulares sobre el
Markdown.

---

## R10. Alcance de GMAS2 y causa de los MG ausentes

**Decision**:
- **Semillas**: los 6 GT-P. Se agrega GT-P-029 (`0000004622`) a `GMAS2_DOCUMENT_IDS`.
- **Regla de recorrido**:
  - desde un GT-P se siguen sus vinculados (profundidad 1);
  - desde un vinculado (GT-F, norma, MG-P, MG-F) solo se siguen sus descargas
    (`downloadFile.public`), nunca otros documentos.
  - Esto reemplaza `max_depth=10`.
- **Estado**: los documentos con estado distinto de "Vigente" ya no se descartan en
  silencio. Se registran en el informe con `estado_detectado=derogado`, no se descargan y
  no se siguen sus enlaces.
- **MG ausentes**: la causa exacta se investiga en la primera tarea, reproduciendo el
  recorrido desde la fixture de GT-P-004. Las hipótesis son:
  1. el enlace relativo `VisualizacionDocumento.public?...` no pasa `allowed_paths`;
  2. el filtro `require_text_values` cae sobre MG que se presentan con otro selector de
     estado;
  3. la profundidad.
  Una prueba de regresión exige MG-P-003, MG-F-002 y MG-F-051 en el informe de GT-P-004.
- **Hallazgo de la captura (T008, 2026-10-07)**: de los documentos que cita GT-P-004,
  **MG-P-003 (`0000002961`) y MG-F-002 (`0000000475`) están "Derogado" en GMAS2** y MG-F-051
  (`0000012522`) está vigente. La causa principal de los MG ausentes es, por tanto, el
  filtro "Vigente" (hipótesis 2), que los descartaba sin dejar rastro.
- **Regla para un vinculado derogado desde la primera vez que se ve**: no se carga ni crea
  fila en la matriz, porque nunca fue "documento de la base". Queda su verificación con
  `estado_detectado=derogado` y se emite una notificación `documento_derogado` (agrupada),
  para que la Dirección sepa que un GT-P vigente cita un documento derogado. Si estaba
  cargado y pasa a derogado, aplica la transición normal (RF-C3-IV-03).

**Rationale**:
- RF-C3-IV-01 limita los MG a "los citados dentro de esos GT-P".
- `max_depth=10` sobre el grafo de "documentos asociados al proceso" puede traer documentos
  no citados.
- RF-C3-IV-03 necesita *detectar* los derogados para marcarlos, no ignorarlos.

---

## R11. Mapa de direcciones responsables (confirmado 2026-10-07)

**Decision**: el archivo versionado `backend/config/base-conocimiento.json` contiene el mapa
de GT-P (confirmado por el usuario), el de secciones de sitio y la lista de hosts permitidos.

| GT-P | Dirección |
|---|---|
| GT-P-004 | Gestión Ambiental |
| GT-P-011, GT-P-020, GT-P-021, GT-P-027 | Bienestar Animal |
| GT-P-029 | Ecosistemas |

Los vinculados heredan la dirección de su procedimiento de origen. Si un vinculado tiene
varios procedimientos de origen con direcciones distintas, se registra con la dirección del
primero en orden de código y todos los orígenes quedan en "procedimiento de origen".

**Mapa por sección (confirmado por el Líder de Proyecto el 2026-10-07)**: se compara el prefijo de la ruta de la URL. Gana
la coincidencia más larga. Los PDF heredan la sección de la página que los enlaza.

| Host | Prefijo de ruta | Dirección |
|---|---|---|
| ambientometroenvigado.com | `/campana-de-adopcion-animales-de-compania`, `/campana-de-esterilizacion-de-caninos-y-felinos`, `/registro-de-mascotas` | Bienestar Animal |
| ambientometroenvigado.com | `/calidad-del-aire`, `/calidad-del-aire-indoor`, `/campanas-de-calidad-del-aire`, `/sensor-de-calidad-de-aire-indoor`, `/monitoreo-de-fuentes-moviles`, `/ruido-ambiental`, `/cambio-climatico`, `/plan-local-de-cambio-climatico`, `/disposicion-de-residuos-solidos`, `/gestion-energetica-smada`, `/indicadores-en-tiempo-real`, `/variables-ambientales`, `/autoridad-ambiental`, `/docs/boletines-` | Gestión Ambiental |
| ambientometroenvigado.com | `/ecozona-`, `/indicadores-recurso-natural`, `/registro-de-siembras` | Ecosistemas |
| ambientometroenvigado.com | `/secreatria-de-medio-ambiente-y-desarrollo-rural/bienestar-animal` | Bienestar Animal |
| ambientometroenvigado.com | `/secreatria-de-medio-ambiente-y-desarrollo-rural/gestion-ambiental` | Gestión Ambiental |
| ambientometroenvigado.com | `/secreatria-de-medio-ambiente-y-desarrollo-rural/ecosistemas-y-biodiversidad` | Ecosistemas |
| ambientometroenvigado.com | resto (observatorio, proyectos, campañas, desarrollo rural, biblioteca) | Secretaría (general) |
| envigado.gov.co / www.envigado.gov.co | (las 4 páginas) | Secretaría (general) |
| observatorioenvigado.geotrends.co | (por definir cuando se rastree) | Secretaría (general) |

**Traducción a rutas reales (T010)**: la tabla de arriba se armó con los nombres de carpeta
del corpus. En `backend/config/base-conocimiento.json` está traducida a las rutas de URL
reales, con la misma intención. Ejemplos: `/calidad-de-aire` y `/calidad-del-aire`;
`/docs/2022-2` para los boletines de 2022; `/presion-sonora` junto con ruido; las subrutas
de `/secreatria-…/informacion-ambiental/`. Cuatro secciones no figuraban en la tabla y se
asignaron por analogía: `/fauna-domestica` → Bienestar Animal; `/fauna-silvestre`,
`/monitoreo-de-biodiversidad` y `/recurso-hidrico` → Ecosistemas. **Confirmadas por el
Líder de Proyecto el 2026-10-08**, sin cambios en el mapa (T085); si en el futuro cambia
alguna, se corrige con `kb recalcular-direcciones`.

**Hosts canónicos**: la lista de hosts permitidos usa el host final observado tras las
redirecciones en las capturas de T008. Si `ambientometroenvigado.com` redirige a `www.`, se
declaran ambos como hosts exactos. La lista de Python y la del JSON deben ser idénticas
(prueba).

**Correcciones posteriores**: el comando `kb recalcular-direcciones` vuelve a aplicar el
mapa a la matriz y al payload de Qdrant sin reindexar.

El mapa se carga y valida al arrancar el `kb-worker`: las direcciones deben pertenecer a la
lista cerrada y los hosts a la lista permitida. Si un elemento no casa con ninguna sección,
se registra como "Secretaría (general)".

**Rationale**: decisión del usuario (mapa por sección). Las rutas salen del corpus local
(`backend/data/ambientometro/paginas_md/*`). Que el archivo esté versionado hace que el
cambio solo entre con un despliegue, igual que la lista de hosts de RF-C3-AD-15.

---

## R12. Formatos sin datos personales

**Decision**: un control automático `formatoEnBlanco(texto)` aplicado al texto extraído de
cada GT-F y MG-F. Rechaza el formato si encuentra alguno de estos casos:

1. Patrones de datos personales que ya detecta `pii.ts` (cédula, teléfono, correo).
2. Una etiqueta de diligenciamiento (NOMBRE, CÉDULA, DIRECCIÓN, TELÉFONO, CELULAR, CORREO,
   FIRMA, BARRIO) seguida en la misma línea de un valor que no sea un marcador: vacío,
   guiones bajos, puntos o espacios.

Un formato rechazado no se carga. Su registro de procesamiento queda con motivo
`formato_diligenciado` y se emite la notificación `formato_con_datos_personales`. La
revisión manual del 100 % (SC-005) se sigue haciendo; el control automático es una red de
seguridad.

**Rationale**:
- RF-C3-IV-10 y el principio IV de la constitución.
- La revisión de GT-F-011 muestra etiquetas seguidas de valores vacíos, así que el patrón
  "etiqueta + valor real" separa bien un formato en blanco de uno diligenciado.
- Las firmas son imágenes. Como no se hace OCR de las imágenes de un DOCX con texto nativo,
  una firma escaneada solo se detecta en la revisión manual. Esto queda documentado.

---

## R13. Persistencia, esquema y acceso

**Decision**:
- **Motor**: PostgreSQL 16 en el compose, en la red interna, sin puerto publicado.
- **Esquema**: lo describe [data-model.md](./data-model.md).
- **Migraciones**: archivos SQL numerados en `backend/migrations/`, aplicados por
  `kb migrate` dentro de una transacción. La tabla `schema_migrations` registra las
  aplicadas.
- **Roles**:
  - `kb_writer`: lo usa el `kb-worker`; tiene DML sobre el esquema `kb`.
  - `app_reader`: lo usa el backend del chat; solo puede hacer `SELECT` sobre la vista
    `kb.v_codigos_publicados`.
- **Driver**: `pg` (node-postgres).
- **Cliente de Qdrant**: `@qdrant/js-client-rest`.
- **Credenciales**: llegan por variables de entorno del despliegue. No son llaves de
  Bedrock, así que la restricción de RNF-C3-IN-07 no aplica.

**Rationale**:
- La constitución fija PostgreSQL para la matriz, los registros y las notificaciones.
- Los dos roles aplican el mínimo privilegio (principio VII): el chat no puede escribir en
  la matriz.
- Un runner de SQL propio evita sumar un framework de migraciones para un esquema pequeño.
  El repositorio tiende a tener pocas dependencias.

**Alternatives considered**: *Prisma o Knex*: dependencia y abstracción innecesarias para
~9 tablas. Rechazada.

---

## R14. Retención de 12 meses

**Decision**:
- **Qué se purga**: una tarea diaria del `kb-worker` borra las filas de `kb_verificacion`,
  `kb_procesamiento` y `kb_notificacion` (solo las ya revisadas) cuya fecha supere
  `KB_RETENCION_MESES`.
- **Valor**: por defecto 13 meses; la configuración rechaza valores menores que 12.
- **Registro**: cada ejecución de la purga queda en `kb_purga`.
- **Informes de corrida**: los JSON de `/data/runs/` se mueven a `/data/runs/procesados/`
  al ingerirse y se purgan con la misma regla.

**Rationale**:
- RNF-C3-IV-03 pide "al menos 12 meses".
- Un mes de margen absorbe la ventana de la tarea diaria.
- Las notificaciones no revisadas nunca se purgan: el principio VI dice que una falla no
  puede desaparecer sin que nadie la vea.

---

## R15. Exportación .xlsx y acceso del operador sin panel

**Decision**:
- **Exportación**: con SheetJS (`xlsx`), que ya es dependencia del backend. El comando
  `kb exportar-matriz` escribe en `/app/var/exports/matriz-<fecha>.xlsx` con las 12
  columnas de RF-C3-IV-11 (ver [contrato](./contracts/matriz-xlsx.md)).
- **Operación sin panel**: notificaciones, pendientes y publicación se manejan con la CLI
  `kb` dentro del contenedor `kb-worker` ([contrato](./contracts/kb-cli.md)).
- **Bloque 7**: sobre las mismas funciones del módulo `kb/service` pondrá pantallas
  autenticadas.
- **Endpoints HTTP**: no se expone ninguno en este bloque.

**Rationale**:
- Decisión del usuario: los datos ahora y las pantallas en el bloque 7.
- Exponer endpoints de administración sin la autenticación del bloque 7 violaría el
  principio VII y RNF-C3-AD-01.

---

## R16. Retiro del contenido fuera de alcance

**Decision**:
- Se eliminan del registro `SOURCES` las fuentes `concejo_envigado`, `minambiente` y
  `minagricultura`, y de `SCRAPER_SOURCES` en `.env.example`.
- Se agrega la fuente `observatorio_geotrends` (`observatorioenvigado.geotrends.co`,
  host exacto). El modo `render_js` se decide al capturar su HTML.
- La nueva colección de Qdrant solo contiene elementos publicados de la matriz. Al dejar
  de existir el índice en memoria y su snapshot, el contenido anterior deja de ser
  recuperable.
- Los archivos crudos de esas fuentes en el volumen de datos no se borran automáticamente.
  El quickstart documenta un comando opcional para hacerlo.

**Rationale**:
- RF-C3-IV-01 y FR-002.
- La auditoría de alcance se hace sobre la matriz y la colección (`kb auditar-alcance`), no
  sobre el área de adquisición.
- Quitar las definiciones de fuente evita reactivarlas por error. Además reduce la deuda
  nº 3 de la constitución.

---

## R17. Impacto en el backend del chat

**Decision**:

| Componente | Cambio |
|---|---|
| `search.ts` | Se reemplazan `buildIndex`, `getIndex` y el índice en memoria por consultas a Qdrant (R3). `hybridSearch` conserva su firma y su forma de resultado. |
| `indexSnapshot.ts`, caché de fragmentos, `indexDocuments.ts` | Se retiran del backend. |
| `chunking.ts` | Se mueve al `kb-worker`, sin cambios de comportamiento (las reglas de fragmentación son del bloque 2). |
| `sourceMetadata.ts` | Su papel en la búsqueda lo cubre el payload de Qdrant. |
| `documentLinks.ts` | Lee el índice código → URL de `kb.v_codigos_publicados`, memoizado con TTL. Si PostgreSQL no responde, conserva el último índice y, sin índice, deja los códigos como texto. |
| `retrievalStatus` y `/ready` | Pasan a reflejar la disponibilidad de Qdrant y de la colección del alias. |
| `NODE_OPTIONS` | Baja de 4096 MB a 1024 MB. |

**Validación**:
- El conjunto de oro y `eval:retrieval` se re-basan sobre el corpus acotado **antes** de la
  migración, con el índice en memoria, y se comparan **después**, con Qdrant.
- Si el recall@8 baja más de 2 puntos, la migración se bloquea.

**Rationale**: mantener intacto el contrato de la ruta `/api/chat` limita el radio del
cambio a la capa de recuperación. Las reglas de selección de fragmentos son del bloque 2 y
no se tocan.

---

## R18. Pruebas e integración continua

**Decision**:
- **Backend**: pruebas unitarias con `node:test`.
- **Scraper**: pruebas con `unittest`, sobre fixtures HTML capturadas.
- **Integración**: pruebas del `kb-worker` contra PostgreSQL y Qdrant reales, como
  *service containers* en GitHub Actions.
- **CI**:
  - suma un job `scraper` (Python 3.12, `python -m unittest`) y un job `kb-integracion`;
  - los disparadores pasan a `develop`, `prod_test` y `main`, que es el flujo de ramas de la
    constitución. Hoy disparan con `main` y `dev/**`.

**Rationale**: el principio X exige pruebas automatizadas que verifiquen los criterios. Varios
de los criterios del bloque (atomicidad, derogado, retención) solo se prueban con la base y
Qdrant reales.

---

## R19. Medición del tiempo de ingesta

**Decision**:
- **Comando**: `kb sincronizar --completa --medir` mide desde el primer documento convertido
  hasta el cambio de alias. Registra la duración por etapa (conversión, OCR, embeddings,
  indexación) en `kb_indexacion`.
- **Verificación**: la de RNF-C3-IV-01 se hace 3 veces en el entorno de producción (C6).
- **Estimación**:
  - el corpus acotado tiene ~420 elementos (31 de GMAS2, ~140 PDF y ~250 páginas de
    ambientometro, 4 de envigado.gov.co);
  - con e5-small en CPU, la indexación completa del corpus anterior de 6.295 documentos se
    medía en horas;
  - la escala es ~15 veces menor, así que se espera estar muy por debajo de 2 horas;
  - el riesgo es la cantidad de PDF que requieran OCR.

**Rationale**: RNF-C3-IV-01 se mide sobre la base real y en el entorno de producción. Una
medición por etapa deja ver dónde está el tiempo si se excede.
