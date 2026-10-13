# Entorno real de aceptación — identificación (T074)

Fecha: 2026-10-10. **Estado: NO identificado ni accesible desde esta sesión.** Este documento lista lo que el repositorio permite afirmar y lo que **falta** para ejecutar T075–T081. Ninguna tarea dependiente se marca; no se infiere publicación productiva.

## Lo que el repositorio ya fija (público, sin credenciales)

| Elemento | Valor | Fuente |
| --- | --- | --- |
| Origen autorizado a incrustar el chat | `https://observatorioenvigado.geotrends.co` | `frontend/scripts/build-csp.mjs` (defecto), contrato SPEC004 |
| Región y modelos | `us-east-1`; `openai.gpt-oss-20b-1:0` y `openai.gpt-oss-120b-1:0` | `backend/src/services/diConfig.ts`, `iam-bedrock-policy.json` |
| Topología esperada | Traefik/Dokploy → nginx del frontend → backend (`TRUST_PROXY=2`) o solo nginx (`1`) | `.env.example`, `docs/arquitectura-sistema.md` |
| Servicios | `backend`, `frontend`, `postgres`, `qdrant`, `kb-worker`, `chat-migrate`, `chat-purge`, `scraper` | `docker-compose.yml` |

## Lo que falta (prerrequisitos de ejecución, no decisiones de diseño)

| # | Falta | Lo necesitan | Quién lo aporta |
| --- | --- | --- | --- |
| 1 | Cuenta/instancia AWS de aceptación con **rol de instancia exclusivo**, IMDSv2 y hop limit comprobados | T075, T076, T078 | operación AWS |
| 2 | Autorización operativa escrita para invocar los 2 modelos, retirar/restituir el rol y ejecutar cargas | T075, T078, T079 | titular del servicio |
| 3 | URL pública del servicio desplegado (`IN_BASE_URL`), `IN_ORIGIN`, `CONSENT_POLICY_VERSION` y política de datos vigentes | T076, T078 | operación |
| 4 | Base publicada identificada (versión/hash) y **calibración** vigente, contactos oficiales cargados y **tarifas** vigentes de ambos modelos | T076, T078 | equipo KB / operación |
| 5 | Acceso al panel autenticado para editar un contacto y observar avisos/estado (C310, C308) | T076 | administrador técnico |
| 6 | URL de la página del Observatorio de aceptación y una **petición de referencia del Geoportal** (método, URL, cuerpo sintético, criterio de éxito) | T077, T079 | titular del portal |
| 7 | Reindexación completa de SPEC001 ejecutable en ese entorno y ventana autorizada | T079 | equipo KB |
| 8 | Dispositivos reales: Chrome Android, Safari iOS, Chrome y Firefox de escritorio, lector de pantalla | T077 | revisor |
| 9 | Dos días distintos (America/Bogota) con tráfico ajeno separable o ventana exclusiva | T078 | operación |

## Qué sí se hizo (controlado, ver `integracion-local.md`)

Arnés, runners, contratos y pruebas con PostgreSQL real aislado, proveedor doble, nginx real en Docker local y navegador Chromium. Etiquetado `C`/`DB`; **no** `A/P/H/B`.

## Estado de las tareas dependientes

T075–T081 permanecen **pendientes** hasta contar con los ítems 1–9. Si falta acceso, se continúa solo con trabajo independiente; la falta de acceso no autoriza a relajar la matriz, los tiempos ni la privacidad.
