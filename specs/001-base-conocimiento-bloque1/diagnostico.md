# Diagnóstico del estado actual — Bloque 1 (Base de conocimiento)

**Fecha**: 2026-10-07 · **Rama evaluada**: `develop` (con cambios locales sin commitear)
**Alcance**: RF-C3-IV-01 a IV-12 y RNF-C3-IV-01 a IV-03 del documento
`GRT_Documentacion_C3_C4_ENV-15-32-1244-26_v1`.

Clasificación:

- **Cumple**: el comportamiento existe y satisface el criterio de verificación.
- **Parcial**: existe algo, pero no satisface el criterio completo.
- **No cumple**: existe, pero contradice el requisito.
- **No implementado**: no existe.

Ningún requisito del bloque cumple por completo hoy.

## Resumen

| Requisito | Estado | Hallazgo principal |
|---|---|---|
| RF-C3-IV-01 | No cumple | El corpus incluye fuentes fuera de alcance; falta GT-P-029; no hay MG-P/MG-F |
| RF-C3-IV-02 | No implementado | Sin verificación programada ni registro de resultado por enlace |
| RF-C3-IV-03 | Parcial | Lo derogado no se descarga, pero lo ya cargado nunca se marca ni se excluye |
| RF-C3-IV-04 | No cumple | Un cambio de estructura sobrescribe la última versión buena; sin notificación |
| RF-C3-IV-05 | Parcial | Las fichas GT-P tienen 3 de 10 campos en el encabezado |
| RF-C3-IV-06 | Parcial | Las páginas tienen URL y fecha de acceso, pero no el hash en el encabezado |
| RF-C3-IV-07 | No cumple | No hay confianza de OCR; se indexa texto que no pasó el control de calidad |
| RF-C3-IV-08 | Parcial | El umbral de 80 caracteres existe solo para PDF; DOCX e imágenes no tienen OCR |
| RF-C3-IV-09 | No cumple | Las tablas anidadas de GMAS2 se aplanan en filas ilegibles |
| RF-C3-IV-10 | No implementado | No existe control de formatos en blanco |
| RF-C3-IV-11 | Parcial | Dos catálogos CSV con 4 de los 12 campos exigidos |
| RF-C3-IV-12 | No implementado | Sin exportación .xlsx |
| RNF-C3-IV-01 | No cumple | Sin Qdrant; la carga completa del corpus actual tarda horas y no se ha medido |
| RNF-C3-IV-02 | Parcial | La revalidación en proceso es atómica, pero `make cache` detiene el backend |
| RNF-C3-IV-03 | No implementado | Sin política de retención; el informe de descartes se sobrescribe |

## Detalle y evidencia

### RF-C3-IV-01 — Alcance de la base · No cumple

- `.env.example` (`SCRAPER_SOURCES`) activa 6 fuentes: `ambientometro`, `concejo_envigado`,
  `minambiente`, `minagricultura`, `envigado_com` y `gmas2_envigado`. Concejo y los dos
  ministerios quedan fuera del alcance acordado.
- `web_scraper/scraper/sources.py` (`GMAS2_DOCUMENT_IDS`) tiene 5 IDs, que producen GT-P-004,
  011, 020, 021 y 027. **Falta GT-P-029** (ID `0000004622`).
- GMAS2 sigue los documentos asociados de cada GT-P (`max_depth=10`), pero en el corpus local
  no hay ningún MG-P ni MG-F, aunque los GT-P los citan (p. ej. GT-P-004 cita MG-P-003,
  MG-F-002 y MG-F-051).
- Las normas vinculadas llegan con prefijos distintos de GT-N (CS-N-012, IV-N-102,
  IV-N-258), además de GT-N-149, 218 y 219.
- `observatorioenvigado.geotrends.co` no está configurado como fuente.
- No hay matriz documental ni auditoría que pruebe que no existe contenido fuera de ella.
- Corpus local evaluado (`backend/data`): 151 documentos (138 de ambientometro, 13 de gmas2)
  y 267 páginas (245 de ambientometro, 18 de gmas2, 4 de envigado.gov.co).

### RF-C3-IV-02 — Verificación periódica · No implementado

- El scraper solo corre a mano (`make scrape`), sin programación.
- `metadata/urls_visitadas.csv` guarda el estado HTTP de cada visita, pero no el estado
  vigente/derogado detectado ni el resultado ("sin cambios", "cambio detectado", "error").

### RF-C3-IV-03 — Derogados · Parcial

- `require_selector_text=".estado"` con `require_text_values=("Vigente",)`: una página
  derogada no se guarda y sus enlaces no se siguen (`crawler.py::_save_page`).
- Pero si un documento **ya cargado** pasa a derogado, su Markdown sigue en disco y en el
  índice: no se marca, no se excluye y no se notifica.

### RF-C3-IV-04 — Verificación fallida · No cumple

- Los errores HTTP quedan en `metadata/errores.csv`, y el archivo anterior sigue en disco.
- Una página con **estructura modificada** que aún produce 40 caracteres o más sobrescribe el
  Markdown anterior de la misma URL (`crawler.py::_save_page`, rama `existing_url_path`). La
  última versión validada se pierde.
- No hay notificaciones al administrador.

### RF-C3-IV-05 — Fichas de procedimiento · Parcial

