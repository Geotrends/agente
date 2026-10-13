# Research — SPEC007 Administración

Fecha: 2026-10-10. RF-C3-AD-01..48, RF-C4-AD-01..05, RNF-C3-AD-01..09. Fase 0 terminada: decisiones de diseño resueltas; disponibilidad de producción/personas es requisito de ejecución, no incógnita arquitectónica.

Se despacharon tres investigaciones de solo lectura: acceso/operación; documentación/scraper; datos/interacciones/UI. Se contrastaron con spec, constitución, los seis planes/tareas y superficies reales. La rama del script setup identifica la feature como `007-administracion-c3-c4`; `git branch --show-current` identifica rama real `develop`. No se crea rama durante planificación.

## R01 — Ampliar servicios y mantener contratos existentes

**Decision**: Express/TypeScript y Next/React estático actuales; panel bajo `/admin`, API `/api/admin`, cookie opaca/CSRF existente; no servicio Python público ni segunda sesión. PostgreSQL 16 conserva `kb`, `admin`, `chat`; worker KB escribe documentación. Agregar migraciones numeradas posteriores a las existentes, sin editar migraciones aplicadas. Separar migraciones administrativas en `backend/migrations/admin/` y ampliar runner existente para ledger/roles idempotentes; cambios KB en numeración raíz siguiente, cambios de chat en numeración chat siguiente.

**Rationale**: Panel mínimo existe en `src/admin`, rutas administrativas y `frontend/app/admin`. Matriz/versiones/publicación están en `src/kb`; registro/tarifas/valoración en `src/chat`. La separación conserva dueños SPEC001/002/004/005.

