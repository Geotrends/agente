# Implementation Plan: SPEC006 — Validación y pruebas C3–C4

**Branch**: `develop` (rama Git real) | **Date**: 2026-10-10 | **Spec**: [spec.md](spec.md)

**Input**: `specs/006-validacion-pruebas/spec.md`. `setup-plan.sh --json` devolvió FEATURE_DIR e IMPL_PLAN de 006 y BRANCH lógico `006-validacion-pruebas`; no creó ni cambió la rama Git. Feature activa: `specs/006-validacion-pruebas`.

## Summary

Construir el proceso de aceptación de H5-C3/H4-C4 sobre SPEC001–005: matrices de casos verificadas/aprobadas/congeladas, evaluaciones completas con evidencia, hallazgos trazables y expedientes con firmas humanas. Cubrir 10 RF esenciales del Bloque 6 y reutilizar UI-02/IN-03; no existen RNF propios de este bloque.

Extender herramientas DI/UI existentes para aceptar matrices externas y resultados de corridas. Corregir forzado de modelo sin enrutamiento/respaldo, identidad del modelo observada y falsos positivos de reportes por presencia de archivos. Generación/recuperación/flujos/registro permanecen en los módulos actuales. La aceptación independiente agrega un puerto privado de política de llamada, sin selector ciudadano. Matrices/hallazgos/evidencias son entregables offline JSON+Markdown, no un nuevo panel ni base operativa.

[Research](research.md) resuelve decisiones R1–R11; [continuidad](continuidad.md) conserva referencias y pendientes previos. Los artefactos de este comando diseñan el trabajo; no ejecutan validación ni firman hitos.

## Technical Context

**Language/Version**: TypeScript con versiones resueltas por lockfiles, Node.js 22 de Docker/CI; backend Express 4 y frontend Next.js/React existentes. Scripts frontend .mjs existentes se conservan; nueva lógica compartida offline en TypeScript. Python solo herramientas offline previas, sin nuevo servicio.

**Primary Dependencies**: `node:crypto`, `node:fs`, `node:test`, `tsx`, `pg`, cliente Qdrant y AWS SDK v3 existentes; Playwright/axe/Vitest existentes para C4. Validadores explícitos de JSON y contratos tipados, sin nueva librería ni actualización general. SDK actual usa Converse; SPEC005 debe completar rol de instancia exclusivo. No se añade proveedor de evaluación ni LLM juez.

**Storage**: Matrices/candidatas, recibos de aprobación/congelamiento, resultados, revisiones, eventos/hallazgos y expedientes en directorio offline de aceptación con archivos JSON versionados y vistas Markdown. Firmas humanas conservadas como originales externos/archivos referenciados por hash. PostgreSQL/Qdrant operativos existentes se reutilizan; bases aisladas para ataques/pruebas, sin nuevas tablas ciudadanas ni migración de producto prevista. Acceso a evidencia sintética restringido, secretos excluidos y originales firmados fuera de repositorio público.

**Testing**: Unitarias de matrices/hashes/cobertura/porcentajes/vigencia/hallazgos/expedientes; integración PostgreSQL+Qdrant reales con AWS doble para política privada/retiro; regresiones DI/UI/IN/KB existentes. Playwright local con stub sigue CI; nueva configuración de aceptación conecta C3 real. AWS/modelos, móviles físicos, teclado/lectores, revisión semántica y actas requieren ejecución/revisión manual explícitas con evidencia.

**Target Platform**: Herramientas privadas Node22 en entorno de aceptación Linux AWS/Docker/Dokploy con rol IAM de SPEC005; C4 escritorio y móviles físicos sobre Observatorio de aceptación. No ejecutar AWS desde llaves locales ni cambiar CSP/producto para acomodar fixtures.

**Project Type**: Extensión del arnés de aceptación offline de aplicación web existente, con contratos de archivos/CLI y entrega documental a supervisión.

**Performance Goals**: C3 conserva p95≤20 s y error≤40 s; C4 intento≤45 s conforme specs previos. PR-04 exige 25 simultáneas, 0 errores, p95≤20 s por oleada, 3 oleadas/día separadas 2 min, dos días y 150 registros correctos. No nuevos objetivos de latencia del validador offline.

