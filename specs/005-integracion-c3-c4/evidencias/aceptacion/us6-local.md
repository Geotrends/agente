# US6 local — capacidad y no degradación (T068)

Fecha: 2026-10-10. Componentes: **C + DB** (servicio real `createApp` con PostgreSQL real aislado y proveedor **doble**; destinos HTTP locales). **N302, N303 y N313 siguen PENDIENTES**: exigen dos días reales en producción/AWS y 180 medidas contra el Observatorio y el Geoportal reales (T078/T079). Lo de abajo prueba el **arnés**, no el rendimiento del sistema.

## Qué se corrigió en el arnés (H005-09, R10)

| Defecto del arnés anterior | Corrección | Prueba |
| --- | --- | --- |
| Solo 5 de los 10 historiales llegaban (alternaba conversación/anónimo) | las 10 autorizadas llevan exactamente 10 pares y usan una conversación creada antes de medir | `load-runner.test.ts`: 10 historiales efectivos |
| «Larga» = pregunta rellenada; no probaba respuesta larga | 10 preguntas diseñadas para respuesta larga; se valida ≥700 y ≤2200 tokens visibles sobre la respuesta recibida | 10 largas validadas |
| Oleadas todas anónimas | 15 autorizadas de 5 conversaciones (cada una con su credencial) + 10 anónimas, simultáneas | auditoría de oleada |
| 200 contaba como éxito | éxito = 200 + contrato válido (modo/IDs coherentes, tipo, fuentes, tope de tokens) | `validateBody` (10 rechazos) |
| Sesiones/conversaciones dentro de la medición | preparadas antes del cronómetro (ventana propia, sin consumir la cuota de consultas) | — |
| p95 sin garantía de muestra | p95 nearest-rank con todos los casos y errores en el denominador; corrida degenerada marcada | `auditSequential` |
| Cola en frío rechazaba la 25.ª | supuesto inicial 5 s (`CHAT_QUEUE_INITIAL_AVERAGE_MS`) | `capacity-queue.test.ts` |

## Cantidades ejecutadas (pruebas automatizadas)

| Prueba | Resultado |
| --- | --- |
| `di-integracion/load-runner.test.ts` | plan 100 = 40/30/30 con 10 autorizadas+historial y 10 largas en posiciones distintas; 100 secuenciales contra el servicio real: 10 historiales efectivos, 10 largas validadas, 0 errores, 10 filas autorizadas + 90 anónimas; 3 oleadas de 25 con pausas de 120 000 ms y 75 registros (45 + 30); un arnés defectuoso es rechazado |
| `in-integracion/load-reconciliation.test.ts` | un día = 75 registros: 45 autorizados por ID y 30 anónimos por multiconjunto con emparejamiento bipartito; seis campos exactos en la tabla anónima; faltantes y tráfico ajeno detectados (pendiente) |
| `in-integracion/host-runner.test.ts` | 180 muestras (30 × 2 × 3), caché fija, línea base propia, errores/timeouts/esquema en el denominador, solapamiento por muestra, ventanas `extra` documentadas |
| `in-integracion/load-manifest.test.ts` | manifiesto de 100 preguntas congelado y coincidente con el plan |
| `in-integracion/capacity-queue.test.ts` | 8 + 24 ≥ 25; 25 simultáneas en frío admitidas; la plaza 33 recibe «cola llena» |

## Ensayo del arnés con endpoints controlados (no es medición)

Carpeta [`rendimiento/ensayo-controlado/`](rendimiento/ensayo-controlado). Servicio y destinos corren **en el mismo proceso de la máquina de desarrollo**; las latencias no representan al sistema real.

| Archivo | Resultado del arnés |
| --- | --- |
| `sequential-…Z.json` | 100 consultas, 100 × 200, 10 historiales efectivos, 10 largas validadas, mezcla 40/30/30, no degenerada, p95 muy inferior a 20 s (**aprobado en el doble**) |
| `waves-…Z.json` | 3 oleadas × 25: 0 errores, composición 15 autorizadas de 5 conversaciones + 10 anónimas (**aprobado en el doble**) |
| `host-…Z.json` | **no aprobado**, como debe ser en este ensayo: la «oleada» comparte el bucle de eventos con los destinos (p95 ×16–27 su línea base), y con la primera versión del orquestador las ventanas de oleada eran más cortas que 30 muestras (148 de 180). Esto motivó subir las ventanas extra permitidas a 6 y espaciar las oleadas ≥ 25 s para respetar los 60/min |

El sistema bajo prueba aquí es un doble sin Bedrock; **no** se atribuye a AWS, al portal ni al Geoportal ningún resultado.

## Pendiente real (no cerrado por este documento)

- N302: 100 secuenciales × 2 días en producción (p95 ≤ 20 s, ninguna > 40 s) con base/calibración congeladas.
- N303: 3 oleadas × 2 días, 150 registros (90 + 60) conciliados sin tráfico ajeno.
- N313: 180 muestras reales (Observatorio y Geoportal), reindexación completa efectiva y oleada de 25 real, con solapamiento comprobado.
- Medición de CPU/RAM del anfitrión solo como explicación del hallazgo, nunca como sustituto.
