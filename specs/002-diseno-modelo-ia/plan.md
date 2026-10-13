# Implementation Plan: Bloque 2 — Diseño del modelo IA

**Branch**: `develop` | **Date**: 2026-10-08 | **Spec**: [spec.md](spec.md)

**Input**: `specs/002-diseno-modelo-ia/spec.md`. Identificador de feature devuelto por setup: `002-diseno-modelo-ia`; no es una rama Git creada. Feature activa restaurada a bloque 2 después de detectar puntero al bloque 1. Solo documentación de planificación; sin implementación ni despliegue.

## Summary

Completar los 25 RF y 3 RNF del bloque 2 aprovechando recuperación híbrida, base publicada, lógica local y frontend actuales. Reemplazar el enrutamiento multivendor por un adaptador AWS Bedrock de dos modelos; corregir historial por intercambios, privacidad antes de salida, citas verificables, fragmentación/selección, canales administrables, consumo en PostgreSQL y degradación visible. Estado de partida: 0 completos, 21 parciales, 7 ausentes; [diagnóstico](diagnostico.md). La implementación deberá resolver dependencias mínimas de consentimiento, contrato público y panel seguro, sin reconstruir todo el bloque 7.

## Technical Context

**Language/Version**: TypeScript 5.6 compatible con configuración existente; Node22 del CI/Docker; React/Next según lockfile vigente. Python 3.12 solo scraper/evaluación offline.

**Primary Dependencies**: Express 4, pg 8, SDK AWS v3 `@aws-sdk/client-bedrock-runtime` y proveedor de credenciales temporales explícito, `argon2` para contraseñas del panel; Transformers.js y Qdrant existentes. Versiones exactas nuevas se fijarán en lockfile tras auditoría en implementación; no actualización general del stack.

**Storage**: PostgreSQL16: preservar esquema `kb`, agregar esquemas `chat` y `admin` y runtime limitado; Qdrant publicado por alias `kb_chunks`, sin nuevo índice en memoria. Retirar CSV activo de interacciones. Historial ciudadano solo en memoria volátil del iframe; sin textos en cookies/sessionStorage/URL. Token de panel opaco en cookie HttpOnly, sin conversación.

**Testing**: `node:test` + tsx para unitarias; integración contra PostgreSQL/Qdrant reales siguiendo arnés existente; contratos HTTP con proveedor simulado; evaluación offline y aceptación real de ambos modelos; pruebas de navegador para consentimiento, sanitización, permisos y WCAG manual. Extender CI con tipos/frontend/build/auditoría y pruebas de nuevas interfaces.

**Target Platform**: Linux AWS, contenedores Docker/Dokploy sobre EC2 con rol de instancia mínimo; opción ECS no necesaria. Región inicial `us-east-1`, validada al despliegue; IAM solo modelos in-region autorizados. Ningún servicio público Python.

**Project Type**: Aplicación web existente, frontend Next con salida estática y nginx, backend Express, worker KB independiente. Panel como rutas estáticas cliente; autorización real siempre backend, sin confiar en ocultación del frontend.

**Performance Goals**: Error terminal en ≤40 s desde llegada, incluidos cola y recuperación (RF-C3-IN-04); objetivo adicional de integración p95≤20 s y 25 simultáneas (RNF-C3-IN-02/03), verificación real separada. Estado AD-48 visible en<60 s. Recuperación top 16/top 8, fragmentos 1000/150, 10 intercambios, 2200 salida, conforme spec. Sin prometer que la configuración por sí sola prueba rendimiento.

**Constraints**: Solo Bedrock 20b/120b, sin tráfico a otros proveedores; embeddings/OCR/reranking locales; contraseñas argon2id; modos de autorización y retención 12 meses+24 h; rate limit 60/min/IP en ventana deslizante y cuerpo 128 KiB sin límite adicional de caracteres (RNF-C3-IN-05/06). Sin contactos hardcoded, sin webhook ni edición del prompt en panel.

