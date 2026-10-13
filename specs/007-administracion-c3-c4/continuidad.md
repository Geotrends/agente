# Continuidad SPEC001–006 → SPEC007

Fecha de revisión: 2026-10-10. Fuente: `DOCUMENACION_C3_C4.pdf`, sección 4.7. Este documento registra lectura y coordinación; no es informe de cumplimiento del código.

## Artefactos revisados y estado registrado

Se revisaron `spec.md`, `plan.md` y `tasks.md` de los seis specs, la constitución vigente, los contratos/decisiones de aceptación SPEC006 y las superficies existentes de administración y base. Los diagnósticos históricos no se utilizan para afirmar estado actual. Las cifras siguientes cuentan IDs T únicos, excluyen ejemplos de formato y no prueban ejecución o aceptación.

| Spec | Artefactos | Marcadas / total | Pendientes registrados |
| --- | --- | --- | --- |
| 001 | [spec](../001-base-conocimiento-bloque1/spec.md), [plan](../001-base-conocimiento-bloque1/plan.md), [tareas](../001-base-conocimiento-bloque1/tasks.md) | 89/92 | T082, T083, T092 |
| 002 | [spec](../002-diseno-modelo-ia/spec.md), [plan](../002-diseno-modelo-ia/plan.md), [tareas](../002-diseno-modelo-ia/tasks.md) | 94/102 | T092, T093, T094, T095, T096, T097, T098, T102 |
| 003 | [spec](../003-diseno-conversacional/spec.md), [plan](../003-diseno-conversacional/plan.md), [tareas](../003-diseno-conversacional/tasks.md) | 35/36 | T035 |
| 004 | [spec](../004-interfaz-plataforma/spec.md), [plan](../004-interfaz-plataforma/plan.md), [tareas](../004-interfaz-plataforma/tasks.md) | 77/84 | T078, T079, T080, T081, T082, T083, T084 |
| 005 | [spec](../005-integracion-c3-c4/spec.md), [plan](../005-integracion-c3-c4/plan.md), [tareas](../005-integracion-c3-c4/tasks.md) | 49/82 | T050–T082 |
| 006 | [spec](../006-validacion-pruebas/spec.md), [plan](../006-validacion-pruebas/plan.md), [tareas](../006-validacion-pruebas/tasks.md) | 0/67 | T001–T067 |

No se modificaron marcas, planes ni tareas anteriores. SPEC005 tiene 49/82 marcadas en esta revisión, distinto de snapshots históricos; SPEC006 conserva 0/67. Una tarea marcada no sustituye la evidencia requerida.

## Responsabilidad compartida

| Dueño previo | Capacidad conservada | Aporte de SPEC007 y requisitos |
| --- | --- | --- |
| SPEC001 | Corpus cerrado, matriz de doce campos, fichas, conversiones/tablas, OCR local, formatos en blanco, vigilancia/derogación, publicación y reindexación atómica, exportación/retención. | Incorporar operación desde panel y permisos sin segundo pipeline. Carga manual AD-01/02, exclusión/publicación AD-03/04, ciclo AD-20..27, vigencia/metadatos AD-38/39 y control AD-47; mantener RF-C3-IV-01..12 y RNF-C3-IV-01..03. |
| SPEC002 | Orientación, dos modelos, anclaje/calibración, registro de consumo y panel mínimo de login/cambio/contactos/estado/avisos. | Ampliar cuentas AD-05..13, comunicaciones AD-28..31, contactos AD-35..37, auditoría AD-41, tarifas/estadísticas AD-42..46 y estado AD-48, preservando controles DI. Corregir capacidad existente, no crear autenticación o registro alternos. |
| SPEC003 | Apertura, consentimiento, categoría y emergencia. | Contactos editados siguen alimentando emergencia/riesgo/límite sin otra apertura/consentimiento ni consulta a modelos para inferir contactos. AD-35..37; RF-C4-DC-01..04. Contrato consolidado por 004/005 prevalece sobre descripción histórica del flag booleano. |
| SPEC004 | Interfaz institucional, rendering protegido, valoración, reinicio y accesibilidad del widget. | Reutilizar valoración existente para interacciones/casos, ampliar accesibilidad a todas las pantallas del panel con RNF-C3-AD-09. No tomar revisión del widget como prueba de pantallas nuevas. |
| SPEC005 | Registro autorizado/anonimato, enmascaramiento, tokens/costo, contactos, valoración, depuración de doce meses, perímetro/proxy y evidencia real de carga. | Lectura/exportación RF-C4-AD-01/02 y mejoras RF-C4-AD-03..05 sobre las mismas interacciones; métricas anónimas sin textos/categoría/valoración/IDs. No copiar preguntas a persistencia que eluda la purga. Perímetro confiable sostiene bloqueo RNF-C3-AD-06. |
| SPEC006 | Matrices aprobadas/congeladas, resultados/revisión, hallazgos REAL, ajustes/reejecuciones y expedientes H5-C3/H4-C4. | Usar evidencia aplicable para modificaciones de 007, mantener identidades/versiones y gates. Caso de mejora de RF-C4-AD-04 es distinto del Finding de RF-C3-VA-04/RF-C4-PR-03; un caso cerrado no recibe reapertura ni cierra hallazgos/actas automáticamente. |

## Superficies existentes comprobadas por lectura

