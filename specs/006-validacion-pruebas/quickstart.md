# Quickstart de validación — SPEC006

RF-C3-VA-01..06, RF-C4-PR-01..04 y UI-02/IN-03 heredados. Esta guía define el recorrido **después de implementar** el plan. No se ejecutaron estas pruebas al planificar, no hay matrices aprobadas ni actas firmadas creadas por este comando. Consulte [matrices](contracts/matrices.md), [execution](contracts/execution.md) y [findings-delivery](contracts/findings-delivery.md) para campos/umbrales.

## 1. Prerrequisitos y situación de comandos

- Revisar SPEC001–005 y [continuidad](continuidad.md); base publicada/fichas/fuentes/contactos/política/calibración vigentes, servicios PostgreSQL/Qdrant y frontend/C3 reales identificados.
- Entorno AWS autorizado con rol de instancia exclusivo, ambos modelos habilitados, dependencias lockfile instaladas y release con digests/hashes de código/config pública. Completar correcciones de005 antes de acreditar IAM/carga; no usar llaves de sesión local como rol servidor.
- Instancia de aceptación aislada para ataques, sin ciudadanos ni alias oficial; permisos limitados, limpieza/reconciliación y almacenamiento privado de evidencia sintética. Supervisión y Geotrends disponibles para revisión/firma posterior.
- Escritorio y móviles físicos, lectores escritorio/móvil, acceso a Observatorio de aceptación con origen/CSP correctos; ningún stub en matriz integrada.

Comandos **existentes** verificados en package.json: backend `typecheck`, `test`, `test:di-integration`, `test:ui-integration`, `test:in-integration`, `test:kb-integracion`, `eval:di`, `eval:di-load`; frontend `typecheck`, `test:ui`, `build:e2e`, `test:ui:e2e`. `node frontend/scripts/report-ui.mjs --json` es inventario, no ejecuta casos ni acredita PR.

Comandos **implementados**: backend `test:validation`, `test:validation-integration`, `validation:check`, `validation:freeze`, `validation:review`, `validation:report`, `validation:acta`; flags `eval:di --suite=va` y frontend `test:pr:e2e`. Disponibles en package.json; requieren los insumos privados descritos abajo. `eval:di-load` existe, pero todavía necesita correcciones SPEC005 para acreditar mezcla/contrato/conciliación/versiones.

## 2. Verificar herramientas y regresiones locales

Desde raíz, con bases aisladas/configuración de tests de los quickstarts previos, después de implementar:

```sh
npm --prefix backend run typecheck
npm --prefix backend run test:validation
npm --prefix backend run test:validation-integration
npm --prefix backend run test:di-integration
npm --prefix backend run test:ui-integration
npm --prefix backend run test:in-integration
npm --prefix backend run test:kb-integracion
npm --prefix frontend run typecheck
npm --prefix frontend run test:ui
npm --prefix frontend run build:e2e
npm --prefix frontend run test:ui:e2e
```

Esperado: pruebas nuevas rechazan falsos positivos y gates de CI previos conservados. Dobles y perfiles móviles emulados comprueban mecánica; no reciben etiqueta de aceptación AWS/dispositivo. Ninguna suite vacía se considera cumplimiento. Auditoría sin vulnerabilidades altas y builds de imágenes se ejecutan como CI del repo.

## 3. Aprobar y congelar matrices

Preparar candidatos JSON bajo `specs/006-validacion-pruebas/aceptacion/matrices/` con fuentes verificadas, personas/fechas reales. Referencia de base e inventario real; preguntas frecuentes C4 enlazan C3. Distribución candidata C3≥39/C4=22 según research, ajustable con cobertura sin reducir mínimos. Ejecutar comandos propuestos de [matrices](contracts/matrices.md) usando rutas reales de candidata/inventario/recibo y salida nueva.

Esperado: campos/cobertura correctos; aprobación humana anterior a congelamiento; hashes incluyen expectativas/aprobación. Falta de fuente/revisión conserva candidata y no habilita corrida de aceptación. No rellenar datos de aprobación para hacer pasar validación.

## 4. Ejecutar C3 y revisar resultados

