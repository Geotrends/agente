# Crawler multi-fuente del corpus documental institucional

Crawler y scraper en Python para construir un corpus local trazable a partir de
fuentes publicas relevantes para el Observatorio Ambiental de Envigado:

- `ambientometro` — `https://ambientometroenvigado.com/observatorio/` (fuente original).
- `concejo_envigado` — Gaceta del Concejo de Envigado (acuerdos, decretos, resoluciones, circulares).
- `minambiente` — normativa y documentos tecnicos del Ministerio de Ambiente.
- `minagricultura` — normativa y desarrollo rural/agropecuario del Ministerio de Agricultura.

El proyecto guarda paginas HTML como Markdown, descarga documentos originales y
genera metadatos CSV/JSON. Sigue siendo **solo adquisicion documental**: no contiene
RAG, embeddings, chunking, bases vectoriales, busqueda hibrida ni llamadas a modelos
de lenguaje o clasificacion con IA (todo el filtrado es determinista, ver
`scraper/relevance.py`).

## Caracteristicas

- Recorrido BFS con profundidad maxima, normalizacion de URL y deduplicacion.
- Filtrado en dos niveles por fuente (`scraper/relevance.py`, sin IA):
  `should_crawl_url` decide si una pagina entra a la cola, `should_download_document`
  decide si un adjunto se descarga, ambos con score y razon auditables.
  - `ambientometro`: sin filtro (modo `general_observatory`, igual que siempre).
  - `concejo_envigado`: restringido a `ALLOWED_PATHS_CONCEJO`; exhaustivo dentro de
    esas rutas (modo `normative`).
  - `minambiente` / `minagricultura`: lista blanca estricta de decretos,
    resoluciones, leyes y circulares, complementada por score de relevancia
    (modo `selective_normative`).
- Clasificacion determinista de tipo documental (acuerdo/decreto/resolucion/ley/
  circular/guia/manual/politica/plan/protocolo) y extraccion de numero/anio por regex.
- Descubrimiento desde el contenido principal, evitando expandir menus y footer.
  Las fuentes pueden declarar selectores propios: el Concejo procesa el archivo
  completo de Elementor y MinAgricultura procesa el `<main>` completo, no solo la
  primera tarjeta `<article>`.
  Tambien detecta documentos embebidos con `<embed>`/`<object>` (no solo `<a href>`),
  necesario para sitios como el Concejo que insertan el PDF de la norma asi.
- Deteccion de documentos por extension, `Content-Type` y `Content-Disposition`.
- PDF, Excel, Word, PowerPoint, CSV y TXT, con carpeta para otros adjuntos.
  Los `.zip` no se descargan.
- SHA-256 y reutilizacion de documentos ya presentes en ejecuciones anteriores;
  la metadata (`metadata/documentos.csv`) es compartida entre fuentes, por lo que un
  PDF encontrado en dos fuentes distintas se descarga una sola vez.
- Extraccion especifica para WordPress/Elementor y paginas de indice extensas.
- Tablas, titulos, listas y enlaces convertidos a Markdown por `markdownify`.
- Consulta y aplicacion de `robots.txt`, pausas configurables por fuente y
  reintentos limitados.
- Limite configurable de descarga y proteccion contra path traversal.
- Errores aislados: una URL defectuosa no detiene el resto del rastreo.
- Modo `--dry-run`: registra la decision (CRAWL/DOWNLOAD/SKIP + razon + score) de
  cada URL sin descargar ni escribir nada, para afinar los filtros antes de correr.

## Requisitos e instalacion

Python 3.10 o posterior.

macOS/Linux:

```bash
cd scraper_agente
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Windows (PowerShell o CMD):

```bat
cd scraper_agente
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

## Uso

Por defecto (sin `--sources`) sigue corriendo solo `ambientometro`. Su salida ahora
queda bajo `OUTPUT_DIR/ambientometro/` (antes era plana, directo bajo `OUTPUT_DIR/`).
Los archivos de corridas anteriores al cambio de carpeta se quedan donde estaban;
el dedup por SHA-256 los sigue reconociendo via `metadata/documentos.csv`, y de aqui
en adelante todo lo nuevo cae en `ambientometro/`.

```bash
python main.py --output "/ruta/de/salida"
```

Elegir una o varias fuentes:

```bash
python main.py --output "/ruta/de/salida" --sources ambientometro concejo_envigado minambiente minagricultura
python main.py --output "/ruta/de/salida" --sources concejo_envigado
python main.py --output "/ruta/de/salida" --sources minagricultura
```

O usar el script `run_all_sources.sh`, que activa el venv si existe y corre las 4
fuentes en un solo comando (acepta cualquier flag adicional de `main.py`):

```bash
./run_all_sources.sh /ruta/de/salida
./run_all_sources.sh /ruta/de/salida --dry-run
./run_all_sources.sh /ruta/de/salida --max-pages 50 --delay 1.0
SOURCES="concejo_envigado minambiente" ./run_all_sources.sh /ruta/de/salida
```

