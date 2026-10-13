# US4 · evidencia local (T071)

**Fecha**: 2026-10-08 · **adapter=double**: ninguna llamada a AWS. Lo que sigue es el contrato local; la aceptación exige T092–T095 con Bedrock real.

| Criterio | Prueba | Resultado |
|---|---|---|
| DI-02 · 12 clasificaciones | `test/di-model-routing.test.ts` | 3 por nivel + 3 simples con 10 pares → complejo con puntaje finito y repetible; 0 llamadas al puntuar |
| DI-03 · 9 rutas | idem | principal, respaldo y doble caída por nivel; una tentativa por modelo; circuito abierto se salta; plazo agotado corta |
| DI-16/17 · configuración común | `test/di-bedrock.test.ts` | mismo prompt y parámetros para ambos modelos (`maxTokens 2200`, `temperature 0`, sin tools ni streaming); solo cambia el `modelId`; el razonamiento nunca sale; uso inválido / guardrail / texto vacío → fallo seguro; el cuerpo del proveedor no se filtra |
| DI-18 · 6 cortes + 3 normales; DI-28 · 10 largas | `test/di-output-limit.test.ts` | todos ≤ 2200 tokens contados con el tokenizador oficial; aviso exacto; última oración completa; URLs y tablas sin partir; fuentes recalculadas tras el recorte; falla segura si nada respaldado cabe |
| Tokenizador | `npm run eval:tokenizer` | **paridad exacta de IDs** con `tiktoken.encode_ordinary` (o200k_harmony, tiktoken 0.14.0) en 19 textos: español, Unicode, Markdown, URL, correos, PII y tokens especiales literales |
| DI-16 · 10 registros | `test/di-integracion/consumption.test.ts` | una fila por consulta, 5 por modelo, costo decimal igual al recálculo, `responseId` solo tras confirmar la escritura |
| IN-07 · anónimas | idem | tabla de 6 campos, sin clave primaria ni identificadores |
| IN-08 · 6 fallos + 2 recuperadas | idem | respuesta sin `responseId`, **1 aviso por episodio**, el primer éxito restablece |
| Retención | idem | 11 m 29 d conserva; 12 m 1 d depura textos e identificadores y conserva estadísticas; dos corridas idempotentes registradas |
| AD-28/29/30/48 · estados y avisos | `test/di-integracion/admin-operations.test.ts` | 5 estados visibles de inmediato, 8 tipos de aviso, agrupación, 7 revisiones → contador 1, nueva ocurrencia tras revisar, Gestor 403, KB integrada con permisos exactos, base caída: lectura volátil 30 min, sin logins ni mutaciones, reinicio → 401 |
| Readiness | `test/di-integracion/readiness.test.ts` | bloqueada sin contactos, tarifas, configuración, calibración o índice; nombra qué falta |

## Pendiente (no se declara)

- **DI-03/16/17/18, RNF-DI-02/03 con Bedrock real**: ninguna llamada a AWS se hizo. No hay rol temporal ni cuota disponibles en esta sesión.
- Comparación semántica entre ambos modelos (10 preguntas c/u), tráfico real de 20 consultas y tokens oficiales de AWS.
- Tarifas oficiales y contactos oficiales: **no hay valores por defecto**; la operación debe cargarlos o la readiness queda bloqueada.
- El estado «reranker» se alimenta desde la ruta del chat; el estado «scraper» sale de `kb.kb_corrida`.
