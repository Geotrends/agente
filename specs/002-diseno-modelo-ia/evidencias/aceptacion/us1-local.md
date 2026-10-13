# US1 · evidencia local (T029)

**Fecha**: 2026-10-08 · **adapter=double** (el modelo es un doble; sin AWS). Esto prueba el **contrato** de US1, no la calidad semántica del modelo.

## Qué se comprobó (automático)

| Criterio | Prueba | Resultado |
|---|---|---|
| DI-04 · 5 presentes / 5 ausentes | `test/di-integracion/us1.test.ts`, `us5-answer.test.ts` (recuperación real) | 5 respondidas con fuente; 5 ausentes con «No encontré información validada…» + canal vigente, sin citas y **sin llamar al modelo** |
| DI-07 · enlaces https y fechas | `test/di-answer-evidence.test.ts` | catálogo exige URL https y fecha real (actualización o acceso); sin fecha = error de datos, nunca la fecha de hoy |
| DI-08 · 10 respuestas, 3 con fuente sobrante | idem | el alias sobrante no aparece en la cita ni en `fuentes`; marcador inválido sin referencias → fallo seguro |
| DI-09 · 10 decisión / 5 informativas | `test/di-institutional-answer.test.ts` | leyenda exacta «no reemplaza asesoría técnica ni jurídica formal» en las 10; ausente en las 5 |
| DI-24 · 8 cierres | idem | tres canales de recepción desde el snapshot vigente; el cambio de contactos se ve en la consulta siguiente |
| Precedencia GT-P > GT-N, tono, estructuras | prompt versionado `2026-10-08.1` | **solo se comprueba que el prompt lo exige**; el cumplimiento lo juzga el revisor |

## Qué NO se comprobó (queda para el cierre)

- Tono 10 respuestas (≥9/10), estructuras 9 (≥8/9), 5 conflictos GT-P/GT-N, correspondencia documental: **revisión funcional real** sobre respuestas de Bedrock (T097). Insumos en `backend/test/fixtures/di/us1.json`.
- Ningún enlace se abrió en un navegador (DI-07 exige que abran).

## Cómo reproducir

`cd backend && node --import tsx --test test/di-answer-evidence.test.ts test/di-institutional-answer.test.ts` y `npm run test:di-integration`.
