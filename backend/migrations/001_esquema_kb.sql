-- Esquema de la base de conocimiento (bloque 1). Ver specs/001-base-conocimiento-bloque1/data-model.md.
--
-- El esquema `kb` y los roles kb_writer/app_reader los crea backend/db/init/01-roles.sh;
-- esta migración corre como kb_writer (dueño del esquema) y crea todo lo demás.

-- ── Enumeraciones ───────────────────────────────────────────────────────────

CREATE TYPE kb.tipo_elemento AS ENUM ('procedimiento', 'formato', 'norma', 'pagina', 'documento');
-- 'vencido' queda reservado para RF-C3-AD-38 (bloque 7).
CREATE TYPE kb.estado_elemento AS ENUM ('pendiente_aprobacion', 'publicado', 'derogado', 'vencido');
CREATE TYPE kb.direccion AS ENUM ('ecosistemas', 'bienestar_animal', 'gestion_ambiental', 'secretaria_general');
-- 'manual' queda reservado para RF-C3-AD-01 (bloque 7).
CREATE TYPE kb.origen_elemento AS ENUM ('scraper', 'manual');
CREATE TYPE kb.estado_detectado AS ENUM ('vigente', 'derogado', 'no_aplica');
CREATE TYPE kb.resultado_verificacion AS ENUM ('sin_cambios', 'cambio_detectado', 'nuevo', 'error');
CREATE TYPE kb.tipo_error AS ENUM ('inaccesible', 'http', 'estructura_modificada', 'timeout', 'fuera_de_alcance');
CREATE TYPE kb.decision_procesamiento AS ENUM ('cargado', 'descartado_ocr', 'formato_diligenciado', 'fallo_extraccion');
CREATE TYPE kb.tipo_notificacion AS ENUM (
  'documento_derogado', 'verificacion_fallida', 'descarte_ocr', 'formato_con_datos_personales',
  'texto_nativo_ilegible', 'fuera_de_alcance', 'verificacion_atrasada', 'indexacion_fallida',
  'procedimiento_faltante'
);
CREATE TYPE kb.estado_notificacion AS ENUM ('no_revisada', 'revisada');

-- ── Registro de procesamiento y descartes por OCR (RF-C3-IV-07, IV-08) ───────

CREATE TABLE kb.kb_procesamiento (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clave_elemento      text NOT NULL,          -- código o URL: sobrevive al borrado del elemento
  formato_original    text NOT NULL,
  caracteres_nativos  integer NOT NULL CHECK (caracteres_nativos >= 0),
  ocr_aplicado        boolean NOT NULL,
  confianza_ocr       numeric(5,2) CHECK (confianza_ocr BETWEEN 0 AND 100),
  calidad_nativa_baja boolean NOT NULL DEFAULT false,
  decision            kb.decision_procesamiento NOT NULL,
  detalle             text,                   -- sin rutas ni trazas
  duracion_ms         integer NOT NULL DEFAULT 0,
  fecha               timestamptz NOT NULL DEFAULT now(),
  -- Solo un documento que pasó por OCR puede descartarse por confianza.
  CONSTRAINT descarte_ocr_requiere_ocr CHECK (decision <> 'descartado_ocr' OR ocr_aplicado)
);
CREATE INDEX kb_procesamiento_fecha ON kb.kb_procesamiento (fecha);

-- ── Matriz documental (RF-C3-IV-11) ─────────────────────────────────────────

