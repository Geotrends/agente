# Gate de la fase de cimientos (T017)

**Fecha**: 2026-10-08. Todo lo de aquí es evidencia **local con dobles** (`adapter=double`): no es aceptación de AWS ni revisión funcional.

## Mecanismos nuevos

| Tarea | Mecanismo | Archivos |
|---|---|---|
| T006 | Contratos del chat en español, pares de historial, resultado interno del modelo | `backend/src/chat/contracts.ts`, `shared/chatHistory.ts`, `shared/llmTypes.ts` |
| T007/T008/T009 | Migrador propio (roles `chat_owner` sin login, `chat_app`, `admin_app`, `chat_maint`), registro `chat.schema_migrations` separado de `kb.*`, esquemas `chat` y `admin` | `src/chat/migrate.ts`, `migrations/chat/001_base_contactos.sql`, `002_identidad.sql`, `db/bootstrap-chat-admin.sh`, servicio `chat-migrate` en `docker-compose.yml` |
| T010 | argon2id 64 MiB / 3 / 1, bootstrap por stdin/TTY | `src/admin/passwords.ts`, `scripts/bootstrap-admin.ts` |
| T011 | Validadores y snapshot de contactos (REPEATABLE READ, sin caché) | `src/admin/contacts.ts` |
| T012 | Sesiones opacas (hash en BD), CSRF derivado, bloqueos 5/15 y 20/15, dos perfiles | `src/admin/{auth,sessions,audit}.ts`, `src/routes/adminAuth.ts` |
| T013 | Plazo único cancelable y errores públicos de catálogo | `src/chat/deadline.ts`, `src/chat/errors.ts`, `src/index.ts` |
| T014 | Perímetro: origen, ventana deslizante 60/min/IP, cuerpo ≤131072 B en streaming, `GET /api/chat/config` | `src/chat/perimeter.ts`, `src/routes/chatConfig.ts`, `src/routes/chat.ts` |

## Desviaciones de `tasks.md` (con motivo)

- **Numeración de migraciones**: `tasks.md` nombra `002_chat_admin_base.sql`, `003_admin_identidad.sql`…, pero `backend/migrations/` ya tiene `002_corrida_estado.sql` y `003_procesamiento_por_corrida.sql` aplicadas por el runner de la KB, que aplica *todo* `NNN_*.sql` de esa carpeta como `kb_writer`. Para no renumerar ni mezclar registros, las nuevas viven en `backend/migrations/chat/` con numeración propia (`001`, `002`…) y su propio registro. El runner de la KB ignora subcarpetas.
- **Sesiones en BD, sin caché**: la tabla `admin.session` es la autoridad y se consulta en cada solicitud; así la revocación es inmediata. El overlay volátil con la BD caída (T066) queda para US4.
- **Contador de IP en memoria**: válido mientras haya un único runtime (así lo fija `admin-api.md`).
- **`docker-compose.yml`**: se añadió `chat-migrate` y las URLs de BD del backend; `.env` sigue siendo la fuente de la configuración nueva (`env_file`).
- **La ruta `/api/chat` heredada sigue activa**: solo se le puso el perímetro nuevo (el límite pasó de 20 a 60/min/IP y el cuerpo a 128 KiB). Su límite de 2.500 caracteres y los proveedores antiguos se retiran en T044/T058. La prueba de 20.000 caracteres de T016 valida el perímetro, no ese manejador.

## Resultados

| Verificación | Resultado |
|---|---|
| `npx tsc -p tsconfig.check.json` | sin errores |
| `npm test` (unitarias) | 281/281 |
| `npm run test:di-integration` (PostgreSQL 16 real, local) | 22/22: migrador (3), seguridad del panel (9), perímetro (7), arnés (3) |
| `npm run test:integration` (`http-smoke.ts`) | **retirada más tarde (ver `integracion-final.md`)**: probaba el contrato heredado (`message`, `provider`, `/providers`, límite de 2.500 caracteres) y llamaba a proveedores externos. La reemplazan `retrieval-publication.test.ts`, `us5-answer.test.ts` y `consent.test.ts`, con Qdrant y modelos locales reales |
| Migración sobre volumen limpio y con `kb` existente | cubierto por `migrations.test.ts` (base nueva y base con `kb.demo` intacto) |

Cobertura de T015: migrador, permisos negativos, último técnico concurrente, bootstrap sin filtración, hashing/sal, bloqueos de cuenta e IP (19+éxito+5, 20→429 sin verificar clave), sesión 29/31 min, CSRF/Origin, cambio temporal, Gestor 403.
Cobertura de T016: config ≤2 s ×3 y cambio visible sin caché, 503 sin datos oficiales, orígenes, 62→60/2, proxy con IP real a la derecha, 128 KiB / 128 KiB+1 (también chunked), 20.000 caracteres sin truncar, rechazos sin llegar al manejador, plazo con cola.

## Pendiente (no se declara cumplido)

Modelos Bedrock, calibración, tokenizador, evaluación integral, revisión funcional y carga real siguen sin hacerse. Prueba bajo `docker compose` del servicio `chat-migrate` y de las imágenes: pendiente (T089).
