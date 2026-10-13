# Línea base de implementación SPEC007

Fecha: 2026-10-10 · Rama Git: `develop` (sin commits de los bloques 001–007; árbol de trabajo compartido con el agente de SPEC006) · Node v26.11.0.

Este documento registra el estado leído al empezar T001. No es informe de cumplimiento.

## Pendientes registrados en SPEC001–006 (conteo de IDs `- [x]` / `- [ ]` leído de cada `tasks.md`)

| Spec | Marcadas | Pendientes (IDs únicos) |
| --- | --- | --- |
| 001 | 89 | T082, T083, T092 |
| 002 | 94 | T088, T091–T098, T102 (más tareas con IDs repetidos en tablas de dependencias) |
| 003 | 35 | T035 |
| 004 | 77 | T078–T084 |
| 005 | 73 | T074–T082 (continuidad.md registraba 49/82 el 2026-10-10; avanzó SPEC005) |
| 006 | 4 | T005–T067 (otro agente trabaja SPEC006; no se tocan sus marcas) |

Diferencia con `continuidad.md`: SPEC005 pasó de 49/82 a 73/82 marcadas y SPEC006 de 0/67 a 4/67. No se modificó ninguna marca ajena.

## Superficies existentes (confirmadas por lectura)

- Migraciones: `backend/migrations/001..004` (KB) y `backend/migrations/chat/001..008` (chat + esquema `admin`). Siguientes libres: KB `005`, chat `009`. No existe `backend/migrations/admin/`.
- Panel: `backend/src/admin/{auth,sessions,passwords,db,contacts,audit,operations,serviceEvents,bootstrapCli}.ts`, rutas `adminAuth/adminContacts/adminOperations`, frontend `app/admin/{login,password,contacts,notifications,status}`.
- Bloqueo de IP en memoria (`auth.ts`): no sobrevive reinicio ni concurrencia entre procesos → se corrige en T017/T019.
- Bloqueo de cuenta no emite aviso de sistema → brecha RNF-C3-AD-04, se corrige en T019.
- `requireAdmin` conserva un *overlay* de sesión en memoria con la base caída → se retira (plan: DB caída → 503).
- Reglas de la matriz KB (`kb.kb_elemento`/`kb.kb_version`) y calibración existentes: se amplían, no se reemplazan.

## Dependencias nuevas (T002)

Busboy 1.6.0 (multipart en streaming) y ExcelJS 4.4.0 (XLSX en streaming); SheetJS de la matriz 001 se conserva.

## Entorno local de verificación

PostgreSQL 16 en `127.0.0.1:55432` (`geobot_admin`/`dev-admin`) y Qdrant 1.19.2 en `127.0.0.1:56333`, ambos aislados; cada suite crea su propia base. Ningún dato real ni producción.
