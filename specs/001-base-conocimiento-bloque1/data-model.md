# Data Model: Base de conocimiento institucional (Bloque 1)

**Feature**: [spec.md](./spec.md) · **Decisiones**: [research.md](./research.md)

## Organización

- Todo vive en el esquema `kb` de PostgreSQL.
- Las fechas se guardan en `timestamptz` y se muestran en `America/Bogota`.
- Los valores "N/A" de la matriz no se almacenan: son `NULL` y se presentan como "N/A" en la
  vista y en la exportación. Solo `codigo`, `version_documento` y `fecha_actualizacion` pueden
  ser `NULL`, y solo en el contenido del Observatorio (FR-003).
- La lista de hosts permitidos y el mapa de direcciones viven en el archivo de configuración
  versionado (R11), no en tablas: solo cambian con un despliegue (RF-C3-AD-15).

## Enumeraciones

| Enum | Valores |
|---|---|
| `kb.tipo_elemento` | `procedimiento`, `formato`, `norma`, `pagina`, `documento` |
| `kb.estado_elemento` | `pendiente_aprobacion`, `publicado`, `derogado` (reservados para el bloque 7: `vencido`) |
| `kb.direccion` | `ecosistemas`, `bienestar_animal`, `gestion_ambiental`, `secretaria_general` |
| `kb.origen_elemento` | `scraper` (reservado para el bloque 7: `manual`) |
| `kb.estado_detectado` | `vigente`, `derogado`, `no_aplica` (páginas sin estado) |
| `kb.resultado_verificacion` | `sin_cambios`, `cambio_detectado`, `nuevo`, `error` |
| `kb.tipo_error` | `inaccesible`, `http`, `estructura_modificada`, `timeout`, `fuera_de_alcance` (con `http`, el código va en `kb_verificacion.codigo_http`) |
| `kb.decision_procesamiento` | `cargado`, `descartado_ocr`, `formato_diligenciado`, `fallo_extraccion` |
| `kb.tipo_notificacion` | `documento_derogado`, `verificacion_fallida`, `descarte_ocr`, `formato_con_datos_personales`, `texto_nativo_ilegible`, `fuera_de_alcance`, `verificacion_atrasada`, `indexacion_fallida`, `procedimiento_faltante` |
| `kb.estado_notificacion` | `no_revisada`, `revisada` |

## Entidades

### kb_elemento — fila de la matriz documental (RF-C3-IV-11)

Un documento o una página de la base. **Identidad estable**: el código, para GMAS2, o la URL
de origen normalizada, para el resto.

| Campo | Tipo | Matriz (IV-11) | Notas |
|---|---|---|---|
| `id` | uuid PK | — | |
| `clave` | text UNIQUE | — | código (`GT-P-004`) o URL normalizada |
| `codigo` | text NULL | Código | `NULL` → "N/A", solo en el contenido del Observatorio (páginas y PDF) |
| `nombre` | text | Nombre | |
| `tipo` | `tipo_elemento` | Tipo | |
| `direccion` | `direccion` | Dirección responsable | según R11 |
| `url_origen` | text | URL de origen | solo https y host permitido (R11) |
| `url_padre` | text NULL | — | página que enlaza un PDF o descarga (payload `url_padre`) |
| `url_descarga` | text NULL | — | archivo descargable de un formato o norma de GMAS2; lo usa el enlazado de códigos |
| `estado` | `estado_elemento` | Estado | |
| `version_documento` | text NULL | Versión | la de GMAS2 ("06"); `NULL` → "N/A" |
| `fecha_actualizacion` | date NULL | Fecha de última actualización | la de GMAS2; `NULL` → "N/A" |
| `formato_original` | text | Formato original | `html`, `pdf`, `docx`, `doc`, `xlsx`, `xls`, `png`, `jpg`, `tiff` |
| `ocr_aplicado` | boolean | Indicador de uso de OCR | de la versión publicada |
| `fecha_carga` | timestamptz | Fecha de carga | fecha del primer registro en la base; también en los pendientes (FR-003) |
| `procedimientos_origen` | text[] | Procedimiento de origen | códigos GT-P; en el contenido del Observatorio, el nombre de la fuente (`{"Ambientómetro"}`, `{"Envigado.gov.co"}`, `{"Observatorio Geotrends"}`). Nunca vacío |
| `fuente` | text | — | `gmas2_envigado`, `ambientometro`, `envigado_com`, `observatorio_geotrends` |
| `origen` | `origen_elemento` | — | |
| `version_publicada_id` | uuid NULL FK → kb_version | — | |
| `version_pendiente_id` | uuid NULL FK → kb_version | — | |
| `derogado_en` | timestamptz NULL | — | RF-C3-IV-03 |
| `creado_en`, `actualizado_en` | timestamptz | — | |