- `backend/src/admin/auth.ts`, `sessions.ts`, `passwords.ts`, `db.ts`, `contacts.ts`, `audit.ts`, `operations.ts`, `serviceEvents.ts`; `backend/src/routes/adminAuth.ts`, `adminContacts.ts`, `adminOperations.ts`. Tienen autenticación de dos perfiles, sesión/contraseñas, contactos, avisos y estado; existencia no acredita todos los escenarios.
- `frontend/app/admin/login/page.tsx`, `password/page.tsx`, `contacts/page.tsx`, `notifications/page.tsx`, `status/page.tsx` y `layout.tsx`: panel mínimo existente. El inventario no contiene pantallas completas de documentos/cuentas/propuestas/tableros/interacciones/mejoras; el plan debe confirmar cobertura real antes de crear o ampliar cada una.
- `backend/src/kb/service.ts`, `sync.ts`, `indexer.ts`, `notifications.ts`, `ciclo.ts`, `vigilante.ts`, `exportMatrix.ts`, `retention.ts` y migraciones `backend/migrations/001_esquema_kb.sql`/`backend/migrations/chat/`: se conservan como puntos de integración. Publicación/reconstrucción y matriz ya tienen servicios/operación privada; no se asume cumplimiento AD por existir CLI.
- `backend/src/chat/` y rutas `conversations.ts`/`feedback.ts`/`chatConfig.ts`: registro/valoración/contactos existentes son fuentes de lectura; sus políticas de anonimato y purga no se alteran para alimentar nuevos tableros.
- `specs/006-validacion-pruebas/data-model.md`, `contracts/matrices.md`, `contracts/execution.md`, `contracts/findings-delivery.md`, `research.md` y `tasks.md`: diseño de evidencia offline, sin nuevas tablas operativas. SPEC007 agrega gestión administrativa del producto sin convertir ese arnés en panel de aceptación.

Observación concreta a validar en plan: `admin/auth.ts` registra bloqueo de cuenta en auditoría, pero el flujo leído no genera ahí la notificación de cuenta bloqueada que exige RNF-C3-AD-04. No se declara conformidad por observar solo el bloqueo. La implementación debe comprobar si otro flujo la emite y resolver la brecha si falta.

## Compatibilidad resuelta en el spec

1. **N/A manual versus matriz inicial**: AD-01/02 autoriza opcionales vacíos en cargas manuales; se mantiene información documental disponible y la política de contenido de SPEC001. No se extiende «N/A» a metadatos exigidos de extracción sin fuente.
2. **Hosts versus corpus**: AD-15 permite hosts determinados; RF-C3-IV-01 determina qué contenido se puede cargar. Son dos validaciones distintas. Enlaces se administran; hosts solo cambian mediante código desplegado.
3. **Reemplazo y evidencias**: AD-20 elimina contenido anterior tras éxito; fallo conserva anterior. El historial de aceptación de 006 puede conservar huellas/resultados seguros, pero no mantener copias de documentos que AD exige borrar.
4. **Casos y hallazgos**: RF-C4-AD-04 no permite retroceder caso; 006 admite reabrir hallazgo. Relación explícita mantiene ambas reglas, evidencia posterior y clasificación REAL antes de corrección.
5. **Anónimas y analítica**: Total/diario/consumo pueden incluirlas, categoría/tipo/valoración y casos no. Ranking indica cobertura disponible sin inventar citas anónimas; tableros entregan solo agregados y exportación excluye identificadores públicos.
6. **Texto histórico**: Interacciones/casos/exportación no reviven texto purgado a doce meses ni almacenan una copia para conservarlo más allá de SPEC005.
7. **Cuenta contratista**: Geotrends tiene perfil técnico y se puede desactivar si queda otro; privilegio del procedimiento restringido no es tercer perfil del panel. No se agregan mensajes de recuperación ni accesos públicos.
8. **Aceptación**: SPEC006 conserva sus dos actas de H5-C3/H4-C4. Bloque 7 define H6-C3/H5-C4 y verificaciones propias; no añade firmas nuevas no previstas ni elimina gates anteriores por porcentaje.

## Mapa de cobertura y orden de valor

| Historia | RF del Bloque 7 | RNF relacionados |
| --- | --- | --- |
| US1 — acceso/cuentas | RF-C3-AD-05..13 | RNF-C3-AD-01..06 |
| US2 — documentos | RF-C3-AD-01..04, 20..27, 32, 38/39 | RNF-C3-AD-01/08/09; RNF-C3-IV-02 heredado |
| US3 — fuentes | RF-C3-AD-14..19, 33/34 | RNF-C3-AD-01/08/09 |
| US4 — contactos | RF-C3-AD-35..37 | RNF-C3-AD-01/08/09 |
| US5 — operación | RF-C3-AD-28..31, 40/41, 47/48 | RNF-C3-AD-01/08/09 |
| US6 — interacciones/mejoras | RF-C4-AD-01..05 | RNF-C3-AD-01/08/09; privacidad/retención SPEC005 |
| US7 — cifras/costo | RF-C3-AD-42..46 | RNF-C3-AD-01/07/08/09 |

US1 establece el control de acceso común; las otras historias se prueban como incrementos con cuentas/datos autorizados y dependencias disponibles. US7 es P2 por requisitos Importantes; todas siguen obligatorias. SPEC006 puede avanzar con tooling independiente, pero la aceptación de cambios reales debe usar la misma versión y evidencia vigente.

El plan deberá asignar archivo/servicio dueño, pruebas de regresión y evidencia por cada requisito. Las capacidades parciales se completan en su dueño; producción, revisiones y accesos pendientes no se sustituyen por fixtures o estados de checklist.
