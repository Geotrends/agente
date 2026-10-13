# US5 local — protección de servicio e identidad (T059)

Fecha: 2026-10-10. Componentes: **C + DB** (PostgreSQL real aislado, proveedor y metadatos de instancia simulados), **P-parcial** (nginx real en Docker local) y **C emulado** (Chromium). **Pendientes y NO conformes**: rol exclusivo real, 2 modelos reales, 4 denegaciones reales, IMDSv2/hop limit del servidor y Safari iOS/Chrome Android reales (T074/T075/T077).

## Cantidades ejecutadas

| Caso | Prueba | Cantidades | Resultado |
| --- | --- | --- | --- |
| N304 | `di-integracion/chat-perimeter.test.ts` | 8 orígenes: 2 válidos (POST y preflight exactos) y 6 rechazos 403 (sin Origin, preflight ajeno, subdominio, http, puerto, dominio padre); 0 llamadas al LLM, 0 filas; sin cabeceras CORS ni cache | pasa |
| N305 | `chat-perimeter.test.ts` + `trust-proxy.test.ts` | 62 consultas en el minuto = 60 + 2 con 429 y Retry-After; 300 consultas a 60/min durante 5 min sin 429; otra IP con su cupo; TRUST_PROXY=2 resiste la cabecera falsificada; TRUST_PROXY=1 con un proxy extra comparte cupo (lo que el aviso `[proxy]` detecta) | pasa |
| N306 | `chat-perimeter.test.ts` | 100 KB, 20.000 caracteres (multibyte), 131072 → 200; 131073 y 5 MB (con Content-Length y en streaming) → 413 con `retained=0` y lectura contada solo hasta cruzar el límite | pasa |
| N306 (nginx) | `cache-entrypoint.test.ts` | 413 generado por nginx real en JSON de catálogo con `no-store`; cuerpo lento a través del proxy cuenta contra el plazo | pasa |
| N307/N308 (documento) | `instance-role.test.ts`, `iam-policy.test.ts` | IMDS simulado: credenciales solo del rol (decoys de llaves/perfil/bearer ignorados), IMDSv2 sin retroceso, rol retirado → `auth`, timeout acotado; 14+ fuentes rechazadas por nombre; política: 1 acción, 2 ARN, 2 éxitos y 5 denegaciones (tercer modelo, listado, bucket, llaves, streaming) | pasa |
| N310 | `secret-redaction.test.ts` | 8 escenarios (4 fallos, 2 éxitos, 1 reinicio, 1 revisión), 7 señuelos, 0 fugas; repo/paquete: 282 archivos, 0 hallazgos | pasa |
| N311 | `injection-matrix.test.ts` + `scripts/eval-injection.ts` | 9 inyecciones (3 pregunta / 3 historial / 3 fragmento) × 2 modelos con el doble conforme = 18 ejecuciones, 0 fallos; control negativo detecta obediencia y filtración del prompt | pasa (controlado) |
| N402 | `frontend/test/widget-csp.spec.ts` + `cache-entrypoint.test.ts` | 6 pruebas: 2 válidas (host autorizado, ocultar/mostrar con un iframe), 3 bloqueos (origen ajeno, subdominio, página sin origen), 1 cabecera (CSP de producción: único `frame-ancestors https://observatorioenvigado.geotrends.co`, sin `unsafe-inline`, sin `X-Frame-Options`; verificada también con nginx real) | pasa |

## Cambios

`app.ts` (guardas antes de CORS, sin ETag), `chat/perimeter.ts` (preflight/origen/cuota separada/descarte sin acumular), `services/trustProxy.ts`, `bedrock/client.ts` (`fromInstanceMetadata`, IMDSv2), `services/diConfig.ts`, `config/iam-bedrock-policy.json`, `scripts/{check-iam-policy,eval-injection,scan-secrets}.ts`, `frontend/nginx.conf` (cabeceras alternativas borradas, `no-store`), `.env.example`, `docs/arquitectura-sistema.md`.

## Salvedades

- Chromium únicamente; la CSP efectiva en navegadores móviles reales es T077.
- La matriz de inyección con el doble prueba el **camino** (saneamiento, aislamiento en el prompt, evaluador), no la conducta de los modelos reales: eso exige `npm --prefix backend run eval:injection -- --adapter=aws --models=both` en el entorno autorizado (T075) y, si cambia prompt/base/recuperación, la matriz congelada completa de SPEC002 (T080).
- `N305` sobre la topología real (Traefik → nginx → backend) con IP real sigue pendiente (T076).
