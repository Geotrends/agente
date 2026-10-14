# Data Model — SPEC008

Solo cambios mínimos sobre el modelo de SPEC001/SPEC007 (migraciones aditivas, reversibles).

## `kb.document_operation` (existente) — columnas nuevas

| Campo | Tipo | Regla |
|---|---|---|
| `target_version_id` | uuid NULL → `kb.kb_version(id)` | Fijada al encolar `publish`/`replace`; el commit exige `version_pendiente_id = target_version_id` |
| `cleanup_attempts` | int NOT NULL DEFAULT 0 | Se incrementa en cada fallo transitorio de limpieza/retiro |
| `next_attempt_at` | timestamptz NULL | La cola ignora la operación hasta esa hora |
| `needs_attention` | boolean NOT NULL DEFAULT false | Verdadero al agotar los reintentos rápidos; visible en el panel |

**Transiciones**: `queued → preparing → prepared → committed → reconciling → cleaning → complete`. Fallo transitorio en `cleaning`/retiro: permanece en la fase, fija `next_attempt_at`. Fallo determinístico o `candidata_cambiada`: `failed` con `error_code`.

## `kb.kb_elemento` (existente)

| Campo | Cambio |
|---|---|
| `version_aplazada_id` | NUEVO uuid NULL → `kb.kb_version(id)`. Versión recibida durante una operación activa; pasa a pendiente al terminar la operación |
| `version_publicada_fk` | `ON DELETE SET NULL` → `ON DELETE RESTRICT` |

**Invariantes**: `version_aplazada_id` ≠ `version_publicada_id`; una versión nunca se elimina mientras sea `version_publicada_id` de algún elemento.

## `admin.session` (existente)

| Campo | Cambio |
|---|---|
| `absolute_expires_at` | NUEVO timestamptz NOT NULL = `created_at + 8 h`; la sesión es inválida al pasar esa hora aunque haya actividad |

## Estado de topes del chat (archivo JSON, existente)

Sin cambio de esquema (`version: 1`); `day` pasa a ser el día de America/Bogotá (`YYYY-MM-DD`). Un archivo con día en UTC se trata como del día vigente por lo que queda a lo sumo un ciclo con contadores reiniciados.

## Estructuras sin persistencia

- **Tope temporal en memoria**: `Map<ipKey, number>` y contador global por proceso, solo cuando el archivo de estado falla (FR-002a).
- **Caché de extracción**: LRU de 16 entradas, TTL 10 min.
