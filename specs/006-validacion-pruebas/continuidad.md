# Continuidad SPEC006 con SPEC001–005

**Fecha**: 2026-10-10. Revisión documental del estado del repositorio; no es una corrida de aceptación ni una certificación de cumplimiento. Requisitos que sostiene: RF-C3-VA-01..06, RF-C4-PR-01..04 y las dependencias RNF-C4-UI-02/RNF-C3-IN-03.

## Artefactos revisados y responsabilidad

Se revisaron `spec.md`, `plan.md` y `tasks.md` de los cinco specs, la constitución y los contratos/informes/evidencias señalados aquí. La revisión de código se limitó a las superficies de evaluación; no se ejecutaron sus suites ni se hicieron llamadas a modelos. Los diagnósticos iniciales y los encabezados históricos no describen por sí solos el estado actual.

| Spec | Estado documental observado | Responsabilidad retenida / contribución a 006 |
| --- | --- | --- |
| 001 | 89 de 92 tareas marcadas. Pendientes T082, T083 y T092. Matriz, fichas y evidencia de quickstart existen. | Mantiene ingesta/publicación/base cerrada. 006 usa sus fuentes y versiones para expectativas y cobertura VA-01, no duplica corpus ni elimina sus pendientes. |
| 002 | 94 de 102 marcadas. Pendientes T092–T098 y T102. `informe-validacion.md` diferencia implementación local con dobles de aceptación real. | Mantiene generación/recuperación/Bedrock/calibración. 006 construye matrices VA y expedientes H5 sobre su evaluación; cualquier corrección modifica los módulos responsables existentes. |
| 003 | 35 de 36 marcadas. T035 de navegador real pendiente. | Mantiene apertura/datos/categoría/emergencia. 006 comprueba flujos completos PR en escritorio/móvil y evidencia, sin crear otro flujo. |
| 004 | 77 de 84 marcadas. T078–T084 de portal/dispositivos/manual/servicios/cierre pendientes. | Mantiene widget/render/valoración/reinicio/errores y UI-02. 006 enlaza evidencia accesible de N02/T080 y la versión de entrega. |
| 005 | 0 de 82 marcadas; existen baseline, continuidad y diseño de aceptación. La existencia de esos artefactos no acredita ejecución de las tareas. | Mantiene correcciones de integración/perímetro/registro y mediciones; 006 reutiliza N303/T078 y cierre T080/T081, sin copiar infraestructura ni darlo por implementado. |

Los conteos son una fotografía de las marcas al redactar el spec. No son un criterio contractual ni sustituyen las pruebas. T092 de SPEC001 o T102 de SPEC002 pueden contener diagnósticos históricos: antes de actuar, contrastar el código y la evidencia vigentes, respetando alcance/autorización. No declarar un hallazgo resuelto únicamente porque otra tarea está marcada.

## Insumos reutilizables y brechas del Bloque 6

| Insumo existente | Valor reutilizable | Lo que aún debe establecer 006 |
| --- | --- | --- |
| SPEC001 matriz documental y fichas; configuración con seis GT-P | Fuente, versión, fecha, dirección y vínculos de cada procedimiento. | Expectativas verificadas por persona; tres casos respondidos por cada GT-P, distribución por dirección y fuente identificada por caso. |
| SPEC001 conjunto de oro acotado; SPEC002 oro de recuperación y calibración | Preguntas candidatas y comparación de recuperación. | No asumir que el oro de recuperación es matriz de respuestas VA. Revisar exactitud documental, aprobación y cobertura contractual; no usar expectativas sintéticas como hechos oficiales. |
| `specs/002-diseno-modelo-ia/contracts/acceptance.md` y `backend/test/fixtures/di/manifest.json` | Catálogo de 28 criterios DI, cantidades por requisito, identidad de corrida y distinción double/aws. | Los 28 criterios no son ≥30 casos VA. El manifiesto tiene identidades/revisión pendientes; falta matriz aprobada con todos los campos VA-01, nueve ataques VA-06 y congelamiento real. |
| `backend/scripts/eval-di.ts` y `backend/scripts/lib/diAcceptance.ts` | Evaluación existente con modelo solicitado/efectivo, casos, evidencia y revisión manual; base para evitar un segundo evaluador de respuestas. | Adaptar/confirmar cobertura VA, denominadores, ejecución integrada e independiente sin respaldo, últimas corridas completas y umbrales por modelo; no declarar que el runner actual cumple todo por existir. |
| SPEC002 `informe-validacion.md` y hallazgos locales | Resultados anteriores y pendientes concretos, sin atribución de H5. | Registro con todos los campos y estados/severidades VA-04, revalidación completa y expediente/acta VA-05. |
| SPEC004 `contracts/acceptance.md`, `frontend/test/fixtures/ui-manifest.json` y `frontend/scripts/report-ui.mjs` | Catálogo de 22 verificaciones (12 UI, 8 dependencias C4 y 2 servicios), estados de accesibilidad, identidad de artefactos. | Veintidós verificaciones no acreditan veinte flujos completos. Desglosar ocho flujos, ambos entornos, campos PR-01 y vínculo de preguntas a casos C3 por dirección; aprobar y congelar. |
| SPEC004 N02/T080 | Axe por estado, lista manual, teclado, lectores, zoom, contraste. | Evidencia real completa UI-02 en la misma versión del ChatBot del expediente; revisión local no sustituye lector móvil ni firma de revisión humana. |
| SPEC005 `contracts/performance-evidence.md`, N303/T078; antecedentes load de SPEC002 | Medición y conciliación de 3×25 por día en dos días, 15 autorizadas de 5 conversaciones +10 anónimas, p95 por oleada y registros. | Ejecutar o vincular evidencia vigente válida; identificar la versión del ChatBot/C3 que coincide con PR-04, sin atribuir conformidad a un diseño o runner sin ejecución. |
| SPEC004/005 registros de hallazgos e informes previstos | Trazabilidad a requisitos y responsabilidad de corrección. | Consolidar PR-03 con severidad de C4, fecha de corrida completa para Validada/Cerrada y acta PR-04 con firmas reales. |