**Constraints**: Matrices congeladas antes de validar; hash completo con expectativas/aprobación, identidad con archivos relevantes untracked; ≥90 % redondeado hacia arriba por corrida/modelo, 100 % grupos protegidos, Críticos Cerrada. Una sola tentativa al modelo objetivo en corrida independiente; respuestas locales con cero llamadas identificadas, nunca modelo inventado. Base oficial intacta; retiro acreditado de documento/puntos de prueba. Evidencia y firma reales, sin fechas o aprobaciones sintetizadas.

**Scale/Scope**: C3 ≥30 ordinarios +≥9 ataques (39 con seis GT-P); N=39 exige ≥36 aprobados en cada corrida: una integrada y dos independientes. C4 ≥20 casos; distribución propuesta de 22 flujos exige ≥20 aprobados, distinta del catálogo de 22 verificaciones004. UI-02 e IN-03 compartidos; dos expedientes y dos actas separadas. No generación de tasks en esta fase.

## Constitution Check

Evaluación **previa a investigación**: PASS del enfoque de extensión de herramientas, sin nuevo alcance ciudadano ni excepciones I–X. Evaluación **posterior a diseño**: PASS I–X mediante puertas siguientes. Brechas actuales son trabajo obligatorio y prerequisitos de aceptación, no dispensas. No se declara conforme la implementación.

| Principio | Puerta antes de Phase 0 | Comprobación de diseño después de Phase 1 |
| --- | --- | --- |
| I Orientación | Mantener alcance y leyenda | VA/PR prueban alcance, radicación/decisión y emergencia; 100 % de subconjuntos protegidos |
| II Anclaje | Esperadas desde fuentes oficiales | Matriz conserva fuente/versiones/datos clave; verificación humana de citas; ataques no alteran reglas |
| III Base cerrada | Solo base publicada y prueba aislada | Hash de base, alias/copia aislados sin ciudadanos, cleanup normal/fallo/reinicio, retiro de puntos probado |
| IV Privacidad | Solo preguntas sintéticas en evidencia | Evidencia sanitizada sin tokens/secretos/texto real, anonimato sin nuevos IDs; relaciones offline no se agregan a registro anónimo |
| V Proveedor | Solo dos modelos AWS existentes | Política privada directa sin routing/fallback; registro en límite SDK, rol exclusivo previo de005; sin juez externo |
| VI Falla segura | Conservar salida y plazos | Casos C3/C4 reales/controlados identificados; default de producción intacto; fallos de arnés no cuentan como éxito |
| VII Seguridad | Ningún selector/endpoints nuevos | Puerto inyectable solo proceso privado; JSON no ejecuta comandos; acceso restringido y hash seguro; CSP/origen no relajados |
| VIII Accesibilidad | UI-02 heredado completo | Axe por estado/host/iframe + manual100 %, lectores desktop/móvil, contraste/zoom misma versión |
| IX Trazabilidad | IDs fuente/corridas completas | Cada caso/run/ajuste/hallazgo enlaza requisito; últimas corridas vigentes y dos expedientes con originales de firmas |
| X Pruebas | Pruebas significativas y CI | Negativos contra falsos positivos hallados; DB/Qdrant integración, regresiones, tipos/auditoría/imágenes; manual expreso |

Deuda histórica de la constitución se contrasta contra estado real antes de corregir; no se amplía. Las correcciones IAM/carga/perímetro previstas en005 son prerequisitos de evidencia real, no trabajo duplicado en006.

## Project Structure

### Documentation (this feature)

```text
specs/006-validacion-pruebas/
  spec.md
  continuidad.md
  plan.md
  research.md
  data-model.md
  quickstart.md
  contracts/
    matrices.md
    execution.md
    findings-delivery.md
  checklists/requirements.md
  evidencias/
    requisitos-pdf.txt
    validacion-plan.md
```

Durante implementación se crearán `aceptacion/matrices`, `aceptacion/releases`, `aceptacion/runs`, `aceptacion/reviews`, `aceptacion/hallazgos` y `aceptacion/expedientes` bajo esta feature o un directorio privado equivalente. No crear contenido aprobado/firmado ni respuestas esperadas inventadas durante planificación. `tasks.md` se generará con `/speckit-tasks`.

### Source Code (repository root)