**Reglas de validación**:

- Un elemento solo existe si cumple la regla de alcance (RF-C3-IV-01):
  - es uno de los 6 GT-P;
  - o es un vinculado de un GT-P, y en ese caso `procedimientos_origen` no está vacío;
  - o pertenece a una fuente del Observatorio autorizada.
- Un MG solo existe si al menos un GT-P de la base lo cita. Su `procedimientos_origen`
  incluye ese GT-P.
- `procedimientos_origen` nunca está vacío (CHECK `cardinality(procedimientos_origen) > 0`).
- `codigo`, `version_documento` y `fecha_actualizacion` solo pueden ser `NULL` si `fuente` no
  es `gmas2_envigado`.
- Un `formato` solo puede quedar `publicado` si su versión tiene `decision = cargado`
  (RF-C3-IV-10).
- Solo se recupera lo que está `publicado`. Lo que está `derogado` o
  `pendiente_aprobacion` nunca tiene puntos en la colección del alias (RF-C3-IV-03).

**Transiciones de estado**:

```text
(nuevo en una corrida) ──► pendiente_aprobacion ──[kb publicar]──► publicado
publicado ──[corrida: cambio_detectado]──► publicado + version_pendiente_id (la publicada sigue en uso)
publicado | pendiente_aprobacion ──[corrida: estado_detectado = derogado]──► derogado (+ notificación)
derogado ──[corrida: vuelve a vigente]──► pendiente_aprobacion (requiere publicar de nuevo)
cualquiera ──[sale del alcance: ningún GT-P lo vincula]──► fila eliminada + notificación fuera_de_alcance + auditoría
```

Al publicar una versión pendiente, se borra la versión publicada anterior y sus puntos
(R2/R4).

### kb_version — contenido de una versión (fuente de verdad, R2)

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `elemento_id` | uuid FK → kb_elemento | |
| `hash_contenido` | char(64) | SHA-256 del contenido normalizado (RF-C3-IV-06) |
| `hash_original` | char(64) NULL | SHA-256 del archivo descargado |
| `contenido_md` | text | ficha (RF-C3-IV-05) o página (RF-C3-IV-06) con su encabezado |
| `fecha_acceso` | timestamptz | fecha de la extracción |
| `metadatos_gmas` | jsonb NULL | código, nombre, versión, fecha, estado, dependencia, vinculados (R9) |
| `procesamiento_id` | uuid FK → kb_procesamiento | |
| `creada_en` | timestamptz | |

**Unicidad**: (`elemento_id`, `hash_contenido`). Una corrida sin cambios no crea versión.

### kb_procesamiento — registro de procesamiento y descartes por OCR (RF-C3-IV-07, IV-08)

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `clave_elemento` | text | código o URL, para sobrevivir al borrado del elemento |
| `formato_original` | text | |
| `caracteres_nativos` | integer | conteo de R7 |
| `ocr_aplicado` | boolean | |
| `confianza_ocr` | numeric(5,2) NULL | media por palabra (R6), entre 0 y 100 |
| `calidad_nativa_baja` | boolean | caso límite de R7 |
| `decision` | `decision_procesamiento` | |
| `detalle` | text NULL | sin rutas ni trazas |
| `duracion_ms` | integer | |
| `fecha` | timestamptz | |

**Regla**: `decision = descartado_ocr` ⇔ `ocr_aplicado` y `confianza_ocr <= 80` (o el umbral
configurado, nunca menor que 80).

**Retención**: al menos 12 meses (R14).

### kb_corrida y kb_verificacion — vigilancia de enlaces (RF-C3-IV-02)

**kb_corrida**:

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | igual al `run_id` del informe |
| `iniciada_en`, `terminada_en` | timestamptz | |
| `programada` | boolean | `false` si se lanzó a mano |
| `informe` | text | nombre del archivo procesado |
| `procesada_en` | timestamptz NULL | |

