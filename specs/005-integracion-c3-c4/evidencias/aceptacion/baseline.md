# Baseline SPEC005 (T001)

Fecha: 2026-10-10. Rama: `develop`. Punto de partida de la integración; **no es evidencia de aceptación** y no da por aceptadas las tareas de SPEC001–004.

## Repositorio

| Dato | Valor |
| --- | --- |
| HEAD | `3f56d8e91a78e8cf9f39c86472940f58eb5f09e8` |
| Cambios locales sin commit | 186 entradas (108 sin seguimiento `??`, 66 modificadas `M`, 12 eliminadas `D`) |
| Directorios relevantes sin seguimiento | `backend/src/{chat,admin,bedrock,kb}`, `backend/migrations/`, `backend/config/`, `backend/test/{di,ui,kb}-integracion/`, `frontend/{chat,widget,scripts}`, `.github/`, `.specify/` |
| Node local | v26.11.0 (el proyecto declara Node 22 en Dockerfile/CI) |

## Digests y hashes (SHA-256)

| Artefacto | Hash |
| --- | --- |
| `backend/package-lock.json` | `8bb647de204d44df7312163017eb49a1b8ec2bf1ce7774aa55e0ffa3833aa3b8` |
| `frontend/package-lock.json` | `10bd7d9649a32c3069df19b6ecd7e750bb623aad01128decc633b671ec337e67` |
| `backend/package.json` | `7ac4507308418519d23f114a602a506100961f17605e26e9692f7f3f895ea13e` |
| `frontend/package.json` | `80ed96e6fbad4755b3a08c5aa0ece5cb6837cd47d68d6488238c9e253496b9ab` |
| `docker-compose.yml` | `2aedfb862f0aca3bc6c3880b2a2030a252e4d60b1b83414e244c997300a1e193` |
| `frontend/nginx.conf` (antes de SPEC005) | `0f37ac17daaefadaf8c3279222ae25406afda0714d9abf7ef51ed1e4844c8502` |
| `backend/src/prompts/institutionalTexts.ts` | `9d625706be76251e9b9eb1ed55b21da84d12e036b1ea47276208aa4d88529a33` |
| `backend/src/prompts/tutorPrompt.ts` | `9ee501d534f4836a93b2b9b3dd0b96c4d1759eca5b9f152c3091695f0be42115` |
| `backend/config/base-conocimiento.json` (matriz publicada) | `22628bf0c3ecd851618a4e3fba8e73dcfb52bf4ad9d3f1c6ffc6c9b954d996f8` |
| PDF `DOCUMENACION_C3_C4.pdf` | `2fe87aab471d38aba8f636a650681a45efa9106b25673e4927d264de6cceda2f` (coincide con `requisitos-pdf.txt`) |

Imágenes Docker: no se construyeron imágenes del proyecto en este entorno (no hay digests de backend/frontend que registrar). Única imagen local de apoyo: `qdrant/qdrant:v1.19.2-unprivileged`, digest `sha256:efb96a9425a90d2d5a1a0a474156280df1892dcdf1af3e8515bd2589b1bfd88b`.

Calibración: la calibración vigente vive en la base (`kb` migración `004_calibracion.sql`) y no existe en el árbol; este entorno no tiene corpus real publicado. **Pendiente de entorno real** (T074).

Configuración pública relevante en el árbol: `.env.example`, `docker-compose.yml`, `frontend/nginx.conf`. Ningún secreto copiado.

## Marcas de tareas de specs previas (conteo de `- [x] T…`, no por existencia de archivos)

| Spec | Marcadas / total contadas | Observación |
| --- | --- | --- |
| SPEC001 | 89/92 | coincide con `diagnostico.md` (89/91) salvo diferencia de conteo del regex |
| SPEC002 | 94/102 | `diagnostico.md` indica 93/100; pendientes T092–T098 siguen siendo AWS real/carga/revisión |
| SPEC003 | 35/36 | T035 (navegador real) pendiente |
| SPEC004 | 77/84 | T078–T084 pendientes (portal, dispositivos, servicios reales) |

Las diferencias de ±1–2 son de método de conteo; ninguna marca previa se tomó como aceptación.

## Línea base de pruebas locales (antes de cambios de SPEC005)

| Suite | Resultado |
| --- | --- |
| `npm --prefix backend run typecheck` | sin errores |
| `npm --prefix backend run test:di-integration` | 64/64 pasan (PostgreSQL 16 y Qdrant 1.19 locales aislados; proveedor doble) |

Entorno: PostgreSQL local en `127.0.0.1:55432` (`initdb` temporal), Qdrant en Docker `127.0.0.1:56333`. Etiqueta de componentes: DB real aislada, proveedor Bedrock **doble**, sin AWS/portal/dispositivos reales.

## Contradicciones conocidas que las pruebas actuales aún no detectan (de `diagnostico.md`)

H005-01 (Origin ausente permitido), H005-02 (cadena de credenciales amplia), H005-03 (purga vacía `cited_documents`), H005-04/05 (plazo y duración desde después de cola), H005-06 (nginx sin no-store en errores), H005-07 (aviso sin modo), H005-08/09 (carga/aislamiento). Se corrigen en Fases 2–8.