CREATE TABLE kb.kb_elemento (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clave                 text NOT NULL UNIQUE,   -- código GMAS2 o URL normalizada
  codigo                text,                   -- NULL → "N/A", solo en contenido del Observatorio
  nombre                text NOT NULL,
  tipo                  kb.tipo_elemento NOT NULL,
  direccion             kb.direccion NOT NULL,
  url_origen            text NOT NULL CHECK (url_origen LIKE 'https://%'),
  url_padre             text,                   -- página que enlaza un PDF o descarga (payload de Qdrant)
  url_descarga          text,                   -- archivo descargable de un formato o norma de GMAS2 (enlaces de códigos)
  estado                kb.estado_elemento NOT NULL,
  version_documento     text,                   -- NULL → "N/A"
  fecha_actualizacion   date,                   -- NULL → "N/A"
  formato_original      text NOT NULL,
  ocr_aplicado          boolean NOT NULL DEFAULT false,
  fecha_carga           timestamptz NOT NULL DEFAULT now(),   -- primer registro, también en pendientes (FR-003)
  procedimientos_origen text[] NOT NULL CHECK (cardinality(procedimientos_origen) > 0),
  fuente                text NOT NULL,
  origen                kb.origen_elemento NOT NULL DEFAULT 'scraper',
  version_publicada_id  uuid,
  version_pendiente_id  uuid,
  derogado_en           timestamptz,
  creado_en             timestamptz NOT NULL DEFAULT now(),
  actualizado_en        timestamptz NOT NULL DEFAULT now(),
  -- Solo el contenido del Observatorio admite "N/A" en código, versión y fecha (FR-003).
  CONSTRAINT na_solo_en_observatorio CHECK (
    fuente <> 'gmas2_envigado'
    OR (codigo IS NOT NULL AND version_documento IS NOT NULL AND fecha_actualizacion IS NOT NULL)
  )
);

-- ── Versiones: el contenido es la fuente de verdad (research R2) ────────────

CREATE TABLE kb.kb_version (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  elemento_id      uuid NOT NULL REFERENCES kb.kb_elemento (id) ON DELETE CASCADE,
  hash_contenido   char(64) NOT NULL,
  hash_original    char(64),
  contenido_md     text NOT NULL,
  fecha_acceso     timestamptz NOT NULL,
  metadatos_gmas   jsonb,
  procesamiento_id uuid REFERENCES kb.kb_procesamiento (id) ON DELETE SET NULL,
  creada_en        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (elemento_id, hash_contenido)
);

ALTER TABLE kb.kb_elemento
  ADD CONSTRAINT version_publicada_fk FOREIGN KEY (version_publicada_id) REFERENCES kb.kb_version (id) ON DELETE SET NULL,
  ADD CONSTRAINT version_pendiente_fk FOREIGN KEY (version_pendiente_id) REFERENCES kb.kb_version (id) ON DELETE SET NULL;

-- ── Corridas y verificaciones (RF-C3-IV-02) ─────────────────────────────────

