# US3 local — privacidad, registro degradado y retención (T041)

Fecha: 2026-10-10. Componentes: **C + DB** (PostgreSQL real aislado, proveedor doble), **P-parcial** (imagen real `nginxinc/nginx-unprivileged:1.27-alpine` con el `frontend/nginx.conf` del repo en Docker local; la app IN corre en el host) y **C emulado** (Chromium). No acredita A/H/B ni el despliegue real.

## Cantidades ejecutadas

| Caso | Prueba | Cantidades | Resultado |
| --- | --- | --- | --- |
| C306 | `di-integracion/privacy.test.ts` | 14 consultas: 9 con datos (etiquetas `[CÉDULA]`, `[TELÉFONO]`, `[CORREO]`, 0 apariciones del dato en pregunta y respuesta guardadas) y 5 sin datos (texto idéntico: Ley/Decreto/Resolución, GT-F/GT-P, radicado, fechas, cifras); la respuesta entregada es idéntica con y sin escritura; canales oficiales intactos | pasa |
| C307 | `privacy.test.ts` | 6 anónimas: 6 filas con exactamente 6 campos, 0 coincidencias de texto/sujeto en todas las tablas de `chat` y `admin`, 0 conversaciones | pasa |
| C308 | `in-integracion/registry-episode.test.ts` | 6 fallas (4 anónimas + 2 en conversación) y 2 recuperadas: respuestas completas, 2 sin `responseId`, 1 aviso con fecha, hora (Colombia) y modo, estado `registro` → normal al primer éxito; segundo episodio = aviso nuevo con su modo; base operativa caída: buffer seguro visible y 3 drenajes simultáneos escriben una vez | 3/3 pasan |
| N301 | `consumption.test.ts` | 11 m 29 d conservada / 12 m 1 d depurada; 2 ejecuciones; solo 4 campos de texto/ID pasan a NULL; `cited_documents`, duración, tokens visibles, modelo, tarifa, costo, `row_id` y valoraciones idénticos | pasa |
| N301 | `purge-scheduler.test.ts` | el bucle del servicio `chat-purge` (comando del compose, intervalo reducido) deja ≥2 corridas `ok` con inicio/fin reales | pasa |
| N401 | `frontend/test/storage.spec.ts` (Chromium) | 3 recorridos × {Autorizo, No autorizo}, 5 ocultaciones conservan, 0 texto/IDs/token en localStorage, sessionStorage, IndexedDB, cookies, URL y `postMessage` al host; recarga pierde | 2/2 pasan |
| N312 | `in-integracion/cache-entrypoint.test.ts` | nginx real: `Cache-Control: no-store` único en éxito, validación 400, valoración 201, 503 del backend, 401, 403, 413 (generado por nginx, JSON de catálogo), 429 + Retry-After, 504 (timeout del proxy) y 502/503 (backend caído); misma consulta dos veces → 2 invocaciones, sin ETag/Last-Modified/Age | 2/2 pasan |

## Hallazgos corregidos

| Hallazgo | Corrección |
| --- | --- |
| H005-03 la purga vaciaba `cited_documents` | `chat/retention.ts` ya no lo toca; expectativa heredada de `consumption.test.ts` corregida (no desactivada) |
| H005-06 nginx sin no-store ni catálogo en sus errores | `nginx.conf`: `proxy_hide_header` + `add_header Cache-Control "no-store" always`, 413/502/503/504 en JSON de catálogo, `proxy_request_buffering off` |
| H005-07 aviso sin modo ni fecha | `chat/registryEpisode.ts` + hooks de `runtime.ts`; objeto de aviso = episodio |
| respuesta guardada sin sanear | `sanitizeForRecord` (cédula/teléfono/correo; canales oficiales intactos) |
| drenaje del buffer no serializado | `Operations.flushVolatile` con una sola vuelta compartida; las repeticiones llegadas durante la escritura no se pierden |
| ETag en respuestas de chat | `app.disable("etag")` |

## Salvedades

- **Chromium únicamente**: Firefox, WebKit y móviles reales no se ejecutaron (N401 exige Chrome y Firefox → T077).
- nginx: destino `$backend` y `proxy_read_timeout` (2 s) sustituidos solo en la copia renderizada de la prueba; no hay imagen de producción construida ni Dokploy.
- `statement_timeout` no acota el COMMIT (ver `foundation.md`): un commit más lento que el presupuesto queda indeterminado.
- La purga horaria real del contenedor desplegado (2 ejecuciones automáticas) sigue pendiente (T076).