**Alternatives considered**: Panel/BD nuevos duplican políticas; adoptar rutas dinámicas exportadas requiere catálogo completo en build o servidor nuevo. Se eligen páginas estáticas con detalle en estado cliente; no IDs/textos ciudadanos en URL. Next documenta limitaciones de rutas y funciones servidor en [Static exports](https://nextjs.org/docs/app/guides/static-exports).

## R02 — Identidad, concurrencia y actividad

**Decision**: Mantener argon2id/sal única y parámetros vigentes 65536 KiB, tres pasadas/un hilo, mínimo doce caracteres Unicode por puntos de código. Correo normalizado único; nombre no vacío **no único**. Añadir revisión CAS de cuenta, bloqueo de fila para contadores y revocación transaccional al desactivar/cambiar perfil/asignar temporal/recuperar. Conservar y probar trigger de último administrador, incluyendo concurrencia. Quitar overlay de autorización con DB caída: no entregar datos si no se valida sesión vigente. RNF01..06/AD05..13.

**Rationale**: `002_identidad.sql` y tests DI ya protegen último administrador, no se reconstruye. `auth.ts` puede perder incrementos concurrentes y bloqueo solo escribe auditoría. `sessions.ts` contiene overlay incompatible con recuperación fuera del proceso. Son correcciones del mismo dueño.

**Alternatives considered**: Cache de permisos desactualizada no prueba revocación. Tercer perfil «contratista» contradice dos perfiles; rol DB reservado es operativo. Persistir guardia de IP hash en PostgreSQL existente evita reinicios/réplicas que reinicien conteo; sin Redis. Transacciones/locks deben mantener orden IP→cuenta para evitar deadlocks, conforme [PostgreSQL locking](https://www.postgresql.org/docs/16/explicit-locking.html).

El servidor conserva literal treinta minutos sin ninguna solicitud válida; UI suspende autoactualización tras sesenta segundos sin interacción humana, al ocultarse y al quedar bloqueada por cambio de contraseña, y cierra localmente tras treinta minutos de inactividad humana con revocación best effort. Polling no simula clics. Cada request real renueva el servidor; prueba backend a 29/31 min se hace sin polling y prueba UI verifica cese efectivo y cierre, sin header que suprima actividad.

## R03 — Bootstrap y recuperación reservada

**Decision**: Acotar bootstrap a base sin administrador inicial; no upsert para reemplazar/reanimar cuenta existente. Procedimiento `admin.recover_password(email, temporary_phc)` exactamente dos parámetros, SECURITY DEFINER owner sin login, rol `contractor_recovery` exclusivo, PUBLIC/runtime sin EXECUTE, search_path seguro y objetos cualificados. No endpoint web. Utilidad operativa restringida genera PHC por stdin/TTY, nunca argv/env/log; CALL parametrizado, no contraseña ni hash en respuestas/auditoría. Procedimiento revoca sesiones/marca cambio obligatorio/no modifica perfil ni activa una desactivada.

**Rationale**: `bootstrapCli.ts` actual permite reemplazos sin auditoría/revocación; no acredita AD13. Procedimiento SQL no puede guardar auditoría en transacción que luego revierte por error. Flujo soportado: wrapper restringido invoca CALL; éxito deja una auditoría en la misma transacción; si falla, tras rollback el wrapper escribe **una** fila segura de resultado rechazado en transacción separada mediante función restringida. Sin log de parámetros a nivel DB. Rol/credencial solo disponible al runner operativo aprobado, no consola del runtime. Si no se pudo auditar ejecución rechazada, evidencia pendiente y operación no se considera verificada.

**Alternatives considered**: Recuperación por bootstrap/HTTP viola exclusividad. Simular error como éxito para guardar auditoría viola «termine con error». Auditoría autónoma dentro de procedimiento no se promete; PostgreSQL explica restricciones de [CREATE PROCEDURE](https://www.postgresql.org/docs/16/sql-createprocedure.html) y precauciones de privilegios/[search_path](https://www.postgresql.org/docs/16/sql-createfunction.html). Manual operativo define wrapper como única vía soportada y recepción verifica éxitos/rechazos, actor real y ausencia de PHC. No se entrega credencial general de DB a la aplicación.

## R04 — Publicación sin fragmentos prematuros

**Decision**: Toda publicación/reindexación usa colección candidata completa del constructor SPEC001 y operación durable. SQL mantiene `active_generation`/colección física como autoridad de versión, con commit único de metadata vigente/versiones/manifest. Lectores obtienen colección concreta y proyección vigente por consulta; `kb_chunks` sigue espejo de compatibilidad reconciliable, no autoridad independiente. No transacción distribuida ficticia. Preparación no toca colección activa; exactamente un reintento de indexación tras limpiar/verificar parciales. Estado visible En curso hasta concluir corte y limpieza confirmada; fallo de preparación conserva anterior, fallo tras commit solo reanuda reconciliación/limpieza.

**Rationale**: `service.publicar()` escribe payload publicado en colección activa antes de aprobar SQL; `reconstruirColeccion()` cambia alias antes de SQL y su catch puede borrar candidata ya activa. `search.ts` ya recibe colección opcional: migrar todos los lectores/prepareIndex/calibration/documentLinks y arneses al mismo snapshot autoritativo. Worker existente procesa cola SQL, sin broker nuevo.

**Alternatives considered**: Escribir directo a colección activa expone pendientes. Dos commits PG/Qdrant no son atómicos. Rollback tras cortar y borrar viejo contenido contraviene AD20; eliminar candidata por catch indiscriminado destruye activa. Reconstrucción completa cuesta más, pero es mecanismo existente verificable bajo RNF-IV01/02; medir, no inventar cumplimiento.

Retirada/vencimiento tienen exclusión SQL inmediata; recuperación valida estado/version/validez y sobrepone metadata vigente a cada cita. Si no se puede validar, indisponibilidad, nunca «sin información». Locks compartidos de colección durante lectura vectorial y exclusivo para eliminación física evitan borrar colección en uso; son locks efímeros DB, no IDs o registros de consultas anónimas. Revalidar generación/estado antes de invocar/entregar: si cambió evidencia, repetir búsqueda una vez dentro del mismo presupuesto; si vuelve a cambiar, error seguro sin contenido obsoleto. Conservar plazos de 40 s/45 s y probar cero errores de actualización normal.

## R05 — Contenido, metadata y eliminación

**Decision**: Separar metadata candidata de vigente; `sync.ts` no cambia título/fecha del publicado al detectar pendiente. Manual permite opcionales null→N/A y procedimiento ninguno→array vacío, condicionados a origen manual, sin relajar GMAS. Guardar fecha de acceso para cita si no hay actualización. Misma identidad por código o enlace; conflicto entre dos identidades se rechaza con 409 y espera revisión. Editar metadata deja hash/contenido intactos y siguiente consulta usa nuevo valor sin TTL anterior. Validez civil Bogotá: disponible todo día de validez, excluido desde inicio día siguiente, aunque worker se retrase. Evento único document/version/date.

**Rationale**: `na_solo_en_observatorio`/procedimientos obligatorios actuales necesitan ampliación limitada; `documentLinks` TTL conserva datos antiguos en error. Contenido rechazado/retirado/anterior debe desaparecer de SQL/Qdrant/archivos/copias administradas después de éxito; solo metadatos/hash/registro seguro permanecen. Vencido puede conservar contenido para rehabilitar fecha futura, derogado no se reactiva por editar fecha.

**Alternatives considered**: Unificar estados operativo/técnico causa falsas publicaciones; borrar anterior antes de éxito pierde base válida. Backups/exports administrados que contengan copias anteriores deben entrar en inventario de limpieza; no se certifica ausencia mientras una copia gestionada permanezca. Evidencia006 no conserva copia íntegra que eluda borrado.

## R06 — Carga manual acotada y pipeline local

**Decision**: Multipart con metadata JSON primero y un archivo, auth/perfil/CSRF/Origin antes de parser; validación metadata antes de abrir staging persistente. Busboy streaming directo (dependencia nueva acotada a este parser, versionado/auditoría en implementación), sin buffer global ni URL remota descargada desde request. PDF/DOCX/XLSX mínimos; verificar formato real, tamaño técnico configurable e integridad/zip antes de conversión local del worker. Defaults operativos de propuesta: 32 MiB de archivo, 32 KiB de metadata, un archivo, 100 entradas ZIP, 256 MiB expandidos y razón de expansión 100; config servidor documentada y verificable, no métricas de aceptación del PDF. Rechazo limpia temporales y deja 0 filas/archivos; desconexión tiene limpieza/reconciliación.

**Rationale**: No existe carga manual web; JSON general de 64 KiB no debe aumentar perímetro ciudadano de 128 KiB. `metadata` primero permite rechazar faltantes sin escribir archivo. [Busboy](https://github.com/mscdex/busboy) documenta parser streaming y límites; el plan elige configuración acotada para la superficie administrativa.

**Alternatives considered**: Buffer entero aumenta memoria; publicar al cargar viola AD03. Formatos con datos personales/OCR≤80% siguen salvaguardas001. Límite del cuerpo ciudadano permanece sin cambios.

## R07 — Enlaces/propuestas y escritor único

**Decision**: Enlaces activos y propuestas persistidas con revision/listVersion; snapshot interno por corrida con hash/config/version a Python offline, contenido de propuesta no ejecutable. HTTPS/hosts se validan al proponer/agregar/aprobar y en redirects. Lista de hosts fija en código; contenido permitido separado. Quitar origen cesa todas sus verificaciones siguiente corrida, conserva publicado y genera aviso/marca; no interpretarlo como fuera-de-alcance. Tombstones por URL+hash de rechazo/retiro, solo metadata, omiten igualdad y admiten hash nuevo.

**Rationale**: `sources.py` semillas estáticas necesita snapshot; policy existente ya coincide con AD15. Gestión de propuesta privada por propietario y decisiones solo técnico. No segunda sincronización/escritor Python de matriz.

**Alternatives considered**: Cambiar hosts en panel prohibido; borrar docs al quitar semilla viola AD18; comparar solo hash pierde separación de origen.

## R08 — Avisos/auditoría/estado unificados

**Decision**: Ampliar avisos KB+admin con owner/scope; unión SQL autorizada/paginada y conteos, agrupación tipo+objeto+scope+owner; único listado UI actual. Rechazo/OCR/indexación del Gestor visibles solo al autor, todos del sistema solo técnico. Auditoría integra historia KB/admin con actor cuenta o rol y resultado, append-only. Hydrate estado persistido al reinicio, fallas/scraper escritura seguras <60s, sin correo ni webhook. Mutación no se confirma sin auditoría; fallos rechazados registrados separadamente cuando tx se revierte.

**Rationale**: Listado actual descarga todo; avisos KB sin autor; estado parte no comprobado y pierde datos persistidos. Notificaciones/retención mínima de 12 meses previas se conservan.

**Alternatives considered**: Consolidar tablas borra historia innecesariamente. Contador de avisos agrupados cuenta fila, no suma repeticiones. Auditoría no reemplaza notificación de bloqueo.

## R09 — Casos sin copias de texto

**Decision**: `admin.improvement_case` FK UNIQUE a row_id autorizado y origins como conjunto; triggers/funciones mínimas dentro de inserción autorizada y valoración No útil fusionan causas concurrentes sin duplicar. Backfill idempotente autorizado. Pregunta por JOIN, no copia; purga a los 12 meses anula proyección también del caso/export. Máquina estricta sin salto/retroceso, REAL para En ajuste, nota para Cerrada, evidencia de validación posterior aplicable para Validada/Cerrada. Hallazgo006 relacionado, nunca otra fila del mismo estado/reapertura automática.

**Rationale**: `records.ts`, `007_valoracion.sql`, `retention.ts` ya tienen commit confirmado/purga. Ningún hook en anonymous_usage, CSVlegacy90d no fuente. Triggers se ejecutan tras evaluación autorizada, no en response generada sin registro confirmado.

**Alternatives considered**: Escanear texto/copiarlo extiende retención; dos inserciones por sin información+No útil violan AD03. Trigger que envía red/LLM bloquea chat; solo DML acotado y probado dentro presupuesto existente.

## R10 — Estadísticas/tarifas precisas

**Decision**: Cuatro proyecciones agregadas SQL allowlist, ninguna pregunta/ID; rango civil default últimos 30 días Bogotá→UTC [inicio,fin). Total/diario/consumo autorizadas+anónimas; categoría/tipo/valoraciones/citas solo autorizadas. Ranking dedupdocumento por respuesta, top 10, citas descendentes y nombre ascendente, dirección desde catálogo metadata histórica no textual seguro. Preservar citas sin texto después de purga según005. Costo NULL no es 0; mostrar cantidad sin costo/incompletitud. Ruta local none se separa.

Tarifas existentes numeric(20,10) no se reescriben: nuevas ediciones USD >0 hasta 4 decimales, string decimal exacto sin exponente, CAS por modelo/región y periodos no solapados. Usar receivedAt ya empleado por `records.ts`: consulta recibida antes del guardado conserva anterior aunque termine después; nuevos registros solo nuevos precios. Conservar source_url institucional vigente al editar, no requerir campo nuevo al usuario. `decimal.js` con escala 12 vigente, jamás recálculo histórico.

**Alternatives considered**: Agregar tablas telemetry viola anonimato; JS float afecta costo; cambiar CHECK histórico a 4 decimales destruye precios previos; sumar JOIN citas×valoración duplica total.

## R11 — Exportación XLSX y filtros

**Decision**: Streaming XLSX con ExcelJS dependencia nueva directa, solo exportación de interacciones de 100.000 filas; conservar SheetJS ya existente para matriz SPEC001. Cursor DB/chunks en transacción REPEATABLE READ acotada, worksheet filas commit, workbook terminado antes de éxito; nueve columnas mismo filtro sin paginación de UI/IDs, texto tipado string sin fórmula/hyperlink. Respuesta no-store y download autenticado/CSRF cuando corresponde; nada durable servidor, cleanup/cancel y límites acotados de recursos. Retención se evalúa al momento export: consultas SQL CASE por edad además de purged_at impiden exponer texto ya vencido aunque cleanup se retrase; snapshot iniciada antes de vencimiento se cancela si cruza corte antes de escribir textos.

**Rationale**: Volumen de 100.000 filas hace razonable writer streaming en lugar de workbook completo. [ExcelJS README](https://raw.githubusercontent.com/exceljs/exceljs/master/README.md) distingue tipos string/formula y writer streaming con commit de filas; es decisión de implementación, no cambio de formato fuente.

**Alternatives considered**: Reutilizar SheetJS CE en memoria para 100.000 filas tensiona proceso online; CSV incumple .xlsx; prefijar apóstrofo cambia texto esperado. No prometer revocación de copia descargada por humano; el sistema solo no conserva/reexpone texto fuera de retención.

## R12 — Validación por pantalla/release

**Decision**: AdminE2E/config separado de widgetfixture, mismas rutas/servicios reales bajo autorización; axe cada pantalla/estado, teclado/lector manual/zoom 200 %, contrastes 4.5 y 3, cero fallos A/AA y manual 100 %. Ocho pantallas RNF08 concretas, 20 cargas por pantalla/día × 2 fechas Bogotá, volúmenes 1000/100000/10000; p95 nearest rank por pantalla/día (n20→posición19), conservar errores también. CI offline/DB/Qdrant doble no acredita C6/AWS/lector. No se generan tasks en plan.

**Rationale**: [Playwright](https://playwright.dev/docs/accessibility-testing) separa análisis automatizado de evaluación completa. SPEC004 aporta metodología; 006 aporta identidad/evidencia vigencia, no actas nuevasAD. Pruebas de rendimiento end-to-end navegación→datos útiles incluyen red/render, no solo SQL.

**Alternatives considered**: Un p95 global y tests vacíos enmascaran pantalla lenta; estados PASS o archivo existente no acreditan criterio. Diseño completo de 62 requisitos antes de tasks, gates I–X sin excepciones.

## Versiones propuestas y límites de evidencia

Versiones base contrastadas en manifests primarios: [Busboy 1.6.0](https://raw.githubusercontent.com/mscdex/busboy/master/package.json) y [ExcelJS 4.4.0](https://raw.githubusercontent.com/exceljs/exceljs/master/package.json). El plan propone fijarlas sin rangos flotantes; tipos de Busboy por declaraciones directas compatibles verificadas en implementación. No se instaló ni auditó ninguna dependencia durante diseño. Sus dependencias transitivas deben superar auditoría sin vulnerabilidades altas antes de integrar; si necesitan patch/override compatible, se documenta y prueba sin cambiar los contratos. No se afirma que leer un manifest pruebe seguridad.

Exportación puede usar staging privado efímero durante la petición para validar el workbook completo antes de headers; se elimina en todos los desenlaces y jamás se convierte en archivo histórico. Esto es compatible con «sin archivo durable», y no permite exponer texto ya vencido por retención.