## Convergencia de contratos y módulos

SPEC003 tiene rutas y nombres históricos de diseño. SPEC004 [convergencia](../004-interfaz-plataforma/evidencias/aceptacion/convergencia.md) y SPEC005 [continuidad](../005-integracion-c3-c4/evidencias/aceptacion/continuidad.md) documentan su equivalencia real. La planificación de 006 debe partir de esa convergencia:

- Flujo ciudadano único en `frontend/chat/` y cliente compartido; conservar decisión de datos y estado volátil.
- API consolidada de sesión/configuración/conversaciones/consulta/valoración; ningún endpoint alterno de emergencia, ningún flag histórico que cambie anonimato.
- Una persistencia para conversaciones/interacciones/consumo anónimo/valoraciones y un registro de contactos; no crear tablas ciudadanas para rastrear las pruebas.
- Modelo forzado solo en evaluación privada, fuera de la API ciudadana; misma generación y recuperación de la versión evaluada, con evidencia del modelo efectivo.
- Herramientas existentes de evaluación DI/UI/carga como base del plan; cualquier ampliación verifica primero capacidad real y mantiene distinción entre casos contractuales y verificaciones de componentes.

Estos son puntos de reutilización para planificación, no decisiones de arquitectura nuevas ni implementación en este comando.

## Reglas de evidencia compartida y cierre

1. Asignar un propietario por corrección y enlazar requisito previo y requisito VA/PR que la descubre. No reconstruir capacidades ni corregir simultáneamente la misma superficie desde listas distintas.
2. Reutilizar una corrida solo cuando coincide matriz/configuración/versión, cantidades, componente real y evidencia exigida. La referencia no cierra automáticamente tareas de otros specs.
3. Separar matriz ordinaria C3, familia manipulación y matriz funcional C4; relacionar preguntas frecuentes por identificador y conservar fechas/versiones aprobadas. Con seis GT-P, la matriz C3 ordinaria necesita ≥30 casos y con ataques ≥39.
4. Congelar antes de primera ejecución de validación, sin retrofechar aprobación; los ensayos anteriores siguen identificados como ensayos. Cualquier cambio de expectativa crea nueva matriz aprobada y nueva evaluación completa.
5. Tras cambios prompt/recuperación/base, repetir toda matriz C3 integrada y por modelo; tras cambio al ChatBot o C3, repetir toda matriz funcional. En el cierre C4, accesibilidad y carga deben acreditar la versión validada.
6. Mantener los criterios de aceptación DI/UI/IN individuales. El 90 % de VA/PR no reduce sus umbrales ni oculta un incumplimiento del requisito que declara el acta.
7. Registro de hallazgos con todos los campos, prioridad de la fuente y tipo REAL; Validada/Cerrada requiere corrida completa posterior. Todos los Críticos deben estar Cerrada al aprobar su hito.
8. Preparar informes y actas revisables; las firmas de supervisión y Geotrends y las fechas reales son condiciones externas de recepción. No declarar cierre ni generar firmas simuladas.

## Estado de implementación (2026-10-11)

Se implementaron herramientas y ensayos locales de SPEC006: contratos/identidad, check/freeze C3/C4, evaluador VA privado, exposición/retirada aislada, revisiones y hallazgos, runner PR/importación móvil, verificaciones compartidas e informes/actas. Se creó la imagen Docker autorizada; resultados y límites en [integracion-local.md](evidencias/aceptacion/integracion-local.md).

El workspace contiene trabajo anterior y concurrente de SPEC007; no se cambió el selector activo007 ni se recibió una release contractual de006. Las marcas de tasks.md representan criterios verificados, conservando tareas reales o mixtas pendientes. No se creó aprobación/candidata factual con fuentes inventadas, no hubo inferencia AWS, medición contractual de carga, firmas, publicación ni despliegue.

Próximo paso externo: aportar base/calibración vigente y autores/revisores para candidata C3 (T018–T020); después ejecutar C3 real/revisado, preparar/aprobar C4 y ejecutar/revisar ambos entornos físicos. UI/carga compartidas y firmas se reciben únicamente sobre la release validada. formatos-revision.md aporta revisión documental manual de formatos, no calibración del umbral de recuperación. Mientras falten esos insumos, los expedientes permanecen draft y T067 no está completo.
