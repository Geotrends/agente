# Matriz de aceptación SPEC005 (generada)

Generada: 2026-10-11T00:46:40.942Z. Hash del árbol actual: `f0a82e260f6dd977…`. Versiones de los resultados: `f0a82e260f6dd977…`.

**Resumen**: 1/30 activos conformes · 29 pendientes · 0 con fallo · 1 descartado (N309). Informe completo: **no**.

Componentes: C controlado · DB PostgreSQL real aislado · A AWS/rol/modelos reales · P entrada nginx y servicio desplegado · H Observatorio/Geoportal reales · B navegadores/lectores/dispositivos reales.

| Caso | Requisito | Estado | Requeridos | Cubiertos | Faltantes |
| --- | --- | --- | --- | --- | --- |
| C301 | RF-C3-IN-01 | ⏳ pendiente | C+DB+A+P | C+DB | A+P |
| C302 | RF-C3-IN-02 | ⏳ pendiente | C+DB+A+P | C+DB | A+P |
| C303 | RF-C3-IN-03 | ⏳ pendiente | C+DB+A+P | C+DB | A+P |
| C304 | RF-C3-IN-04 | ⏳ pendiente | C+DB+P | C+DB | P |
| C305 | RF-C3-IN-05 | ⏳ pendiente | DB+C+A+P | C+DB | A+P |
| C306 | RF-C3-IN-06 | ⏳ pendiente | C+DB+A+P | C+DB | A+P |
| C307 | RF-C3-IN-07 | ⏳ pendiente | DB+C+A+P | C+DB | A+P |
| C308 | RF-C3-IN-08 | ⏳ pendiente | C+DB+P | C+DB | P |
| C309 | RF-C3-IN-09 | ⏳ pendiente | DB+C+P | C+DB | P |
| C310 | RF-C3-IN-10 | ⏳ pendiente | DB+C+P | C+DB | P |
| C401 | RF-C4-IN-01 | ⏳ pendiente | C+DB+B+P | C+DB | B+P |
| C402 | RF-C4-IN-02 | ⏳ pendiente | C+DB+B+A+P | C+DB | B+A+P |
| C403 | RF-C4-IN-03 | ⏳ pendiente | C+B+P | C | B+P |
| C404 | RF-C4-IN-04 | ⏳ pendiente | C+P+B | C | P+B |
| C405 | RF-C4-IN-05 | ⏳ pendiente | C+DB+B+P | C+DB | B+P |
| C406 | RF-C4-IN-06 | ⏳ pendiente | C+P+B | C | P+B |
| N301 | RNF-C3-IN-01 | ⏳ pendiente | DB+P | DB | P |
| N302 | RNF-C3-IN-02 | ⏳ pendiente | A+P | — | A+P |
| N303 | RNF-C3-IN-03 | ⏳ pendiente | A+P | — | A+P |
| N304 | RNF-C3-IN-04 | ⏳ pendiente | C+P | C | P |
| N305 | RNF-C3-IN-05 | ⏳ pendiente | C+P | C | P |
| N306 | RNF-C3-IN-06 | ⏳ pendiente | C+P | C | P |
| N307 | RNF-C3-IN-07 | ⏳ pendiente | A+P | — | A+P |
| N308 | RNF-C3-IN-08 | ⏳ pendiente | A | — | A |
| N309 | RNF-C3-IN-09 | ➖ descartado | — | — | — |
| N310 | RNF-C3-IN-10 | 🟡 controlado_conforme | C | C | — |
| N311 | RNF-C3-IN-11 | ⏳ pendiente | C+A | C | A |
| N312 | RNF-C3-IN-12 | ⏳ pendiente | C+DB+P+A | C+DB | P+A |
| N313 | RNF-C3-IN-13 | ⏳ pendiente | H+A+P | — | H+A+P |
| N401 | RNF-C4-IN-01 | ⏳ pendiente | C+B+P | C | B+P |
| N402 | RNF-C4-IN-02 | ⏳ pendiente | C+P+H+B | C | P+H+B |

## Problemas por caso

- **C301**: faltan componentes: A, P
- **C302**: faltan componentes: A, P
- **C303**: faltan componentes: A, P
- **C304**: faltan componentes: P
- **C305**: faltan componentes: A, P
- **C306**: faltan componentes: A, P
- **C307**: faltan componentes: A, P
- **C308**: faltan componentes: P
- **C309**: faltan componentes: P
- **C310**: faltan componentes: P
- **C401**: faltan componentes: B, P
- **C402**: faltan componentes: B, A, P
- **C403**: faltan componentes: B, P
- **C404**: faltan componentes: P, B
- **C405**: faltan componentes: B, P
- **C406**: faltan componentes: P, B
- **N301**: faltan componentes: P
- **N302**: faltan componentes: A, P; cantidad «dias» no cubierta por ninguna corrida; cantidad «secuenciales_por_dia» no cubierta por ninguna corrida; cantidad «simples» no cubierta por ninguna corrida; cantidad «medias» no cubierta por ninguna corrida; cantidad «complejas» no cubierta por ninguna corrida; cantidad «con_historial» no cubierta por ninguna corrida; cantidad «largas» no cubierta por ninguna corrida; cantidad «p95_ms» no cubierta por ninguna corrida; cantidad «silencio_max_ms» no cubierta por ninguna corrida
- **N303**: faltan componentes: A, P; cantidad «dias» no cubierta por ninguna corrida; cantidad «oleadas_por_dia» no cubierta por ninguna corrida; cantidad «tamano_oleada» no cubierta por ninguna corrida; cantidad «autorizadas» no cubierta por ninguna corrida; cantidad «conversaciones» no cubierta por ninguna corrida; cantidad «anonimas» no cubierta por ninguna corrida; cantidad «pausa_ms» no cubierta por ninguna corrida; cantidad «registros_por_dia» no cubierta por ninguna corrida; cantidad «registros_total» no cubierta por ninguna corrida; cantidad «p95_ms» no cubierta por ninguna corrida; cantidad «errores» no cubierta por ninguna corrida
- **N304**: faltan componentes: P
- **N305**: faltan componentes: P
- **N306**: faltan componentes: P
- **N307**: faltan componentes: A, P; cantidad «llaves_en_repo_imagen_env» no cubierta por ninguna corrida; cantidad «modelos_con_rol» no cubierta por ninguna corrida
- **N308**: faltan componentes: A; cantidad «acciones» no cubierta por ninguna corrida; cantidad «arn» no cubierta por ninguna corrida; cantidad «exitos» no cubierta por ninguna corrida; cantidad «denegaciones» no cubierta por ninguna corrida
- **N311**: faltan componentes: A
- **N312**: faltan componentes: P, A
- **N313**: faltan componentes: H, A, P; cantidad «destinos» no cubierta por ninguna corrida; cantidad «condiciones» no cubierta por ninguna corrida; cantidad «muestras_por_celda» no cubierta por ninguna corrida; cantidad «total» no cubierta por ninguna corrida; cantidad «razon_p95_max» no cubierta por ninguna corrida; cantidad «errores» no cubierta por ninguna corrida
- **N401**: faltan componentes: B, P
- **N402**: faltan componentes: P, H, B
