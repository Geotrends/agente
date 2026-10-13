# US5 · evidencia local (T085)

**Fecha**: 2026-10-08 · Recuperación **real** (Qdrant 1.19 + `multilingual-e5-small` + `ms-marco-MiniLM` locales) sobre una **muestra sintética de 6 documentos**. Es evidencia de mecánica, **no** el informe del corpus que se servirá.

| Criterio | Prueba | Resultado |
|---|---|---|
| DI-13 · ≥5 documentos / ≥2 con tablas | `test/di-chunking.test.ts` (6 documentos, 4 con tablas) | texto final ≤ 1000 (contexto incluido); palabras intactas; solapamiento 150 ± una palabra; cada tabla íntegra en un único fragmento; fronteras 1000/1001; tabla o palabra > 1000 → `ChunkingError` (no publicable) |
| DI-12 · 5 trazas | `test/di-integracion/retrieval-publication.test.ts` | BM25 y denso aportan; ≤ 16 candidatos; ≤ 8 fragmentos de mayor a menor puntaje |
| DI-14 · 3 situaciones | `test/diversity.test.ts`, `di-retrieval-selection.test.ts` | ≤ 3 por documento; única fuente útil → hasta 8; duplicados (Jaccard ≥ 0,6) eliminados y **no reintegrados**; umbral estricto; se entregan menos fragmentos antes que rellenar |
| DI-06 · 3 caídas del reranker | idem | exactamente los 8 mejores de RRF en su orden, `thresholdApplied=false`, degradado; el siguiente éxito vuelve a normal; búsqueda fallida lanza error y **nunca** es abstención |
| DI-15 · 5 seguimientos / 5 autónomas | `test/di-followup-calibration.test.ts`, `us5-answer.test.ts` | cola ≤ 500 en límite de palabra solo para la búsqueda; palabra > 500 → cola vacía; las autónomas y las anónimas no la reciben |
| DI-05 · calibración | `retrieval-publication.test.ts` | barrido de todos los valores finitos; umbral = mayor con **cero falsas abstenciones** (comprobado con el recuperador real: 3/3 respondibles con fragmentos); informe completo guardado en `kb.kb_calibracion` junto a la colección; la candidata se calibra **antes** de mover el alias; calibración imposible → error y alias intacto |
| RNF-IV-02 · publicación inválida | idem | tabla > 1000: la candidata se descarta, el alias sigue en la colección validada y se notifica sin contenido |
| Calibración incompatible | `di-followup-calibration.test.ts` | cambiar embedding, reranker o reglas de selección la invalida (readiness bloqueada) |

## Pendiente

- **Calibración con el corpus vigente y el oro real**: `npm run eval:retrieval -- --calibrar --informe=specs/002-diseno-modelo-ia/evidencias/calibracion --guardar` (o `kb sincronizar --completa --oro=<archivo>`). No se ejecutó: el corpus completo vive en los servicios del usuario y no se tocó.
- **Efecto del límite de 1000 sobre el corpus real**: el corpus tiene tablas presupuestales grandes; con la regla nueva, cualquier tabla > 1000 caracteres **bloqueará la publicación** de su documento hasta resolverse en la fuente (hallazgo REAL). Hay que medirlo antes de reconstruir.
- Una **publicación incremental** (≤ umbral de publicación masiva) añade puntos a la colección servida sin recalibrar. La calibración queda atada a la colección, no al contenido: decidir si toda publicación debe pasar por reconstrucción calibrada.