**Scale/Scope**: 28 requisitos DI, dependencias directas IN/DC/AD listadas en spec y controles constitucionales de superficies tocadas. Panel mínimo: inicio/cambio obligatorio de contraseña, contactos, estado y avisos con contador; esquema de dos perfiles y protección del último administrador. No incluye gestión documental web completa, valoraciones/analítica, navegación institucional nueva, aceptación global H5-C3 ni publicación del sitio.

## Constitution Check

*Evaluación previa fase 0 y posterior fase 1: PASS de diseño para I–X. Esto no declara conforme el código vigente ni acepta el hito.*

| Principio | Puerta antes de investigar | Verificación del diseño final | Resultado |
| --- | --- | --- | --- |
| I Orientación | No ampliar alcance ni radicar/decidir | Guion, guardas y resultados fuera de alcance/aclaración; DI-01/09/20, apertura C4-DC-01 | PASS |
| II Anclaje | Solo evidencia publicada y contactos del registro | Recuperación estricta, intersección de fuentes, citas fechadas, GT-P prevalente, ataque 9 casos; DI-04/05/07/08/11/24, RNF-IN-11 | PASS |
| III Base cerrada | Reutilizar matriz/alias bloque 1 | No tocar alcance del corpus, bloqueo de tablas no conformes y cambio de alias atómico; DI-13, RNF-IV-02 | PASS |
| IV Privacidad | Autorización y anonimato distintos | Contrato por pares, saneamiento e identificadores backend, retención y no-store; DI-23, RNF-DI-01, IN-01/02/06/07 | PASS |
| V Proveedor | Sustituir deuda, no añadir Bedrock a multivendor | Allowlist de dos IDs y IAM, puntaje local, prompt único, uso/costo/2200; DI-02/03/16/17, RNF-DI-02/03 | PASS |
| VI Falla segura | Ningún fallo de búsqueda equivale a ausencia | Deadline, respaldo, RRF directo, registro best effort y avisos solo panel; DI-03/06/18, IN-04/08, AD-48 | PASS |
| VII Seguridad | No panel sin autenticación | Dos perfiles, argon2id, bloqueo, sesión 30 min, CSRF, auditoría append-only, perímetro; AD-01..10, RNF-AD-01..07 | PASS |
| VIII Accesibilidad | Mantener integración liviana existente | Pantallas nuevas y respuestas HTML seguras con teclado/lector, enlaces nueva pestaña y guía institucional; DI-10/25, RNF-AD-09/RNF-C4-UI-03 | PASS |
| IX Trazabilidad | Cada cambio respalda RF/RNF aprobado | Matriz de 28IDs, investigación con decisiones, oro congelado y hallazgos REAL; VA-01/03/05 | PASS |
| X Pruebas | Corregir pruebas que validan contradicciones | Automatizadas de comportamiento, CI bloqueante y revisión manual explícita; ningún test desactivado | PASS |

**Deuda y migración**: Multivendor/CSV/contactos fijos/webhook se retiran de caminos activos en esta feature. La migración de KB a Qdrant ya existe y se preserva. Administración documental completa pendiente sigue fuera de alcance; las dependencias que prueban DI-03/06/19/20/24 se construyen aquí, no se dejan simuladas para cierre. No hay excepción constitucional aprobada ni necesaria. La excepción de umbral con reranker caído es la regla expresa DI-06 del PDF.

## Project Structure

### Documentation (this feature)

```text
specs/002-diseno-modelo-ia/
├── spec.md
├── diagnostico.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── chat-api.md
│   ├── bedrock-runtime.md
│   ├── retrieval.md
│   ├── admin-api.md
│   └── acceptance.md
├── checklists/requirements.md
└── evidencias/             # evidencias iniciales; aceptación futura en subcarpetas
```

`tasks.md` se generará mediante `$speckit-tasks`; esta fase termina con diseño.

### Source Code (repository root)

