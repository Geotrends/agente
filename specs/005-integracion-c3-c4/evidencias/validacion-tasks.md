# Validación documental de tareas — SPEC005

Fecha: 2026-10-10. Alcance: generación de tareas; no ejecución de implementación, pruebas de runtime, aceptación ni despliegue.

## Resultado

PASS documental: 82 tareas pendientes, secuenciales T001–T082; nueve fases; dependencias explícitas anteriores y grafo acíclico; cada tarea incluye archivos y requisitos. Las seis historias P1 incluyen pruebas, implementación, integración y criterio independiente. Las restricciones del modelo de datos y los contratos de aceptación se trasladan a tareas; el manifiesto futuro T003 debe conservar todas las cantidades y entornos requeridos.

Cobertura: 31 IDs normativos del spec aparecen en requisitos de tareas: 30 activos y RNF-C3-IN-09 descartado por la fuente. Este último exige trazabilidad, no implementación de rotación. La cobertura documental no acredita cumplimiento funcional.

| Fase | Tareas | Cantidad |
| --- | --- | --- |
| Setup | T001–T006 | 6 |
| Fundamento | T007–T015 | 9 |
| US1: continuidad y decisión de datos | T016–T022 | 7 |
| US2: respuestas y valoración | T023–T030 | 8 |
| US3: privacidad y retención | T031–T041 | 11 |
| US4: tiempos, fallos y contactos | T042–T049 | 8 |
| US5: protección e identidad | T050–T059 | 10 |
| US6: capacidad y no degradación | T060–T068 | 9 |
| Cierre integrado | T069–T082 | 14 |
| Total | T001–T082 | 82 |

## Paralelismo y entrega

19 tareas [P] en nueve grupos con dependencias comunes y archivos separados: T003/T004/T005; T007/T008; T016/T017; T023/T024; T031/T032; T042/T043; T050/T051; T060/T061; T069/T070. Las pruebas aisladas de historias pueden prepararse tras T015; implementación ordenada US1→US2→US3→US4→US5→US6 para evitar cambios simultáneos a módulos compartidos.

MVP interno: T001–T022. Todas las historias P1 y el cierre siguen siendo obligatorios.

## Comprobaciones

- 82/82 líneas cumplen checkbox pendiente, ID secuencial, etiquetas según fase, archivos, requisitos y dependencias.
- 31/31 IDs fuente cubiertos; sin requisitos desconocidos.
- Nueve fases con criterio de prueba independiente; seis historias con etiquetas correctas.
- 19 marcas [P] agrupadas sin colisión de archivos dentro de cada grupo.
- Enlaces documentales locales resueltos y sin marcadores de plantilla pendientes.
- Pruebas locales/controladas separadas de AWS/IAM, entrada nginx, portal, móviles/lectores y carga real en dos días con 180 medidas del anfitrión.
- Revisión de restricciones: UUID/propiedad/confirmación, enums y estados volátiles, diez pares, seis campos anónimos, retención/estadísticas, episodios, contactos, presupuestos/cleanup y estados de informe conservados.
- Hooks: `.specify/extensions.yml` válido, `hooks: {}`; ningún hook before_tasks/after_tasks registrado.

## Trazabilidad por requisito

| Requisito fuente | Tareas |
| --- | --- |
| RF-C3-IN-01 | T002, T003, T014, T016, T018, T019, T022, T076 |
| RF-C3-IN-02 | T016, T018, T019, T022, T076 |
| RF-C3-IN-03 | T002, T023, T025, T026, T030, T076 |
| RF-C3-IN-04 | T004, T006, T007, T008, T009, T011, T012, T013, T014, T015, T042, T044, T045, T046, T049, T063, T073, T076, T080 |
| RF-C3-IN-05 | T001, T009, T014, T023, T025, T030, T033, T037, T064, T076, T078 |
| RF-C3-IN-06 | T031, T034, T041, T076 |
| RF-C3-IN-07 | T031, T034, T041, T044, T064, T076, T078 |
| RF-C3-IN-08 | T004, T008, T011, T032, T035, T036, T041, T042, T045, T076, T082 |
| RF-C3-IN-09 | T002, T024, T027, T028, T029, T030, T033, T076 |
| RF-C3-IN-10 | T046, T049, T070, T076 |
| RF-C4-IN-01 | T005, T017, T019, T020, T021, T022, T039, T076, T077 |
| RF-C4-IN-02 | T017, T020, T021, T022, T047, T076 |
| RF-C4-IN-03 | T005, T043, T047, T049, T076, T077 |
| RF-C4-IN-04 | T013, T040, T043, T047, T048, T049, T076 |
| RF-C4-IN-05 | T024, T026, T027, T029, T030, T076, T077 |
| RF-C4-IN-06 | T043, T048, T049, T076 |
| RNF-C3-IN-01 | T033, T037, T038, T041, T076, T082 |
| RNF-C3-IN-02 | T001, T009, T060, T062, T063, T066, T068, T069, T071, T078, T080, T081 |
| RNF-C3-IN-03 | T060, T062, T063, T064, T066, T067, T068, T078, T080, T081 |
| RNF-C3-IN-04 | T004, T007, T010, T015, T050, T052, T059, T072, T073, T076, T082 |
| RNF-C3-IN-05 | T010, T050, T052, T059, T076 |
| RNF-C3-IN-06 | T013, T050, T053, T059, T076 |
| RNF-C3-IN-07 | T051, T054, T055, T056, T059, T074, T075 |
| RNF-C3-IN-08 | T051, T054, T055, T059, T070, T075 |
| RNF-C3-IN-09 | T003, T069, T071, T081 |
| RNF-C3-IN-10 | T012, T051, T054, T056, T059, T072, T075 |
| RNF-C3-IN-11 | T057, T059, T075 |
| RNF-C3-IN-12 | T007, T010, T012, T013, T015, T040, T041, T053, T072, T073, T076 |
| RNF-C3-IN-13 | T001, T003, T006, T061, T065, T066, T067, T068, T069, T071, T074, T079, T080, T081 |
| RNF-C4-IN-01 | T005, T017, T021, T039, T041, T070, T077, T082 |
| RNF-C4-IN-02 | T058, T059, T070, T074, T077 |

## Límites

Todas las tareas permanecen sin ejecutar. No se modifican marcas de SPEC001–004. Los archivos y comandos nuevos citados en tareas son entregables futuros. La rama Git actual es `develop`; la selección lógica de la característica es SPEC005. No se ejecutaron pruebas de producto para validar estos documentos.
