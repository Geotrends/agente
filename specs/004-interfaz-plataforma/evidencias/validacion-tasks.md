# Validación documental de tareas — SPEC004

Fecha: 2026-10-08. Fuente: spec, plan, research, data-model, contratos, quickstart, constitución y código actual. Se aplicó `speckit-tasks`; no se implementó la funcionalidad ni se ejecutaron las pruebas de aceptación.

## Resultado

- 84/84 tareas con casilla pendiente, ID secuencial único, etiquetas correctas y ruta concreta.
- Dependencias explícitas existentes y anteriores a cada tarea: grafo acíclico; integración compartida serializada.
- Cinco fases de historias en orden P1/P1/P1/P2/P2, con objetivo, pruebas independientes e implementación.
- Setup: 7; foundation: 11; cierre: 12; historias: 54.
- 20 tareas paralelizables, distribuidas en siete grupos con prerequisitos y límites expresos.
- Todas las restricciones de campos del modelo se trasladan a tareas de tipos/estado/esquema; se documenta equivalencia física conversation/interaction y migración con ordinal libre.
- 22/22 casos del contrato tienen tareas asociadas: 12 UI, ocho integración C4 y dos servicios C3. Esto es cobertura del plan de trabajo, no cumplimiento de implementación.
- No hay placeholders de aclaración ni tareas marcadas como ejecutadas.
- `.specify/extensions.yml` se analizó antes y después: `before_tasks` y `after_tasks` sin hooks registrados.

## Distribución y prueba independiente

| Historia | Tareas | Prueba independiente |
| --- | ---: | --- |
| US1 | 12 | Host controlado: dos consultas/cinco ciclos, tres cargas, cinco anchos y origen/CSP |
| US2 | 10 | Nueve formatos, diez citas y diez cargas maliciosas, tres consultas como texto |
| US3 | 12 | Demoras/fallas controladas, plazo de 45 s, dos reintentos y contactos disponibles/ausentes |
| US4 | 8 | Seis recorridos de confirmar/cancelar y carreras de solicitudes/reinicio |
| US5 | 12 | Diez valoradas/tres anónimas, doce envíos API y DB real/propiedad/unicidad/purga |

MVP interno: setup/foundation y US1. Entrega completa: cinco historias y cierre real T073–T084.

## Trazabilidad de los 22 casos

| Caso | Requisito | Tareas asociadas |
| --- | --- | --- |
| U01 | RF-C4-UI-01 | T004, T005, T019, T022, T023, T025, T026, T029, T030, T078, T079, T084 |
| U02 | RF-C4-UI-02 | T004, T005, T020, T022, T024, T025, T026, T029, T030, T078, T079 |
| U03 | RF-C4-UI-03 | T003, T031, T034, T036, T037, T038, T040, T080 |
| U04 | RF-C4-UI-04 | T005, T033, T035, T037, T038, T040, T078, T079, T080 |
| U05 | RF-C4-UI-05 | T053, T054, T055, T056, T057, T058, T059, T060, T070, T079, T084 |
| U06 | RF-C4-UI-06 | T061, T063, T064, T067, T069, T070, T071, T072, T080, T081, T084 |
| U07 | RF-C4-UI-07 | T041, T043, T044, T046, T050, T052, T080 |
| U08 | RF-C4-UI-08 | T041, T042, T043, T044, T045, T047, T048, T049, T050, T051, T052, T084 |
| N01 | RNF-C4-UI-01 | T003, T007, T019, T023, T027, T028, T030, T075, T078, T079 |
| N02 | RNF-C4-UI-02 | T003, T004, T007, T016, T020, T025, T026, T030, T033, T035, T036, T038, T039, T040, T043, T046, T052, T054, T055, T059, T060, T063, T069, T071, T074, T076, T080 |
| N03 | RNF-C4-UI-03 | T003, T007, T032, T033, T034, T035, T036, T037, T040, T047, T076 |
| N04 | RNF-C4-UI-04 | T016, T023, T026, T027, T030, T039, T040, T078, T080 |
| I01 | RF-C4-IN-01 | T002, T008, T010, T011, T012, T014, T017, T018, T029, T049, T053, T056, T057, T058, T060, T081 |
| I02 | RF-C4-IN-02 | T002, T008, T010, T011, T012, T014, T017, T018, T029, T041, T044, T049, T050, T053, T056, T057, T058, T060, T081 |
| I03 | RF-C4-IN-03 | T041, T044, T045, T049, T050, T052, T053, T056, T057, T059, T060 |
| I04 | RF-C4-IN-04 | T011, T013, T042, T045, T047, T049, T050, T052 |
| I05 | RF-C4-IN-05 | T008, T012, T061, T063, T064, T066, T069, T070, T071, T072, T081 |
| I06 | RF-C4-IN-06 | T002, T008, T015, T018, T042, T048, T050, T051, T052, T057, T081 |
| P01 | RNF-C4-IN-01 | T010, T011, T017, T019, T020, T022, T023, T024, T029, T044, T053, T056, T057, T059, T069, T081, T084 |
| P02 | RNF-C4-IN-02 | T005, T020, T021, T022, T028, T030, T075, T078, T079, T084 |
| B09 | RF-C3-IN-09 | T006, T009, T061, T062, T065, T066, T067, T068, T070, T071, T072, T077, T081 |
| B10 | RF-C3-IN-10 | T006, T008, T012, T013, T015, T018, T048, T051, T052, T077, T081 |

## Límites de esta verificación

El repositorio contiene trabajo local previo, por lo que los números de tareas anteriores no acreditan aceptación: SPEC001 89/91 marcadas, SPEC002 17/100, SPEC003 0/27 al revisar. T001 actualiza esa línea base en ejecución. Se verificó documentalmente la coherencia de rutas y servicios; los archivos futuros descritos por tareas todavía deben crearse. Las marcas de tareas previas se preservan y requieren evidencia al converger.

Las pruebas en navegador, BD, AWS/Bedrock, portal oficial, lectores y móviles reales corresponden a implementación/aceptación futura. No se ejecutaron migraciones, instalaciones ni publicación al generar estas tareas.