- Las páginas GT-P se guardan como Markdown con frontmatter `title`, `source_url`,
  `scraped_at` y `category` (`html_parser.py::markdown_document`).
- El código, la versión, la fecha y el estado solo aparecen dentro del cuerpo (tabla de
  cabecera de GMAS2), no como campos del encabezado.
- Faltan la dirección responsable y la lista de códigos de formatos y normas vinculados.
- No hay fichas MG-P, porque no se cargan.

### RF-C3-IV-06 — Páginas del Observatorio · Parcial

- El encabezado tiene la URL (`source_url`) y la fecha de acceso (`scraped_at`).
- El hash (`content_sha256`) se calcula sobre el texto normalizado, así que es
  determinista. Pero solo vive en `paginas.csv`, no en el encabezado del archivo.

### RF-C3-IV-07 — Umbral de confianza OCR · No cumple

- No existe ninguna medida de confianza: no hay referencias a confidence, hOCR ni TSV.
- El control de calidad es una heurística de "texto basura" (`looksLikeGarbage`), y como
  último recurso se indexa el texto nativo **aunque no pase el control**
  (`documentPreprocessor.ts::extractPdf`). Es lo contrario de descartar.
- El informe de documentos sin texto (`_documentos-sin-texto-*.csv`) se sobrescribe en cada
  construcción del índice y no notifica a nadie.

### RF-C3-IV-08 — Cuándo aplicar OCR · Parcial

- PDF: el OCR se aplica cuando el texto nativo, sin espacios ni separadores de página, tiene
  menos de `OCR_MIN_TEXT_CHARS=80` caracteres. Cumple.
- PDF con 80 caracteres o más pero con la capa de texto "rota" también pasa por OCR
  (`--force-ocr`). Eso contradice "ninguno con 80 o más".
- DOCX: nunca pasa por OCR. Imágenes: no se descargan (`NON_TARGET_ASSET_EXTENSIONS`) ni se
  indexan (`context.ts::SUPPORTED_EXTENSIONS`).
- No hay registro de procesamiento con el conteo nativo y el indicador de OCR por documento.

### RF-C3-IV-09 — Tablas · No cumple

- Las tablas simples de GMAS2 sí se conservan (p. ej. "GENERALIDADES" en GT-P-004).
- Las tablas jqGrid anidadas ("Flujos de trabajo y actividades", "Políticas de operación",
  "Documentos referencia") se aplanan: una tabla de 14 a 26 columnas vacías con toda la
  tabla interna metida en una sola celda, separadores `| --- |` incluidos, y ruido
  "Cargando...". Las filas de actividad, responsable y tiempo no son recuperables como
  tabla.

### RF-C3-IV-10 — Formatos en blanco · No implementado

- No existe ningún control. Una inspección manual de GT-F-011 (.docx) muestra campos vacíos,
  pero los formatos .doc heredados no se revisaron.
- Las páginas GMAS2 de cada formato incluyen el bloque "Crea / Revisa / Aprueba" con nombres
  de funcionarios. Es información institucional pública, no datos de diligenciamiento.

### RF-C3-IV-11 — Matriz documental · Parcial

- Hay dos catálogos: `metadata/documentos.csv` y `metadata/paginas.csv`.
- Cubren la URL de origen, el formato (extensión), la fecha de carga (`downloaded_at` /
  `scraped_at`) y un nombre aproximado (`title` / `link_text`).
- Faltan el código, el tipo (en el sentido del documento: GT-P/GT-F/GT-N/MG-P/MG-F/página),
  la dirección responsable, el estado, la versión, la fecha de última actualización, el
  indicador de OCR y el procedimiento de origen.

### RF-C3-IV-12 — Exportación .xlsx · No implementado

### RNF-C3-IV-01 — Ingesta completa en menos de 2 h · No cumple

- No existe Qdrant: el índice vive en memoria y se persiste como snapshot binario.
- El README estima horas para el scraping y para la indexación del corpus de 13 GB. No hay
  mediciones sobre el corpus acotado.

### RNF-C3-IV-02 — Consultas durante la indexación · Parcial

- La revalidación en proceso (`search.ts::prepareIndex`) sigue sirviendo el índice anterior
  (`state='refreshing'`) y lo conserva si la reconstrucción falla. Cumple.
- El flujo operativo documentado (`make cache`) **detiene el backend** mientras indexa: el
  chat no responde durante toda la reindexación.

### RNF-C3-IV-03 — Retención de 12 meses · No implementado

- No hay política de retención para verificaciones, descartes por OCR ni notificaciones.
  Las notificaciones no existen, y el informe de descartes se sobrescribe.

## Lo que se reutiliza

- La adquisición GMAS2 con renderizado JS, el filtro "Vigente" y la extracción de la
  descarga real de `javascript:downloadFile` (`html_parser.py`).
- La deduplicación por SHA-256 y la validación de firmas de archivo (`downloader.py`).
- La conversión a Markdown de PDF, DOCX, DOC y XLSX, con OCR local y conteo de caracteres
  sin separadores (`documentPreprocessor.ts`).
- La fragmentación estructural con tablas y páginas (`chunking.ts`), que corresponde al
  bloque 2.
- El intercambio atómico del índice en proceso (`search.ts`), como base de RNF-C3-IV-02.