`--dry-run`: no descarga ni guarda nada, solo registra en el log (y en consola) la
decision de cada URL. Imprescindible para afinar los filtros de MinAmbiente /
MinAgricultura antes de una corrida real:

```bash
python main.py --output ./salida_prueba --sources minambiente --dry-run --max-pages 40
```

Con opciones (aplican a todas las fuentes seleccionadas; `--start-url` solo es
valido si `--sources` tiene una unica fuente):

```bash
python main.py \
  --output "/ruta/de/salida" \
  --sources ambientometro \
  --start-url "https://ambientometroenvigado.com/observatorio/" \
  --max-depth 10 \
  --timeout 30 \
  --delay 0.5 \
  --max-file-size-mb 200
```

Use `--no-related-seeds` si necesita limitar la corrida exclusivamente al grafo de
enlaces que nace en cada `start_url` configurada (sin las semillas/secciones
relacionadas de `scraper/sources.py`).

Para una validacion breve se puede limitar la cantidad total de URLs procesadas por
fuente:

```bash
python main.py --output ./salida_prueba --max-depth 2 --max-pages 10
```

## Configuracion

Los valores predeterminados generales estan al principio de `scraper/config.py`
(`MAX_DEPTH`, `REQUEST_TIMEOUT`, `MAX_FILE_SIZE_MB`, etc.). La definicion de cada
fuente (`start_urls`, `allowed_domains`, `allowed_paths`, `content_selectors`,
`document_allowed_domains`, `document_exclude_phrases`, `allowed_document_types`,
modo de filtrado, palabras clave de alta
prioridad/blacklist, delay, `user_agent`) vive en `scraper/sources.py`
como el diccionario `SOURCES`; ahi se agregan o ajustan fuentes sin tocar el
crawler. La opcion `--output` es obligatoria para hacer explicito el destino.

### Filtrado por fuente (`scraper/relevance.py`)

- **Nivel A** (`should_crawl_url`): decide si una URL de pagina HTML entra a la
  cola, antes de descargarla.
- **Nivel B** (`should_download_document`): decide si un adjunto ya detectado se
  descarga (mira extension, URL, anchor text, filename, titulo de la pagina que lo
  enlaza y el score de relevancia).
- `ambientometro` (`general_observatory`): sin cambios respecto al comportamiento
  original, no se filtra nada.
- `concejo_envigado` (`normative`): solo se sigue lo que esta dentro de
  `ALLOWED_PATHS_CONCEJO`; dentro de esas rutas la descarga es exhaustiva (no se usa
  el score como filtro principal, por diseño — ver seccion 11 del pedido original).
  El tipo documental (acuerdo/decreto/resolucion/otros) se detecta por regex sobre
  titulo/anchor/filename y decide tanto la subcarpeta de `documentos/` como las
  columnas `document_type`/`document_number`/`year` de la metadata.
- `minambiente` / `minagricultura` (`selective_normative`): cada URL/documento
  recibe un score determinista (`relevance_score`, sin IA) sumando/restando pesos de
  palabras clave (`MINAMBIENTE_HIGH_PRIORITY`/`BLACKLIST`,
  `MINAGRICULTURA_HIGH_PRIORITY`/`BLACKLIST` en `scraper/sources.py`). Solo se sigue
  o descarga lo que supera `min_relevance_score`, salvo paginas de indice
  (`normativa`, `decretos`, `resoluciones`, etc., o profundidad ≤ 1) necesarias para
  descubrir documentos, que se siguen igual aunque su propio score sea bajo.
- Para esas dos fuentes, la descarga exige que el nombre real entregado por el
  servidor o el texto del enlace identifique uno de estos cuatro tipos:
  `decreto`, `resolucion`, `ley` o `circular`. Proyectos, borradores, anexos,
  memorias justificativas, comentarios, observaciones y agendas regulatorias se
  rechazan antes de calcular el score. El titulo generico de una pagina de indice
  no basta para clasificar un adjunto.
- Los `.zip` no se descargan en ninguna fuente.

## Salida

Todas las fuentes, incluida `ambientometro`, quedan separadas bajo su propia
carpeta de aqui en adelante; la metadata y los logs siguen compartidos para toda
la corrida:

```text
OUTPUT_DIR/
├── ambientometro/
│   ├── documentos/{pdf,excel,word,powerpoint,csv,txt,otros}/
│   └── paginas_md/<categoria>/*.md
├── concejo_envigado/
│   ├── documentos/{acuerdos,decretos,resoluciones,circulares,otros}/
│   └── paginas_md/<categoria>/*.md
├── minambiente/
│   ├── documentos/{pdf,excel,word,...}/
│   └── paginas_md/<categoria>/*.md
├── minagricultura/
│   ├── documentos/{pdf,excel,word,...}/
│   └── paginas_md/<categoria>/*.md
├── metadata/                    # compartida entre TODAS las fuentes
│   ├── documentos.csv           # incluye columna "source" + clasificacion
│   ├── paginas.csv
│   ├── urls_visitadas.csv
│   ├── errores.csv
│   └── manifest.json            # manifest combinado, una entrada por fuente corrida
└── logs/scraper.log             # compartido, cada linea llevo el tag [fuente]
```