```text
backend/
├── src/
│   ├── bedrock/            # nuevo adaptador único
│   ├── chat/               # nuevos contratos, persistencia, consentimiento y política
│   ├── admin/              # nuevo acceso, contactos, estado y auditoría
│   ├── prompts/            # prompt compartido y textos institucionales
│   ├── routes/             # adaptar chat/auth; añadir administración mínima
│   ├── services/           # conservar answerQuestion/search/contextBudget/PII/circuitBreaker
│   ├── shared/             # resultados de modelo con usage y stopReason
│   └── kb/                 # preservar worker; cambiar fragmentación/indexación según DI
├── migrations/            # no modificar migración001 aplicada; nuevas numeradas
├── db/                    # bootstrap y migrador compatible con volúmenes existentes
├── scripts/               # aceptación, calibración y pruebas operativas offline
└── test/                  # unitarias + integración/contratos DI
frontend/
├── app/admin/             # nuevas pantallas estáticas protegidas por servicio
├── shared/                # contratos, saneamiento Markdown y sesión en memoria
└── smart/                 # consentimiento, pares, tipos, respuesta/citas
web_scraper/               # preservar; leer informes para pantalla de estado
.github/workflows/ci.yml   # extender controles obligatorios
```

**Structure Decision**: Extender los dos proyectos existentes, sin servicio adicional de IA ni plataforma de administración distinta. Separar permisos de escritor chat/admin de lector KB; reutilizar mecánica de migraciones sin conceder DDL al runtime ni propiedad de KB.

## Execution Design

1. **Preparar contratos y persistencia**. Schemas, roles, migrador y modo consentimiento; convertir historial a pares validables, contador finito de complejidad y resultado contractual. IN-01/02/03/05/06/07, DI-02/15/16/23 y RNF-DI-01. Migraciones nuevas para volúmenes existentes; rollback de runtime no reactiva proveedores prohibidos ni CSV.
2. **Modelo autorizado y consumo**. Adaptador Converse, allowlist 20b/120b, rol, deadline y respaldo una vez, usage/stopReason y costo decimal. DI-03/16/17/18 y RNF-DI-02/03. Tests normales simulados sin AWS; aceptación real final en staging autorizado.
3. **Contactos y panel mínimo seguro**. Autenticación, cambio de contraseña y permisos de dos perfiles; snapshot versionado de contactos, avisos agrupados y pantalla de estado. DI-03/06/19/20/24; AD-28/29/30/35/36/37/41/48 y RNF-AD. Depende de 1, puede avanzar junto con 2.
4. **Recuperación y corpus**. Fragmentación 1000/150 con tablas atómicas, metadatos de fechas, top 16, filtro estricto, deduplicación irreversible, diversidad y orden. RRF top 8 directo sin reranker. Reindexar colección nueva y calibrar contra oro; alias/corpus/calibración se activan como versión consistente. DI-05/06/12/13/14/15.
5. **Composición institucional**. Política de alcance/urgencia/insuficiencia, prompt compartido, evidencia y precedencia, marcador de fuentes con IDs recuperados, ensamblado backend de citas/leyenda/avisos/canales y privacidad. DI-01/04/07/08/09/10/11/19/20/21/22/23/24/25. El backend garantiza elementos fijos; tono/estructura se evalúan, no se presumen.
6. **Validación y entrega de diseño**. Ejecutar matriz completa en cada modelo, recalibración registrada, rendimiento/permisos/PII/tráfico y revisión manual; repetir después de cada cambio relevante. Todos 28; VA-01/03/05. Consolidar informe final con versión y hallazgos REAL; los tests locales iniciales no son aceptación.

**Orden interno de consulta**: plazo desde recepción → perímetro/validación/autorización → snapshot de contactos → detección/mascarado de datos → política local de alcance/urgencia/insuficiencia → recuperación si corresponde → complejidad por pares → modelo principal/respaldo → fuentes/corte/composición → intento acotado de registro → respuesta con identificador solo si persistencia confirmó éxito. Si la política requiere apoyo semántico, se resuelve dentro de la misma generación anclada; nunca usar clasificación remota para complejidad ni hacer consulta abierta sin evidencia.

**Presupuesto inicial de ingeniería**: deadline total 40 s; reservar 2 s para composición/registro/entrega, recuperación hasta 5 s y repartir remanente LLM entre principal y respaldo; SDK sin reintentos ocultos. Objetivo operativo terminar antes de 39 s para margen de transporte; el timeout debe cubrir también cola, preparación del contexto y escritura. Ningún fallo permite esperar más allá del plazo. Ajustar partición con mediciones sin cambiar límite contractual.