CREATE TABLE kb.kb_corrida (
  id            uuid PRIMARY KEY,               -- run_id del informe
  iniciada_en   timestamptz NOT NULL,
  terminada_en  timestamptz NOT NULL,
  programada    boolean NOT NULL,
  completa      boolean NOT NULL,
  informe       text NOT NULL,
  procesada_en  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX kb_corrida_programada ON kb.kb_corrida (programada, terminada_en);

CREATE TABLE kb.kb_verificacion (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corrida_id       uuid NOT NULL REFERENCES kb.kb_corrida (id) ON DELETE CASCADE,
  url              text NOT NULL,
  elemento_id      uuid REFERENCES kb.kb_elemento (id) ON DELETE SET NULL,
  fecha_hora       timestamptz NOT NULL,
  estado_detectado kb.estado_detectado NOT NULL,
  resultado        kb.resultado_verificacion NOT NULL,
  tipo_error       kb.tipo_error,
  codigo_http      smallint,
  hash_contenido   char(64),
  CONSTRAINT codigo_http_solo_con_http CHECK (codigo_http IS NULL OR tipo_error = 'http'),
  CONSTRAINT error_con_tipo CHECK ((resultado = 'error') = (tipo_error IS NOT NULL))
);
CREATE INDEX kb_verificacion_fecha ON kb.kb_verificacion (fecha_hora);
CREATE INDEX kb_verificacion_url ON kb.kb_verificacion (url, fecha_hora);

-- ── Notificaciones al administrador (FR-018; pantalla en el bloque 7) ───────

CREATE TABLE kb.kb_notificacion (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo         kb.tipo_notificacion NOT NULL,
  objeto       text NOT NULL,
  descripcion  text NOT NULL,
  estado       kb.estado_notificacion NOT NULL DEFAULT 'no_revisada',
  repeticiones integer NOT NULL DEFAULT 1 CHECK (repeticiones >= 1),
  primera_en   timestamptz NOT NULL DEFAULT now(),
  ultima_en    timestamptz NOT NULL DEFAULT now(),
  revisada_por text,
  revisada_en  timestamptz,
  CONSTRAINT revisada_con_datos CHECK ((estado = 'revisada') = (revisada_en IS NOT NULL))
);
-- Agrupa las repetidas del mismo tipo y objeto mientras sigan sin revisar (RF-C3-AD-30).
CREATE UNIQUE INDEX kb_notificacion_agrupada ON kb.kb_notificacion (tipo, objeto) WHERE estado = 'no_revisada';
CREATE INDEX kb_notificacion_estado ON kb.kb_notificacion (estado, ultima_en DESC);

-- ── Construcciones de la colección de Qdrant (RNF-C3-IV-01, IV-02) ──────────

CREATE TABLE kb.kb_indexacion (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo                text NOT NULL CHECK (tipo IN ('completa', 'incremental')),
  coleccion           text NOT NULL,
  estado              text NOT NULL CHECK (estado IN ('en_curso', 'terminada', 'fallida')),
  iniciada_en         timestamptz NOT NULL DEFAULT now(),
  terminada_en        timestamptz,
  duracion_etapas_ms  jsonb,
  puntos_esperados    integer,
  puntos_indexados    integer,
  avgdl               real,
  detalle             text
);
-- Como máximo una reindexación en curso (anticipa RF-C3-AD-47).
CREATE UNIQUE INDEX kb_indexacion_una_en_curso ON kb.kb_indexacion ((true)) WHERE estado = 'en_curso';

-- ── Auditoría de acciones del operador (anticipa RF-C3-AD-41) ──────────────

CREATE TABLE kb.kb_auditoria (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor     text NOT NULL,
  accion    text NOT NULL,
  objeto    text NOT NULL,
  resultado text NOT NULL,
  fecha     timestamptz NOT NULL DEFAULT now()
);

-- ── Ejecuciones de la retención (RNF-C3-IV-03) ──────────────────────────────

CREATE TABLE kb.kb_purga (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ejecutada_en    timestamptz NOT NULL DEFAULT now(),
  filas_por_tabla jsonb NOT NULL
);

-- ── Vistas ──────────────────────────────────────────────────────────────────

-- Las 12 columnas de RF-C3-IV-11 tal como se exportan (contracts/matriz-xlsx.md).
CREATE VIEW kb.v_matriz AS
SELECT
  e.id,
  COALESCE(e.codigo, 'N/A')                                           AS codigo,
  e.nombre,
  CASE e.tipo
    WHEN 'procedimiento' THEN 'Procedimiento' WHEN 'formato' THEN 'Formato'
    WHEN 'norma' THEN 'Norma' WHEN 'pagina' THEN 'Página' ELSE 'Documento' END AS tipo,
  CASE e.direccion
    WHEN 'ecosistemas' THEN 'Ecosistemas' WHEN 'bienestar_animal' THEN 'Bienestar Animal'
    WHEN 'gestion_ambiental' THEN 'Gestión Ambiental' ELSE 'Secretaría (general)' END AS direccion,
  e.url_origen,
  CASE e.estado
    WHEN 'pendiente_aprobacion' THEN 'Pendiente de aprobación' WHEN 'publicado' THEN 'Publicado'
    WHEN 'derogado' THEN 'Derogado' ELSE 'Vencido' END                 AS estado,
  COALESCE(e.version_documento, 'N/A')                                AS version,
  COALESCE(to_char(e.fecha_actualizacion, 'DD/MM/YYYY'), 'N/A')       AS fecha_actualizacion,
  upper(e.formato_original)                                           AS formato_original,
  CASE WHEN e.ocr_aplicado THEN 'Sí' ELSE 'No' END                     AS uso_ocr,
  to_char(e.fecha_carga AT TIME ZONE 'America/Bogota', 'DD/MM/YYYY HH24:MI') AS fecha_carga,
  array_to_string(e.procedimientos_origen, ', ')                      AS procedimiento_origen,
  e.tipo                                                              AS tipo_interno,
  e.fuente
FROM kb.kb_elemento e;

-- Única lectura permitida al backend del chat (rol app_reader, research R13/R17).
-- Un formato enlaza a su archivo descargable si lo hay; si no, a su página en GMAS2.
CREATE VIEW kb.v_codigos_publicados AS
SELECT codigo, COALESCE(url_descarga, url_origen) AS url
  FROM kb.kb_elemento WHERE estado = 'publicado' AND codigo IS NOT NULL;

GRANT SELECT ON kb.v_codigos_publicados TO app_reader;