**kb_verificacion**:

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `corrida_id` | uuid FK → kb_corrida | |
| `url` | text | |
| `elemento_id` | uuid NULL | `NULL` si el enlace aún no es elemento |
| `fecha_hora` | timestamptz | |
| `estado_detectado` | `estado_detectado` | |
| `resultado` | `resultado_verificacion` | |
| `tipo_error` | `tipo_error` NULL | |
| `codigo_http` | smallint NULL | solo con `tipo_error = http` |
| `hash_contenido` | char(64) NULL | |

**Regla**: el vigilante emite `verificacion_atrasada` si
`max(kb_corrida.terminada_en where programada) < now() - 7 days`.

**Retención**: al menos 12 meses.

### kb_notificacion — notificaciones al administrador

Persistidas ahora; se muestran en el bloque 7 (RF-C3-AD-28).

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `tipo` | `tipo_notificacion` | |
| `objeto` | text | código, URL o id de la corrida o indexación |
| `descripcion` | text | sin rutas, trazas ni datos personales |
| `estado` | `estado_notificacion` | |
| `repeticiones` | integer | agrupa las repetidas del mismo `tipo` y `objeto` mientras siga `no_revisada` |
| `primera_en`, `ultima_en` | timestamptz | |
| `revisada_por`, `revisada_en` | text NULL, timestamptz NULL | |

**Índice único parcial**: (`tipo`, `objeto`) WHERE `estado = 'no_revisada'`. Así se agrupa
sin duplicar.

**Retención**: las revisadas, al menos 12 meses; las no revisadas nunca se purgan.

### kb_indexacion — construcciones de la colección (RNF-C3-IV-01, IV-02)

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `tipo` | text | `completa` o `incremental` |
| `coleccion` | text | `kb_chunks_<marca>` |
| `estado` | text | `en_curso`, `terminada` o `fallida` |
| `iniciada_en`, `terminada_en` | timestamptz | |
| `duracion_etapas_ms` | jsonb | conversión, OCR, embeddings, indexación (R19) |
| `puntos_esperados`, `puntos_indexados` | integer | |
| `avgdl` | real | longitud media para BM25 (R3) |

**Regla**: como máximo una fila `en_curso` (índice único parcial). Anticipa RF-C3-AD-47.

### kb_auditoria — acciones del operador

Anticipa RF-C3-AD-41.

| Campo | Tipo |
|---|---|
| `id` | uuid PK |
| `actor` | text (usuario del sistema operativo o rol de base de datos) |
| `accion` | text (`publicar`, `exportar_matriz`, `purgar`, `reindexar`, `eliminar_fuera_de_alcance`) |
| `objeto` | text |
| `resultado` | text |
| `fecha` | timestamptz |

No guarda contenido de documentos.

### kb_purga — ejecuciones de la retención (RNF-C3-IV-03)

| Campo | Tipo |
|---|---|
| `id` | uuid PK |
| `ejecutada_en` | timestamptz |
| `filas_por_tabla` | jsonb |

### Vista `kb.v_matriz`

Presenta las 12 columnas de RF-C3-IV-11 con "N/A" donde corresponda. La usa la exportación
(RF-C3-IV-12).

### Vista `kb.v_codigos_publicados`

Columnas: `codigo` y `url` (= `url_descarga` si existe, si no `url_origen`) de los
elementos `publicado` con código. Es la única
lectura del rol `app_reader` (R13, R17).

## Colección de Qdrant (derivada)

El esquema completo está en [contracts/qdrant-coleccion.md](./contracts/qdrant-coleccion.md).

- Un punto por fragmento de la **versión publicada** de cada elemento publicado.
- **Identidad del punto**: `uuidv5(version_id + nº de fragmento)`.

## Relaciones

```text
kb_elemento 1 ──< kb_version (0..2 vivas: publicada y pendiente)
kb_version  1 ── 1 kb_procesamiento
kb_corrida  1 ──< kb_verificacion >── 0..1 kb_elemento
kb_elemento (procedimiento) ─< procedimientos_origen >─ kb_elemento (vinculados)  [por código]
kb_indexacion ── 1 colección de Qdrant
```