**Riesgos y mitigación**: Disponibilidad/cuota del rol AWS y valores oficiales de contactos/tarifas son insumos de despliegue, sin inventar defaults. Tablas>1000 impiden publicar esa versión; continuar alias anterior. Semántica de PII libre y clasificación de riesgo necesita pruebas reales y revisión funcional, sin prometer detección por regex universal. Panel/backend deben mostrar fallo de PostgreSQL desde estado volátil y persistir aviso al recuperar; no enviar contenidos a colas de logs. Ver investigación y contratos.

### Trazabilidad de implementación y aceptación

La cobertura por caso, número y tasa permanece en [contracts/acceptance.md](contracts/acceptance.md); las fases siguientes guían `$speckit-tasks` sin sustituir sus dependencias.

| ID | Fase de desarrollo | Contrato principal |
| --- | --- | --- |
| RF-C3-DI-01 | 1 y 5–6 | [contrato](contracts/chat-api.md) |
| RF-C3-DI-02 | 1–2 y 6 | [contrato](contracts/bedrock-runtime.md) |
| RF-C3-DI-03 | 1–2 y 6 | [contrato](contracts/bedrock-runtime.md) |
| RF-C3-DI-04 | 1 y 5–6 | [contrato](contracts/chat-api.md) |
| RF-C3-DI-05 | 4 y 6 | [contrato](contracts/retrieval.md) |
| RF-C3-DI-06 | 4 y 6 | [contrato](contracts/retrieval.md) |
| RF-C3-DI-07 | 1 y 5–6 | [contrato](contracts/chat-api.md) |
| RF-C3-DI-08 | 1 y 5–6 | [contrato](contracts/chat-api.md) |
| RF-C3-DI-09 | 1 y 5–6 | [contrato](contracts/chat-api.md) |
| RF-C3-DI-10 | 1 y 5–6 | [contrato](contracts/chat-api.md) |
| RF-C3-DI-11 | 1 y 5–6 | [contrato](contracts/chat-api.md) |
| RF-C3-DI-12 | 4 y 6 | [contrato](contracts/retrieval.md) |
| RF-C3-DI-13 | 4 y 6 | [contrato](contracts/retrieval.md) |
| RF-C3-DI-14 | 4 y 6 | [contrato](contracts/retrieval.md) |
| RF-C3-DI-15 | 4 y 6 | [contrato](contracts/retrieval.md) |
| RF-C3-DI-16 | 1–2 y 6 | [contrato](contracts/bedrock-runtime.md) |
| RF-C3-DI-17 | 1–2 y 6 | [contrato](contracts/bedrock-runtime.md) |
| RF-C3-DI-18 | 1–2 y 6 | [contrato](contracts/bedrock-runtime.md) |
| RF-C3-DI-19 | 3–5 y 6 | [contrato](contracts/admin-api.md) |
| RF-C3-DI-20 | 3–5 y 6 | [contrato](contracts/admin-api.md) |
| RF-C3-DI-21 | 1 y 5–6 | [contrato](contracts/chat-api.md) |
| RF-C3-DI-22 | 1 y 5–6 | [contrato](contracts/chat-api.md) |
| RF-C3-DI-23 | 1 y 5–6 | [contrato](contracts/chat-api.md) |
| RF-C3-DI-24 | 3–5 y 6 | [contrato](contracts/admin-api.md) |
| RF-C3-DI-25 | 1 y 5–6 | [contrato](contracts/chat-api.md) |
| RNF-C3-DI-01 | 1–2 y 6 | [contrato del modelo](contracts/bedrock-runtime.md) |
| RNF-C3-DI-02 | 1–2 y 6 | [contrato del modelo](contracts/bedrock-runtime.md) |
| RNF-C3-DI-03 | 1–2 y 6 | [contrato del modelo](contracts/bedrock-runtime.md) |

## Complexity Tracking

Sin violaciones constitucionales justificadas. Schemas y roles separados son controles de permiso requeridos por privacidad/auditoría y preservación de KB; no crean un tercer proyecto o proveedor. El control de consentimiento y panel mínimo son dependencias contractuales directas, no funcionalidades nuevas sin requisito.
