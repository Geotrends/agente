# Informe de validación — Bloque 2 (H2-C3)

**Fecha**: 2026-10-08 · **Rama**: `develop` · **Revisión base**: `3f56d8e` más cambios locales sin confirmar.

## Veredicto

**Los 28 requisitos de DI están implementados y su contrato está verificado con dobles; ninguno cuenta como aceptado.** La aceptación exige llamadas reales a Bedrock, un navegador, la calibración con el corpus real y la firma del revisor funcional, y nada de eso se ha hecho. Esta fase **no** atribuye la aceptación formal de H5-C3 a H2-C3.

Antes del trabajo: 0 completos, 21 parciales, 7 no implementados (`diagnostico.md`). Después: 0 aceptados; 28 implementados; cada uno con su evidencia local y su pendiente.

## Qué se ejecutó (todo con `adapter=double` para Bedrock)

| Verificación | Resultado |
|---|---|
| Tipos (src + test + scripts) | sin errores |
| Unitarias | 330 / 330 |
| Integración DI (PostgreSQL + Qdrant + modelos locales reales) | 64 / 64 |
| Integración de la KB | 57 / 57 |
| Paridad del tokenizador (19 textos) | exacta |
| Frontend (pruebas con jsdom, build, auditoría) | 14 / 14, compila, 0 vulnerabilidades |
| Imágenes Docker y `chat-migrate` + bootstrap + purga contra `postgres:16` | verificadas |

## Matriz 28 / 28

| Requisito | Criterio | Estado | Evidencia local | Informe | Pendiente para aceptar |
|---|---|---|---|---|---|
| RF-C3-DI-01 | DI-01 | Implementado; verificado con dobles | `di-answer-limits.test.ts` (5 análisis / 5 trámites) | us2-local.md | Aceptación real con modelo: tasa de trámites correctos |
| RF-C3-DI-02 | DI-02 | Implementado; verificado con dobles | `di-model-routing.test.ts` (12 clasificaciones) | us4-local.md | Con evidencia del componente real |
| RF-C3-DI-03 | DI-03 | Implementado; verificado con dobles | `di-model-routing.test.ts` (9 rutas con doble) | us4-local.md | Caídas reales inducidas contra AWS (T093) |
| RF-C3-DI-04 | DI-04 | Implementado; verificado con dobles | `us1.test.ts`, `us5-answer.test.ts` (recuperación real) | us1-local.md, us5-local.md | Revisión funcional de los 5 presentes |
| RF-C3-DI-05 | DI-05 | Implementado; verificado con dobles | `retrieval-publication.test.ts`, `di-followup-calibration.test.ts` (muestra sintética) | us5-local.md | **Barrido con el corpus y el oro reales** (no ejecutado) |
| RF-C3-DI-06 | DI-06 | Implementado; verificado con dobles | `retrieval-publication.test.ts` (3 caídas del reranker, real) | us5-local.md | Estado en panel con reranker real apagado |
| RF-C3-DI-07 | DI-07 | Implementado; verificado con dobles | `di-answer-evidence.test.ts` | us1-local.md | Abrir los enlaces y cotejar fechas con la matriz |
| RF-C3-DI-08 | DI-08 | Implementado; verificado con dobles | `di-answer-evidence.test.ts` (10 + 3 sobrantes) | us1-local.md | Con modelos reales |
| RF-C3-DI-09 | DI-09 | Implementado; verificado con dobles | `di-institutional-answer.test.ts` (leyenda 10/5) | us1-local.md | Que el modelo atribuya la decisión a la dirección responsable |
| RF-C3-DI-10 | DI-10 | Implementado; verificado con dobles | Prompt exige español/Markdown/tono | — | **Revisión funcional ≥9/10** |
| RF-C3-DI-11 | DI-11 | Implementado; verificado con dobles | Prompt exige precedencia GT-P | — | **5 conflictos preparados y revisión** |
| RF-C3-DI-12 | DI-12 | Implementado; verificado con dobles | `retrieval-publication.test.ts` (5 trazas, real) | us5-local.md | — |
| RF-C3-DI-13 | DI-13 | Implementado; verificado con dobles | `di-chunking.test.ts` (6 documentos, 4 con tablas) | us5-local.md | Efecto sobre el corpus real (tablas > 1000) |
| RF-C3-DI-14 | DI-14 | Implementado; verificado con dobles | `diversity.test.ts` | us5-local.md | — |
| RF-C3-DI-15 | DI-15 | Implementado; verificado con dobles | `di-followup-calibration.test.ts`, `us5-answer.test.ts` | us5-local.md | — |
| RF-C3-DI-16 | DI-16 | Implementado; verificado con dobles | `consumption.test.ts` (10 registros, costo decimal) | us4-local.md | 10 consultas con uso oficial de AWS y costo manual |
| RF-C3-DI-17 | DI-17 | Implementado; verificado con dobles | `di-bedrock.test.ts` (config común) | us4-local.md | 10 preguntas por modelo y comparación |
| RF-C3-DI-18 | DI-18 | Implementado; verificado con dobles | `di-output-limit.test.ts` (6 cortes + 3 normales) | us4-local.md | Cortes forzados contra AWS real (`--force-cut`) |
| RF-C3-DI-19 | DI-19 | Implementado; verificado con dobles | `di-risk-channels.test.ts` (4–5/5 y 0/5) | us2-local.md | Tasas con modelo real |
| RF-C3-DI-20 | DI-20 | Implementado; verificado con dobles | `di-answer-limits.test.ts` | us2-local.md | — |
| RF-C3-DI-21 | DI-21 | Implementado; verificado con dobles | `di-answer-limits.test.ts`, `consent.test.ts` | us2-local.md, us3-local.md | Tasa ≥3/4 con modelo real |
| RF-C3-DI-22 | DI-22 | Implementado; verificado con dobles | `di-provider-privacy.test.ts` | us3-local.md | **Revisión funcional del tono** |
| RF-C3-DI-23 | DI-23 | Implementado; verificado con dobles | `di-pii.test.ts`, `di-provider-privacy.test.ts` | us3-local.md | Límite conocido: cédula sin palabra ancla |
| RF-C3-DI-24 | DI-24 | Implementado; verificado con dobles | `us1.test.ts`, `admin-contacts.test.ts` | us1-local.md, us2-local.md | Edición en el panel real, en navegador |
| RF-C3-DI-25 | DI-25 | Implementado; verificado con dobles | Prompt exige estructuras | — | **Revisión funcional 8/9** |
| RNF-C3-DI-01 | DI-26 | Implementado; verificado con dobles | `di-provider-privacy.test.ts`, `privacy.test.ts` | us3-local.md | Inspección del payload en AWS real con datos sintéticos |
| RNF-C3-DI-02 | DI-27 | Implementado; verificado con dobles | `validateDiConfig` + `eval:di-traffic` (mecánica probada) | us4-local.md | **20 consultas reales con captura de destinos** |
| RNF-C3-DI-03 | DI-28 | Implementado; verificado con dobles | `di-output-limit.test.ts` (10 largas), `eval:tokenizer` | us4-local.md | Tokens oficiales de AWS en 10 respuestas largas |

