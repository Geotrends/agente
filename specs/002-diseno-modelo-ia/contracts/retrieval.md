# Contrato de recuperación y publicación

RF-C3-DI-04/05/06/07/08/11/12/13/14/15; RNF-C3-IV-02. Reutiliza `services/search.ts`, worker y payload publicado Qdrant, no búsqueda web abierta.

## Fragmentación

Entrada: Markdown de versión validada y metadatos KB. Salida fragmentos numerados `{text,page?,heading?,elementId,versionId,type,code,title,url,fechaActualizacion?,fechaAcceso?}`. Nombre/URL/fecha deben coincidir con matriz. Longitud≤1000 caracteres del texto completo realmente enviado/embebido; contexto de título si se antepone entra en ese límite. Encabezados/metadata pueden mantenerse aparte.

Cortes de prosa sin partir palabras; overlap 150±una palabra entre fragmentos contiguos del mismo flujo. Tabla Markdown detectada aunque conviva con prosa: bloque indivisible, no repetir o partir filas. Cada tabla≤1000 aparece íntegra en un fragmento; contexto circundante no provoca exceso. Límites de página/sección se conservan como metadata, no autorizan perder prosa/solapamiento. Test de≥5 documentos con≥2 tablas, frontera exacta 1000 y palabra sin espacios.

Tabla/palabra individual>1000: resultado de procesamiento no publicable, hallazgo REAL y notificación. La nueva colección completa no reemplaza alias si excluye contenido publicado vigente indebidamente; conservar última versión validada. No es una excepción al PDF. No exigir reducción automática de tabla para cumplir sin aprobación documental.

## Consulta y candidatos

Consulta autónoma→sin cola. Seguimiento→cola de pregunta previa≤500 en límite de palabra, anexada solo a consulta de búsqueda según motores actuales; vectorial usa actual, BM25/reranker pueden usar cola. No agregar cola como fragmento del system prompt. Palabra mayor 500→cola vacía en vez de palabra mutilada; no convertirlo en error ciudadano.

BM25+densa consultan alias vigente filtrando publicado; dos rankings top 40 actuales alimentan RRF. Fusionar IDs sin duplicar puntos; máximo 16 candidatos al reranker, configuración runtime no permite>16. Trazas de aceptación guardan IDs/puntajes/pasos sintéticos, no logs permanentes de preguntas anónimas.

## Selección normal

1. Puntuar candidatos, ordenar score desc +ID estable.
2. Filtrar `score > selectedThreshold`, frontera de igualdad fuera.
3. Deduplicar Jaccard≥0, 6 contra seleccionados, conservando el de mayor score. Duplicado rechazado nunca vuelve por relleno.
4. Favorecer≤3 por documento cuando sirven varios; si solo sirve uno, permitir hasta 8 fragmentos distintos de ese documento.
5. Hasta 8; no rellenar bajo umbral. Ordenar selección final por score, sin que pasadas de diversidad desordenen relevancia.

Si faltan alternativas para llegar 8 manteniendo preferencia 3, entregar menos en vez de reintroducir duplicados o ampliar excepción a varios documentos. Esta interpretación conserva casos expresos(a/b/c) del PDF.

## Fallo de reranker

Devolver directamente top 8 RRF disponibles en su orden. No aplicar logit ni diversificación posterior que modifique top 8. Estado reranker degradado, thresholdApplied=false; notificación agrupada; siguiente éxito restablece. Si falla Qdrant/embedding/motor búsqueda: SERVICIO_NO_DISPONIBLE, jamás abstención documental. DI-06 es excepción expresa al umbral.

## Calibración

Entrada oro/versionespublicación/candidatos detop 16 y selección final. Barrido finito de valores, nunca-Infinity predeterminado. Identificar preguntas respondibles de antemano. Para cada umbral ejecutar matriz y contar cuántas respondibles terminaríancon texto ausencia; elegido=max(valores con contador 0). Si no existe, error de calibración y diagnósticoREAL, no activar umbral a ojo. Guardar resultados de todas las preguntas/valores además del resumen.

Reporte exacto con SHA de matriz/corpus, colecciónalias/versión, revisiones de embedding/reranker/política selección, selectedThreshold y fecha. Validación del runtime exige calibración para versión servida; nuevos reranker/embeddings fuerzan recalibración. Cambio de corpus/selección rerun de matriz completa por constitución IX.

Construcción sobre colección candidata privada; evaluador apunta a candidata sin cambiar la pública. Alias y metadata de calibración se coordinan bajo publicación versionada del worker; cada lectura usa alias que resuelve una colección con metadata de su calibración, sin ventana de nuevo corpus+umbral viejo. Fallo conserva alias anterior. La API de índice no queda expuesta al ciudadano.

## Fuentes/precedencia

ID de documento real en respuesta fuente y ID temporal en prompt. Nombre/enlace/fecha de payload publicado; dateKind actualización para documentos/acceso para páginas. El prompt señala GT-P prevalente frente GT-N para mismo dato contradictorio; no eliminar todas las normas ni inventar fecha. Citas de salida solo intersección fuentes declaradas/recuperadas y relacionadas al contenido conservado, sin fallback a todos. Fecha faltante es problema de Datos de publicación/metadatos, no fecha actual inventada.