Las rutas registradas en CSV son relativas a `OUTPUT_DIR`, lo que permite mover el
corpus completo. Los CSV se escriben con UTF-8 BOM para abrirlos correctamente en
Excel y se regeneran atomicamente durante la ejecucion. `metadata/documentos.csv`
agrega, ademas de las columnas originales, `source`, `document_type`,
`document_number`, `year`, `title`, `topic`, `relevance_score` y `download_url`
(alias de `source_url`); cuando un dato no se puede determinar queda vacio (nunca se
inventa). Filas historicas sin columna `source` se asumen de `ambientometro` (unica
fuente que existia antes de este cambio).

## Reanudacion e incrementalidad

Al comenzar, el programa carga los SHA-256 existentes de `documentos.csv`. Las
paginas se vuelven a consultar para descubrir cambios y enlaces nuevos. Un documento
con contenido ya conocido no se guarda otra vez; si la misma URL entrega bytes
nuevos, se conserva como una nueva version con nombre no colisionante. Cada corrida
produce metadatos de esa corrida y referencia el archivo historico cuando encuentra
un duplicado.

No borre `metadata/documentos.csv` si desea aprovechar la deduplicacion entre
ejecuciones. Tampoco mueva documentos fuera de `OUTPUT_DIR` sin actualizar ese CSV.

## Robots.txt y politeness

Antes de rastrear, el crawler descarga `/robots.txt` y evalua cada URL con
`urllib.robotparser`. Las rutas prohibidas se omiten y quedan en el registro de
errores. El sitio actualmente declara bloqueos para carrito, checkout, parametros de
carrito y `xmlrpc.php`; tambien existe un filtro defensivo para estas rutas.

Hay una pausa minima entre todas las solicitudes; cada fuente tiene su propio delay
por defecto en `scraper/sources.py` (`SOURCE_DELAYS`), y `--delay` lo sobrescribe
para toda la corrida. Los reintentos solo cubren fallos transitorios y respuestas
429/5xx.

Notas encontradas al validar en vivo (2026-09) los tres sitios nuevos:

- `concejoenvigado.gov.co` (con o sin `www.`) devuelve `403 Forbidden` a cualquier
  User-Agent que se identifique como bot/crawler (incluido el UA transparente que
  usa `ambientometro` por defecto), pero acepta un UA de navegador estandar; su
  `robots.txt` no restringe estas rutas. Por eso `concejo_envigado` declara su
  propio `user_agent` en `scraper/sources.py`.
- `minambiente.gov.co` y `minagricultura.gov.co` **solo resuelven bajo `www.`**
  (el dominio sin `www.` no responde). Como `normalize_url` unifica todo a la forma
  sin `www.` para deduplicar paginas, el crawler reintegra el host declarado en
  `start_url` justo antes de cada solicitud saliente (`utils.rehost`), para no
  terminar pidiendole contenido al host equivocado.
- En el Concejo, el PDF de cada norma individual (`/boletines/<slug>/`) se inserta
  con `<embed src="...pdf">`, no con `<a href>`; `html_parser.parse_html` tambien
  extrae `embed[src]`/`object[data]` cuando apuntan a un documento, ademas de los
  enlaces normales.
- Las taxonomias anuales del Concejo (`/acuerdos_ano/` y `/actas_ano/`) estan
  permitidas porque viven fuera
  de la ruta principal de la Gaceta aunque se enlazan desde ella.
- Los adjuntos cuyo nombre, enlace o contexto contiene `proyecto de acuerdo` se
  descartan: se conservan los acuerdos aprobados (`acuerdo-*`) y se evita ingresar
  proyectos normativos al corpus.
- MinAgricultura puede descargar documentos descubiertos en los hosts externos
  declarados en `document_allowed_domains` (actualmente su subdominio de pruebas y
  su SharePoint). Esos hosts son solo de descarga: sus paginas y menus nunca se
  agregan al recorrido del crawler. Si un enlace compartido devuelve una vista HTML
  o exige autenticacion, se registra como error y no se navega el servicio externo.

## Contenido JavaScript

La implementacion base usa `requests`, como corresponde al WordPress actual. Marca
`dynamic_suspected=true` y escribe `[JS?]` en el log cuando una pagina tiene muy poco
texto pero varios scripts. Ese indicador permite agregar despues un fetcher Playwright
solo para esas URLs; Playwright no se incluye hoy como dependencia.

## Limitaciones operativas

- Un servidor puede rechazar el User-Agent, limitar solicitudes o cambiar su HTML.
- `markdownify` representa bien tablas regulares; tablas con `rowspan`/`colspan`
  complejos pueden quedar como una aproximacion textual.
- Los documentos se validan por descarga completa y SHA-256, pero no se intenta abrir
  internamente cada formato. Un HTML disfrazado con MIME de PDF se conservaria si el
  servidor declara ese MIME.
- Un corte abrupto puede dejar un archivo temporal dentro de `.tmp`; no afecta al
  corpus y puede eliminarse cuando no hay una ejecucion activa.

## Pruebas

```bash
python -m unittest discover -s tests -v
```