## Dependencias directas (IN / AD / C4) — verificadas con dobles

IN-01/02/03 (`consent.test.ts`), IN-04 (`error-contract.test.ts`, 9 casos), IN-05/06/07/08 (`consumption.test.ts`, `privacy.test.ts`), IN-10 (`chat-perimeter.test.ts`), RNF-IN-04/05/06 (`chat-perimeter.test.ts`), RNF-IN-11 (`di-provider-privacy.test.ts`), AD-08/09/10/41 y RNF-AD-01..07 (`admin-security.test.ts`), AD-28/29/30/48 (`admin-operations.test.ts`), AD-35/36/37 (`admin-contacts.test.ts`), C4-DC-01/02 e IN-01 del C4 (`frontend/test/di-consent.test.ts`, `frontend/test/di-flows.test.mts`, `consent.test.ts`).
**Sin verificar aún**: RNF-IN-02/03 contra una instancia real (`eval:di-load` listo, sin ejecutar), RNF-AD-05/09 en navegador, accesibilidad de pantallas.

## Hallazgos

Ver `evidencias/aceptacion/hallazgos.md`. Durante la implementación aparecieron y se corrigieron 9 defectos propios; quedan **abiertos** los que dependen de datos reales (tablas > 1000 caracteres del corpus, publicación incremental sin recalibrar).

## Puertas de cierre (`contracts/acceptance.md`)

1. Tipos, unitarias, integración DB-Qdrant, contratos, auditoría sin altas e imágenes: **cumplido localmente**; la CI no se pudo ejecutar aquí.
2. Tokenizador con paridad: **cumplido**. Prompt y parámetros iguales: **cumplido**. Corpus y calibración vigentes, contactos y tarifas oficiales, autenticación operativa: **pendiente de datos reales** (el panel está operativo).
3. 28 criterios + dependencias con revisión funcional y tráfico real: **pendiente**.
4. Documento de diseño e informe trazables con hallazgos REAL resueltos: **este informe y `diseno-final.md`**; la repetición completa tras los hallazgos reales está pendiente.