En entorno autorizado, desde backend, con rutas de matriz/recibo/release y target realmente identificados, ejecutar ambos comandos `eval:di --suite=va` del contrato [execution](contracts/execution.md): integrated y independent/models=both. El segundo produce dos runs independientes. No `--only`, no force-cut, no fallback, no combinación de aprobados entre modelos.

Esperado: todos los casos con resultados/evidencia; independientes una tentativa por respuesta generada al modelo objetivo y cero en respuestas locales identificadas. Casos de fragmento prueban exposición; constancia de retiro al terminar o después de interrupción. Cada corrida cumple ≥ceil90 %, grupos protegidos100 % y revisión funcional. Con39, ≥36 por corrida; pendientes semánticos implican exit1 hasta revisión registrada, no fallo de la herramienta.

El revisor coteja datos clave/citas/fechas/tipos/salvaguardas y registra recibos mediante `validation:review` ligados a hashes. Registrar hallazgos con prioridades/cause/REAL y responsables; corregir en dueño001–005/006, emitir release/evento de ajuste y repetir todas las matrices pertinentes completas. No editar respuestas observadas ni adoptar la última corrida antigua favorable.

## 5. Ejecutar C4 conectado y verificaciones compartidas

Desde frontend, usar `test:pr:e2e` implementado del contrato execution con matrix/freeze/release/target reales. Completar evidencias móviles físicas y revisiones humanas por caso. Registrar fecha/release/screenshot o registro por cada fila; variantes obligatorias completas. Esperado: M filas completas, ≥ceil90 % (22→20), emergencia/límite100 % y ningún Crítico abierto.

Importar informe accesibilidad SPEC004 N02/T080 completo y revisado: axe host/iframe/estados0 incumplimientos, manual100 %, teclado, lectores/zoom/contraste. Importar carga SPEC005 N303/T078: seis oleadas en dos días locales, cada una25 con15 de5 conversaciones+10 anónimas, pausas2min, 0 errores/p95≤20 s y150 registros90+60 conciliados. Deben coincidir con release del ChatBot validado. Si falta muestra/conciliación/dispositivo/versionado, sigue pendiente aunque exista archivo PASS.

Seguir [guía de carga005](../005-integracion-c3-c4/quickstart.md) y su [contrato](../005-integracion-c3-c4/contracts/performance-evidence.md) una vez corregidos los runners; no lanzar carga externa ni retiro de roles automáticamente desde esta guía de planificación.

## 6. Informes y actas

Preparar insumos de ambos expedientes, ejecutar `validation:report --require-ready` propuesto para cada hito. Esperado: informe con cuatro elementos H5 y seis H4, últimas corridas/revisiones íntegras, cero Críticos sin Cerrada, verificación compartida vigente; estado ready-for-signature, sin firma generada.

Entregar borradores e informe por el canal contractual establecido para revisión humana. Después de firmas auténticas de ambas partes, posteriores a las últimas corridas, registrar recibo del original y ejecutar `validation:acta`. Esperado: hashes/versiones/modelos coinciden, original verificado por persona, fechas/firmas reales; signed solo entonces. No publicar originales ni enviar documentos automáticamente.

Un pendiente en acceso/revisión/carga/retirada/firma mantiene su puerta abierta y permite continuar preparación independiente. El objetivo de este recorrido es demostrar aceptación real, nunca transformar la generación correcta de un reporte en recepción contractual.

## Implementación local disponible (2026-10-11)

El núcleo offline, matrices C3 y recibos están implementados. `test:validation`, `test:validation-integration` (arnés; pruebas de integración se agregan con US2), `validation:check` y `validation:freeze` están registrados. Las demás herramientas propuestas en secciones anteriores siguen pendientes hasta su implementación. No hay candidata oficial verificada, aprobación ni aceptación real emitida.

Las operaciones nuevas requieren `--root=<directorio-evidencia-existente>`: matrix/base/approval/output son paths **relativos** seguros dentro de esa raíz; no symlinks ni traversal. El inventario de base es JSON `{schemaVersion:1,gtpInventory:[{code,direction,documentVersion,contentHash}]}` con los mismos códigos/versiones/hashes que la matriz. Conservar la identidad de su exportación desde la base publicada; escribirlo a mano no acredita publicación. `--by=<archivo-persona.json>` es un archivo `{name,role}` del operador real; no aprueba la matriz.

