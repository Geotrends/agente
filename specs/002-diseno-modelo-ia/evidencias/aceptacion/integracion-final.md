# Integración local completa (T091)

**Fecha**: 2026-10-08 · Todo con `adapter=double` para Bedrock; PostgreSQL 16, Qdrant 1.19 y los modelos locales (embeddings y reranker) son **reales**. **No es aceptación**: faltan AWS, navegador y revisión funcional.

## Batería ejecutada

| Verificación | Resultado |
|---|---|
| `npx tsc -p tsconfig.check.json` (src + test + scripts) | sin errores |
| `npm test` (unitarias) | **330 / 330** |
| `npm run test:di-integration` (PostgreSQL + Qdrant + modelos locales) | **64 / 64** en 16 archivos |
| `npm run test:kb-integracion` | **57 / 57** (incluye la fragmentación nueva) |
| `npm run eval:tokenizer` | paridad exacta, 19 textos, tiktoken 0.14.0 `o200k_harmony` |
| Frontend: `npm test` (consentimiento + 8 recorridos del panel con jsdom) / build estático / `npm audit` | 14 / 14 · compila · 0 vulnerabilidades |
| Imagen del backend (`docker build`) | construye (typecheck incluido); dentro de la imagen cargan **argon2id** nativo (64 MiB / 3 / 1), el **tokenizador** con huella fijada y el SDK de Bedrock; no hay `tsx` |
| Imagen del frontend | construye |
| `chat-migrate` + bootstrap + purga **contra `postgres:16` real, usando la imagen compilada** | 6 migraciones aplicadas; segunda corrida idempotente; administrador creado por stdin (`must_change_password = true`); purga registra su corrida |
| `.github/workflows/ci.yml` | YAML válido (6 trabajos); **no se pudo ejecutar aquí** |

## Cobertura de lo que pide T091

| Pedido | Dónde se comprueba |
|---|---|
| UUID del backend, 12 solicitudes (8/4), 15→10 pares, tipos | `consent.test.ts` |
| 9 casos de error (validación, disponibilidad, tiempo, interno), formato y sin fugas | `error-contract.test.ts` |
| 14 saneamientos de PII y 9 inyecciones | `di-pii.test.ts`, `di-provider-privacy.test.ts` |
| 6 anónimas con 2 seguimientos; solo 6 campos | `consent.test.ts`, `consumption.test.ts`, `privacy.test.ts` |
| 6 fallos de escritura + 2 recuperadas, 1 aviso por episodio | `consumption.test.ts` |
| 2 purgas y retención 11 m 29 d / 12 m 1 d | `consumption.test.ts` |
| Perímetro: origen, 62→60/2, proxy, 128 KiB/+1, 20.000 caracteres, cola | `chat-perimeter.test.ts` |
| Roles, contactos (8/7/10), avisos (8 tipos), 5 estados, Gestor 403, base caída | `admin-security.test.ts`, `admin-contacts.test.ts`, `admin-operations.test.ts` |
| Pregunta de 20.000 caracteres sin truncar ni exponer secretos | `chat-perimeter.test.ts`, `privacy.test.ts` |
| Esquemas y destinos de registro **reales**, no solo mocks | `privacy.test.ts` recorre todas las tablas de `chat.*` y `admin.*` |

## Cambios de la batería respecto de lo heredado

- `test/http-smoke.ts` y `test/smoke.ts` **se eliminaron**: ejercían el contrato retirado (`message`, `provider`, `/providers`, 2.500 caracteres) y llamaban a proveedores externos. Tenían cambios locales tuyos; el original sigue en el historial de Git (`3f56d8e`). `npm run test:integration` ahora ejecuta la suite DI; se quitó `test:providers`.
- `test/relevance-threshold.test.ts` se eliminó y `test/diversity.test.ts` se reescribió: probaban el relleno con lo descartado y el umbral `>=`, que el contrato cambia (selección sin relleno, umbral estricto).
- `test/chunking.test.ts` se adaptó a la fragmentación nueva (artículos como metadata, tabla indivisible).

## Qué sigue sin hacerse (no se declara)

- Bedrock real: T092–T095 (rol temporal, cuota, costo manual, carga en dos días).
- Navegador y accesibilidad reales: T096. Firma funcional: T097.
- Calibración sobre el corpus y el oro **reales** y el efecto del límite de 1000 sobre las tablas del corpus.