```text
backend/
  scripts/eval-di.ts                  # ampliar suite=va y modo integrated/independent
  scripts/lib/{diAcceptance,diRunner}.ts # conservar catálogo DI; adaptar infraestructura
  scripts/lib/validation/             # nuevo: matrices, identity, runs, review, findings, report
  scripts/validation.ts               # nuevo CLI privado de artefactos
  scripts/{eval-di-load,eval-di-traffic}.ts # reusar; carga corregida por005
  src/chat/{handleChat,modelRouting,runtime,orchestrator}.ts # puerto privado; default inalterado
  src/bedrock/{askBedrock,client}.ts    # evidencia acotada de intento/modelo efectivo
  test/validation-*.test.ts            # nuevos negativos/verificación offline
  test/validation-integracion/         # nuevo arnés sobre infraestructura DI/KB/IN existente
frontend/
  scripts/report-ui.mjs               # inventario004, sin atribuir aceptación
  scripts/run-pr.mjs                  # nuevo: matriz→funciones permitidas/resultado por caso
  playwright.config.ts               # CI controlada existente
  playwright.acceptance.config.ts    # nueva: host/C3 real, sin stub
  test/pr/                            # nuevo: casos/steps que reusan004
  test/helpers/                      # helpers existentes; stub separado de aceptación
.github/workflows/ci.yml              # nuevos validadores/regresión; sin AWS ni firmas en CI
```

**Structure Decision**: Extender evaluadores y módulos existentes con un pequeño núcleo de artefactos offline. No copiar motores RAG, introducir tablas/pantallas de matrices ni reemplazar rutas históricas de003 por implementaciones nuevas. Módulos nuevos de validación son infraestructura de los requisitos VA/PR, no funcionalidades públicas. Todas las rutas nuevas indicadas son propuestas y aún no comandos/archivos ejecutables.

## Execution Design

| Fase futura | Salida y trabajo | Dependencias / puerta |
| --- | --- | --- |
| F0 Inventario y prerequisitos | Estado real de001–005, revisión de contratos, identidad de release, fuentes/contactos/política/calibración, accesos y propietarios de brechas | Puede empezar ahora; no cerrar tareas por marcas/archivos |
| F1 Matrices y núcleo | Esquemas/validadores/hashes/eventos; candidatas con cobertura, expectativas verificadas y revisión humana; aprobación/congelamiento real de cada matriz | F0 y fuente vigente; no inventar fechas/firmas. C4 frecuentes referencia matriz C3 |
| F2 Evaluación C3 | Suite VA en herramientas DI; puerto privado de llamada independiente, integrado HTTP, captura segura SDK, aislamiento ataque y cleanup; pruebas negativas | F1 para corrida aceptable; implementación del arnés puede usar matrices sintéticas antes de aprobación |
| F3 Evaluación C4 | Casos PR con pasos reutilizados, runner/reporter de resultados, config real sin stub, recibos móviles/manuales | F1; integrado requiere C3 y flujo003/004/005 reales. No ocultar resultados fallidos |
| F4 Evidencia compartida | UI-02 de004 e IN-03 de005 sobre release C4 validada; validar hashes, manual, seis oleadas/dos días/conciliación | Prerequisitos reales y correcciones004/005; no segundo load runner |
| F5 Ajustes y regresión | Hallazgos completos/severidad/REAL, responsable y ajuste en módulo dueño; repetir matrices enteras y verificaciones invalidadas | F2/F3/F4; Críticos Cerrada antes de habilitar expediente |
| F6 Informes y actas | Informes H5/H4 separados, evidencia y veredicto por requisito, últimos runs vigentes, borradores de acta y revisión/firma externa; recibos de originales | Solo tras puertas completas; firmas humanas posteriores a última corrida; no publicarlas automáticamente |

Una ejecución completa con casos fallidos puede ser `completa` y `no_conforme`; una corrida parcial/interrumpida no habilita recepción. Preparación y ensayos controlados permiten progreso aunque falten accesos humanos/externos, pero la evidencia dependiente queda pendiente. Ajustes posteriores invalidan veredictos anteriores; no escoger una corrida antigua favorable.

### Responsables y coordinación con specs anteriores