```sh
npm --prefix backend run validation:check -- --root=<evidencia> --matrix=matrices/c3.json --base=base.json --kind=c3 --output=diagnosticos/c3-nuevo.json
npm --prefix backend run validation:freeze -- --root=<evidencia> --matrix=matrices/c3.json --base=base.json --approval=matrices/c3.approval.json --by=<persona.json> --output=matrices/c3.freeze.json
```

`check` exit0 valida estructura, cobertura y refs; no verifica aprobación humana. `freeze` coteja matriz completa/bytes/recibo/evidencia/fechas y usa hora efectiva del proceso, sin aceptar fecha de congelamiento del caller. Crear salida nueva; no sobrescribir histórico. No ejecutar estos ejemplos con personas o documentos sintéticos como aceptación real.

### Herramientas VA y hallazgos implementadas

Desde `backend`, `npm run eval:di -- --suite=va --mode=independent --models=both --adapter=aws --root=<raíz-privada> --output=<misma-raíz> --source-root=<repo> --matrix=<relativa> --freeze=<relativa> --release=<relativa> --attack-manifest=<relativa>` produce una corrida por modelo. Requiere configuración del servidor con rol, base/calibración vigentes y copia aislada. Para integrated se usan `--mode=integrated --base-url=<https-api> --origin=<https-portal> --observations=<directorio-relativo>`; cada observación privada debe ligar respuesta/matriz/release/intentos reales y exposición. No existe selector público de modelo. Sin observaciones no se atribuyen intentos.

`validation:review` importa recibos humanos ligados al hash del bruto; revisiones sucesivas se combinan en derivados nuevos, sin reinferencia ni modificación histórica. Para reevaluar una corrida existente: los mismos argumentos de identidad a `eval:di`, añadiendo `--evaluate-run=<run-relativo> --reviews=<json-array-de-ArtifactRef>`. No requiere reinferencia. Exit0 exige conformidad revisada y entorno real; doble/controlado o pendiente devuelve1; configuración inválida2. Cada nuevo derivado conserva referencias.

Operaciones privadas disponibles: `node --import tsx scripts/validation.ts finding-register --root=<raíz> --finding=<json-relativo> --run=<run-origen-relativo> --output=<nuevo-json>` y `finding-transition --root=<raíz> --finding=<versión-anterior> --event=<evento-relativo> --proof=<prueba-relativa> --output=<nuevo-json>`. El proof es `{runs:[{runRef,reviewRefs}],adjustmentReleaseRef}`; Validada/Cerrada necesitan corridas completas posteriores del caso, ambos modelos C3, misma matriz y release del ajuste. Las vistas Markdown se generan desde JSON. No inventar causa REAL, responsable o revisión: un documento incompleto devuelve1 y permanece pendiente de clasificación fuera del registro completo.

### Docker de pruebas aisladas

Desde la raíz: `docker compose -p spec006-validation -f docker-compose.validation.yml build validation`, luego `docker compose -p spec006-validation -f docker-compose.validation.yml run --rm validation npm run test:validation-integration`. La red interna no expone puertos; PostgreSQL/Qdrant usan almacenamiento temporal; la imagen no monta corpus ni secretos del host y desactiva IMDS. `down` retira exclusivamente este proyecto. El proveedor es doble: estas pruebas no certifican AWS ni firmas contractuales.

### C4 disponible y límites actuales

`validation:check` admite `--kind=c4` con `--c3-freeze=<recibo-relativo>`; `validation:freeze` detecta kind y exige ese recibo para C4. La matriz enlaza C3 aprobada/congelada. Mantener `--base` como identidad explícita del expediente. FAQ debe referenciar casos C3 respondidos; runnerCase solo admite los ocho flujos y variants usa valores declarados por el validador.

