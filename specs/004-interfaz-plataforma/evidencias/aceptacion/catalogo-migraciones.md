# Catálogo de migraciones del chat (T009)

Verificado 2026-10-10 contra PostgreSQL 16.13 local aislado (datadir temporal, puerto 55432; no se usó ningún volumen del usuario) con `backend/test/di-integracion/migrations.test.ts` (3/3 ✔: idempotente, base existente con `kb`, contraseñas cortas) y con las pruebas de T008.

## Aplicadas por el migrador (`backend/src/chat/migrate.ts`)

| Ordinal | Archivo | Contenido | Estado |
| --- | --- | --- | --- |
| 001 | `001_base_contactos.sql` | contactos administrables (`admin.contact_*`) | existente, sin modificar |
| 002 | `002_identidad.sql` | cuentas, sesiones y auditoría de panel | existente, sin modificar |
| 003 | `003_conversacion.sql` | `chat.conversation` (sin texto; `clarification_pending` booleano) | existente, sin modificar |
| 004 | `004_registro_tarifas.sql` | `chat.interaction`, `chat.anonymous_usage`, `chat.tariff` | existente, sin modificar |
| 005 | `005_retencion.sql` | `chat.purge_run`, permisos de purga | existente, sin modificar |
| 006 | `006_operacion.sql` | estado de componentes y notificaciones | existente, sin modificar |
| **007** | `007_valoracion.sql` | `chat.valoracion` + función `chat.register_rating` (SECURITY DEFINER, `search_path` fijo) | **aplicada por T065** (ordinal definitivo; no se renumeró nada) |

Registro propio `chat.schema_migrations`, separado del catálogo de la KB. Cada migración corre con `SET LOCAL ROLE chat_owner` en su transacción. Idempotente sobre volumen limpio y existente.

## Equivalencia de nombres físicos

| Modelo SPEC004 (lógico) | Físico |
| --- | --- |
| `chat.conversacion` | `chat.conversation` |
| `chat.interaccion` | `chat.interaction` (`row_id` bigint identity, `response_id` uuid UNIQUE) |
| `chat.valoracion.interaccion` | `chat.valoracion.interaction_row_id` → `chat.interaction.row_id` |

No se crean tablas duplicadas para traducir nombres.

## Roles y permisos (runtime)

| Rol | Sobre `chat.interaction` | Sobre `chat.conversation` |
| --- | --- | --- |
| `chat_app` | INSERT | SELECT, INSERT, UPDATE(clarification_pending, last_active_at) |
| `chat_maint` | SELECT, UPDATE(question_text, answer_text, conversation_id, response_id, cited_documents, purged_at) | SELECT, DELETE |
| `admin_app` | SELECT | — |

Ningún rol del runtime tiene DDL ni superusuario (`NOSUPERUSER NOCREATEDB NOCREATEROLE`, `search_path` sin `public`).

## Implicaciones para la valoración (T065/T068)

- La purga **no borra** la fila de `chat.interaction`: vacía textos e identificadores y fija `purged_at`. Una FK `interaction_row_id → interaction.row_id` no bloquea la purga.
- Una valoración sobre una interacción depurada debe rechazarse (`purged_at IS NOT NULL` o `response_id IS NULL`).
- `chat_app` necesitará `SELECT` sobre `chat.interaction` filtrado por `response_id`/conversación y `INSERT` en `chat.valoracion`; ningún `UPDATE/DELETE` sobre esta.

## Migración 007 (T065) — decisiones

- `interaction_row_id` (FK no nula a `chat.interaction.row_id`, UNIQUE), `valoracion` CHECK `Útil`/`No útil`, `motivo` CHECK de los cinco motivos, `created_at` servidor; CHECK conjunto: «Útil» ⇒ motivo NULL; «No útil» ⇒ motivo no nulo.
- El runtime (`chat_app`) **no** tiene INSERT/SELECT directo sobre `chat.valoracion` ni SELECT sobre `chat.interaction`: solo `EXECUTE` de `chat.register_rating(responseId, bindingHash, valoracion, motivo)`, que resuelve propiedad y vigencia con `FOR SHARE` (compatible con la purga) y escribe de forma atómica. `admin_app` y `chat_maint` solo `SELECT`.
- Sin texto libre, IP, token ni identificadores públicos duplicados.
- Verificado: limpia → 007 última; existente 001–006 con datos → solo 007 se aplica; segunda ejecución sin cambios (`feedback-database.test.ts`).

## Pendiente de acreditar

- Aplicación sobre el volumen real existente del usuario (solo en despliegue autorizado; T081).