- SPEC001 mantiene matriz/base/fichas y retiro/publicación; su T082/T083/T092 sigue dueño de aceptación propia. 006 documenta expectativas y usa copia identificada, no altera fuente oficial.
- SPEC002 mantiene generación/recuperación/calibración/modelos; 006 corrige herramientas VA y puerto privado de política. T092–T098 de002 se pueden enlazar solo si sus cantidades/criterios coinciden; el 90 % VA no los sustituye.
- SPEC003 mantiene consentimiento/categoría/emergencia; SPEC004/005 documentan convergencia física. 006 cubre PR y puede compartir evidencia con T035 sin cerrar por referencia.
- SPEC004 mantiene UI/accesibilidad/instalación/móviles, incluyendo N02/T080. 006 es dueño de matriz PR y expediente H4. Su runner nuevo no reconstruye componentes.
- SPEC005 mantiene contrato operativo/IAM/plazos/perímetro y load/conciliación. T063/T064 y T078 completan IN-03; 006 importa resultado firmado/revisado en misma release, no asume runner actual suficiente.
- Un defecto tiene propietario técnico, requisito origen y VA/PR que lo detectó. Si varias listas tocan el mismo archivo, coordinar una corrección y sus pruebas, evitando implementaciones concurrentes duplicadas.

### Estrategia de pruebas y aceptación

1. **Automáticas offline**: rechazar campos vacíos/duplicados, mínimos por dirección/GT-P/tipo/superficie/flujo/entorno, fuentes/fechas falsas, hash modificado, congelamiento posterior, expectativas omitidas del hash, evidencia ausente, release distinta, resultados duplicados/faltantes y agregación de modelos. Probar ceil(0,9N), protegidos100 %, manual pendiente y corrida parcial invalidante.
2. **Integración controlada**: verificar defecto actual de forzado contra prueba que exige una llamada sin router/breaker/fallback; producción conserva routing normal; respuesta local no inventa modelo. Probar ataque realmente recuperado y eliminación de puntos con interrupción/reconciliación; DB/Qdrant reales aislados, sin AWS en CI.
3. **C4 controlado**: regresiones de estados/reinicio/fallos/valoración y mapeo de matriz a pasos permitidos; cualquier archivo sin resultado se queda pendiente. Mantener tests004 y no permitir cero tests como aprobación.
4. **Real C3/C4**: integrado e independientes completos, SDK con rol exclusivo, modelo efectivo/usage, textos sintéticos; móvil físico y pruebas desktop conectadas, revisiones semánticas y fuentes abiertas. Fallos inducidos se distinguen en evidencia y son válidos solo para lo que se simula explícitamente.
5. **Manual**: redactor/revisor verifican esperadas contra fuentes, campos no aplicables razonados, citas/fechas/datos clave, tipo y defensas; responsables revisan severidad Crítica/Alta; accesibilidad manual y verificación de firma originales. Cada juicio referencia hash/run/caso y fecha/persona.
6. **CI/handoff**: conservar gates de tipos/unitarias/integración/auditoría sin altas/builds imágenes. Agregar pruebas nuevas; no red de inferencia ni firmas en CI. Entregar informe de últimos resultados y pendientes; el acta solo se firma cuando corresponde.

### Trazabilidad completa

| ID | Fases | Contrato / criterio |
| --- | --- | --- |
| RF-C3-VA-01 | F0/F1/F2/F6 | matrices; SC-001 |
| RF-C3-VA-02 | F2/F5/F6 | execution; SC-002/004 |
| RF-C3-VA-03 | F2/F5/F6 | execution; SC-002/004 |
| RF-C3-VA-04 | F2/F5/F6 | findings-delivery; SC-005 |
| RF-C3-VA-05 | F6 | findings-delivery; SC-009 |
| RF-C3-VA-06 | F1/F2/F5/F6 | matrices/execution; SC-003 |
| RF-C4-PR-01 | F1/F3/F6 | matrices; SC-006 |
| RF-C4-PR-02 | F3/F5/F6 | execution; SC-007/004 |
| RF-C4-PR-03 | F3/F5/F6 | findings-delivery; SC-005 |
| RF-C4-PR-04 | F4/F6 | findings-delivery; SC-008/010 |
| RNF-C4-UI-02 | F3/F4/F5/F6 | execution; SPEC004 N02/T080, SC-008 |
| RNF-C3-IN-03 | F4/F5/F6 | execution; SPEC005 N303/T078, SC-008 |

## Complexity Tracking

Sin violaciones constitucionales propuestas ni excepciones. Núcleo offline, puerto privado de llamada, configuración de aceptación aislada y evidencia referenciada sostienen requisitos existentes. La persistencia JSON de entregables de pruebas no reemplaza PostgreSQL de datos operativos. Dos conjuntos de casos VA/PR amplían herramientas, no duplican motores de respuesta. Accesos y firmas pendientes no son incertidumbres de arquitectura ni motivo para atribuir recepción anticipada.