Desde `frontend`: `npm run test:pr:e2e -- --root=<raíz-privada> --matrix=<relativa> --freeze=<relativa> --release=<relativa> --environments=<json-relativo> --target=<json-relativo> --source-root=<checkout>`. Target contiene hostUrl/chatUrl HTTPS reales; environments contiene ArtifactRef desktop/mobile de fichas completas. La automatización móvil requiere deviceKind=emulated y connection=real, conserva una fila por ID sin multiplicación por perfiles y devuelve1 hasta revisión. No levanta hostServer/stubApi ni modifica CSP. Una ficha emulada no acredita móvil físico; el importador físico se describe abajo y los ensayos de sus 22 casos conservan clasificación controlada.

C4 también permite `--mobile=manual`: ejecuta únicamente las filas desktop del mismo catálogo íntegro y guarda `awaiting-manual.json` con status=running. `node --import tsx scripts/validation.ts pr-import --root=<raíz> --run=<awaiting-manual.json> --results=<json-relativo>` importa `{results:[CaseResult],reviewRefs:[ArtifactRef]}` para IDs faltantes, exige fichas physical/real con lector y recibos ligados al bruto/matriz/release, y conserva runId. Nuevos checkpoints son inmutables. Una corrida emulada/controlada conserva esa clasificación. AWS en C4 requiere release real, desktop físico con versión de navegador coincidente y móvil importado manualmente; todas las revisiones siguen obligatorias. `validation:review` rechaza juicio de dispositivo/lector sobre ficha emulada.

### Informes y actas disponibles

`npm run validation:report -- --root=<raíz> --milestone=H5-C3|H4-C4 --package=<insumos-relativos> --output=<nuevo-directorio> [--require-ready]` genera informe Markdown, expediente JSON, insumos hashables y borrador de acta. Sin require-ready, exit0 solo confirma generación; con él, pendientes/fallos devuelven1. Las puertas conservan requisitos fuente de001–005, últimas corridas por modo/modelo, revisiones y Críticos Cerrada; H4 añade UI-02 e IN-03 de la misma release. `sourceGatesRef` contiene catálogo completo de `sourceRequirements.ts`, persona/fecha/evidencia y puertas con resultados normalizados del dueño (requisito/release/ownerSpec/ownerCaseId/runnerRef/status/executionClass/verdict/criteria/ejecución/evidencia), no solo un archivo PASS.

SharedVerification conserva esquema de data-model. quantities identifica ownerCaseId=N02 o N303, executionEnvironmentRefs, rawResultRefs y reconciliationRef para carga. UI importa estados/contextos axe y criterios manuales/lectores/contraste/zoom; carga importa las muestras originales de `eval:di-load` y reutiliza `loadRunner` para auditar cada oleada. Los recibos manuales externos ligan resultHashes, releaseRef, persona, fecha, veredicto y evidencia. La herramienta no ejecuta otro medidor de carga.

`npm run validation:acta -- --root=<raíz> --package=<directorio/expediente.json> --receipt=<recibo-relativo> --output=<nuevo-json>` reevalúa insumos contiguos y comprueba original/evidencia privados, hash de informe, matriz/modelos o bundle, ambas partes y fechas posteriores. Solo entonces emite estado signed en otro archivo; nunca firma ni envía. Los recibos sintéticos se usan únicamente dentro de tests.

El registro de un hallazgo comprueba el caso, modelo/entorno y run de origen mediante `--run`; para resultados locales C3 sin inferencia se usa `evaluatedModel:null`, nunca un modelo atribuido. El runner PR exige `--source-root` para comprobar el árbol de código antes y después de la corrida. La reevaluación VA rechaza una corrida invalidada o desplazada por otra posterior del mismo grupo, incluso interrumpida. Las puertas fuente verifican también el spec dueño del requisito.

### Repetir ensayos dentro de la imagen

```sh
docker compose -p spec006-validation -f docker-compose.validation.yml run --rm validation npm run typecheck
docker compose -p spec006-validation -f docker-compose.validation.yml run --rm validation env -u AWS_EC2_METADATA_DISABLED npm test
docker compose -p spec006-validation -f docker-compose.validation.yml run --rm validation npm run test:validation-integration
```

El unset solo corresponde a unitarias que comprueban la configuración contractual EC2 y esperan IMDS habilitado. Los proveedores de prueba usan dobles y la red sigue interna; no introduce credenciales ni acceso a AWS. La integración VA conserva AWS_EC2_METADATA_DISABLED=true. No usar ese ajuste para acreditar readiness real.
