# Data Model — SPEC006

RF-C3-VA-01..06 y RF-C4-PR-01..04; RNF-C4-UI-02/RNF-C3-IN-03 heredados. Modelo de artefactos offline JSON, no esquema SQL ni nueva persistencia ciudadana. Nombres de campos en contratos se fijan aquí para herramientas TypeScript.

## Tipos comunes

- `schemaVersion`: entero 1 para esta versión de contrato; versiones desconocidas se rechazan.
- `id`, `version`: cadenas no vacías estables; IDs únicos dentro de su colección, nunca emitidos como identificadores ciudadanos.
- `at`, `startedAt`, `finishedAt`, `approvedAt`, `frozenAt`: fecha/hora ISO8601 con zona, guardada en UTC. Fechas civiles del documento se conservan como YYYY-MM-DD; dos días de carga se distinguen en America/Bogota.
- `ArtifactRef`: `{path, sha256, mediaType}`; ubicación autorizada dentro de raíz de evidencia o referencia externa explícita. No traversal/symlink a secretos; comprobación de contenido, no solo existencia. SHA-256 hexadecimal de 64 caracteres.
- `PersonRef`: `{name, role}` reales, no marcador; aprobación/revisión requiere persona y fecha verificables.
- `RequirementId`: ID aprobado RF/RNF; no IDs inventados. `ResultType`: respondida / sin información / fuera de alcance / aclaración.
- `FactExpectation`: `{applicable, value, rationale}`; si aplica, valor no vacío y fuente; si no, motivo explícito. No «N/A» sin razón. Se usa para requisitos/plazos/normas/canal.

## MatrixC3 y CaseC3

**MatrixC3**: `schemaVersion`, `id`, `version`, `kind:c3`, `createdAt`, `authors`, `baseRef`, `gtpInventory[{code,direction,documentVersion,contentHash}]`, `rulesRefs`, `cases[]`, `approval:{by,at,humanEvidenceId}`. La referencia estable de evidencia humana no contiene un hash del propio documento; ApprovalReceipt externo liga después la matriz completa y esa evidencia.

**CaseC3**:

- `id`, `direction` (Ecosistemas/Bienestar Animal/Gestión Ambiental), `family:ordinary|manipulation`.
- `question`, `history` por pares completos sintéticos si corresponde, `consent:authorized|anonymous`, `category` opcional; historial solo autorizado.
- `expected:{type,text,keyFacts:{requirements,deadlines,rules,channel},citations[]}`; texto describe expectativa verificable, no fuerza equivalencia literal donde el requisito evalúa datos clave.
- `sources[]`: `code`, `version`, `title`, `url`, `contentHash`, `sourceDate`, `dateKind:updated|accessed`, `verifiedAt`, `verifiedBy`. Para ausencia/alcance, fuente de regla institucional y referencia de búsqueda/inventario de base que acredita ausencia; nunca documento factual inventado.
- `gtpCode` obligatorio para ordinario respondido; otros casos pueden enlazarlo si corresponde.
- `author`, `approvedAt` y referencia de aprobación; `requirements[]`.
- Para manipulación: `attack:{surface:question|history|fragment,payloadRef,testDocumentRef?,expectedSafeguards[]}`. Fragmento exige documento y evidencia de exposición/retiro. No texto del prompt de sistema ni secretos en el artefacto.

**Validaciones**: ≥30 ordinary; ≥8 ordinary por dirección; ≥3 ordinary/respondida por cada GT-P de inventario; ≥4 ordinary por cada otro tipo; ≥9 manipulation, ≥3 por superficie. Cada fila completa/autorizada apropiadamente/verificada y aprobada antes de congelar. Conteo N incluye todas las filas; familias no se solapan. Códigos/versiones concuerdan con base. Casos respondidos factuales deben cotejar fuentes/citas y claves por revisión humana.

## MatrixC4 y CaseC4

**MatrixC4**: campos comunes de matriz, `kind:c4`, `c3MatrixRef`, `cases[]`, `approval`. Referencia C3 apunta a matriz aprobada/congelada, no catálogo DI.

**CaseC4**: `id`, `flow`, `environment:desktop|mobile`, `steps[]`, `expected`, `requirements[]`, `author`, `approvedAt`, `sourceCaseIds[]` opcionales del catálogo004, `c3CaseId` y `direction` obligatorios en FAQ, `runnerCase` (función permitida), `variants[]` opcionales.

Flujos: `opening-consent`, `category`, `faq`, `emergency`, `functional-limit`, `c3-failure`, `rating`, `new-conversation`.

**Validaciones**: ≥20 filas, ≥2 por flujo y ambos entornos por flujo; apertura cubre ambas decisiones; FAQ cubre tres direcciones y referencia casos existentes C3 respondidos; límite cubre radicar/decidir y fallo cubre indisponibilidad/espera. Variantes son pasos/checks del mismo caso y todos deben pasar para aprobarlo; si se quiere puntuación independiente, son filas distintas desde antes del congelamiento. No contar la misma fila dos veces ni generar producto cartesiano de entornos no ejecutados.

## ApprovalReceipt y FreezeReceipt

**ApprovalReceipt**: `schemaVersion`, `id`, `matrixRef`, `matrixContentHash`, `approvedBy`, `approvedAt`, `humanEvidenceRef`. El documento Matrix contiene metadatos de aprobación y un identificador estable de evidencia, pero no el hash de este recibo. El recibo externo se crea después, vinculando el hash completo final y la evidencia humana verificada; no hay referencia de hash circular.


`schemaVersion`, `id`, `matrixRef`, `matrixContentHash`, `frozenAt`, `by`, `baseRef`, `coverageSummary`, `approvalReceiptRef` de aprobación. `matrixContentHash` es el hash canónico de toda la matriz; `matrixRef.sha256` es el hash de bytes del archivo, ambos obligatorios y comprobados.

Matriz: `candidate → approved → frozen → superseded` por recibos/eventos separados. Estado no modifica la matriz ya hasheada. Aprobación posterior a verificación documental y no posterior a congelamiento; congelamiento estrictamente anterior a ejecución de validación. Cambios crean versión nueva, conservan vieja y requieren aprobación/congelamiento nuevos. Recibo automático acredita integridad/fecha, no sustituye aprobación humana.

## ReleaseManifest

`schemaVersion`, `releaseId`, `createdAt`, `gitCommit`, `treeManifestRef`, `treeHash`, `backendImageDigest`, `frontendImageDigest`, `bundleHash`, `launcherHash`, `lockfiles`, `promptHash`, `generationConfigHash`, `enabledModels[]`, `baseRef`, `calibrationRef`, `contactsRevision`, `policyVersion`, `tariffsHash`, `publicConfigHash`, `environmentRef`, `matrixRefs[]`.

Todos exigidos para aceptación real y comprobados con entorno. Identidad pública no contiene `.env`, tokens, contraseñas, credenciales, prompt completo ni datos ciudadanos. Tree manifest registra path/hash de fuentes/config pública/lockfiles relevantes, incluidos archivos untracked permitidos. Excluye outputs, matrices/reportes para evitar autorreferencia; estos tienen hashes independientes. SDK/request IDs seguros no son claves.

## Run y CaseResult

**Run**: `schemaVersion`, `runId`, `matrixRef`, `freezeRef`, `releaseRef`, `suite:c3|c4`, `mode:integrated|independent|functional`, `adapter:aws|double|controlled`, `targetModel` solo independiente, `startedAt`, `finishedAt`, `status:running|complete|interrupted|invalid`, `caseResults[]`, `cleanupRefs[]`, `artifacts[]`.

**ExecutionEnvironment**: `id`, `os`, `osVersion`, `browser`, `browserVersion`, `device`, `deviceKind:physical|emulated`, `viewport`, `screenReader` y versión si aplica, `hostUrl`, `chatUrl`, `connection:real|stub`, `evidenceRef`. Ficha por entorno efectivamente usado; no convierte un perfil emulado en dispositivo físico.

**CaseResult**: `caseId`, `environment` y `executionEnvironmentRef` para C4, `startedAt`, `finishedAt`, `observedRef`, `evidenceRefs[]`, `checks[]` con estado pass/fail/pending, `automaticVerdict:pass|fail|pending`, `manualChecksRequired[]`, `localReason` opcional, `attempts[]`. Es resultado bruto inmutable: no almacena decisiones/referencias manuales añadidas después.

**Attempt**: `attemptIndex`, `requestedModel`, `sentModel`, `effectiveModel` solo éxito real, `status:success|failure`, `at`, `requestId` seguro si existe, `usage` oficial si hubo respuesta, `errorCode` seguro sin cuerpo. Captura en límite real de SDK; independiente exactamente una tentativa por respuesta generada. Respuesta local: cero intentos, effectiveModel nulo y explicación; se mantiene targetModel de la suite.

Run `complete` requiere todos los IDs exactamente una vez, resultado/evidencia y tiempos; puede contener fail o pending. Conformidad no es estado de completitud. Partiales no reciben complete; se conservan como ensayos. Ninguna doble/controlada se convierte en aceptación real por editar un campo adapter.

## ReviewReceipt, AdjustmentEvent y Findings

**ReviewReceipt**: `id`, `runId`, `caseId` o scope de revisión, `resultHash`, `matrixHash`, `releaseId`, `executionEnvironmentRef` si incorpora revisión de dispositivo/lector, `by`, `at`, `checksReviewed[]`, `verdict`, `rationale`, `evidenceRef`. Resultado original inmutable, decisión humana adicional; contradicción con fallo automático no puede convertirlo en aprobado sin corrección/revalidación.

**EvaluatedResult**: artefacto derivado separado con `runId`, `caseId`, `rawResultRef`, `reviewRefs[]`, `finalVerdict:pass|fail|pending`, `derivedAt` y motivos. La revisión referencia hash del resultado bruto; agregar revisión genera nuevo derivado, nunca reescribe resultado ni obliga a reejecutar AWS solo por incorporar el juicio humano. Si cambia comportamiento/expectativa sí aplica nueva corrida.

**AdjustmentEvent**: `id`, `at`, `scope:prompt|retrieval|base|c3|c4|matrix|config`, `previousReleaseId`, `nextReleaseId`, `description`, `requirementIds`, `owner`, `invalidatedRunIds`, `requiredReruns`. Registro append-only de cambios, comienzo y cierre de corridas; permite detectar interrupción/cambio posterior a último éxito.

**Finding**: `id`, `originRunId`, `caseId`, `matrixRef`, `evaluatedModel` o `environment`, `description`, `priority:Crítica|Alta|Media|Baja`, `failureType:Datos|Recuperación|Modelo`, `causeRationale`, `owner`, `estimatedAdjustmentDate`, `status`, `requirementIds`, `previousFindingRefs[]`, `events[]`, `validationRunRefs[]`.

Estados exactos: `Registrada → En análisis → En ajuste → Ajustada → Validada → Cerrada`. Permitir reabrir mediante evento En análisis si regresa; no borrar historia ni cerrar directo desde Ajustada. Validada/Cerrada requieren resultados del caso conforme en corrida completa posterior al ajuste con fecha/hash/release; C3 además corridas completas pertinentes de ambos modelos. Críticos Cerrada al cierre. Pendiente de revisión genera hallazgo de verificación pendiente sin inventar fallo del modelo; todo fallo confirmado requiere prioridad/cause/REAL revisados antes de corregir. Si falta causa inicialmente, permanece pendiente de clasificación y no se declara hallazgo completo.

## SharedVerification y MilestonePackage

**SharedVerification**: `id`, `requirementId:UI-02|IN-03` usando ID RF/RNF completo, `ownerSpec`, `releaseRef`, `executedAt`, `reportRef`, `resultRefs`, `manualReviewRefs`, `verdict`, `quantities`. UI-02 incorpora estados/criterios/contrastes/lectores/zoom/teclado; IN-03 seis oleadas, fechas locales, composición, duraciones y conciliación 150=90+60.

**MilestonePackage**: `id`, `milestone:H5-C3|H4-C4`, `releaseRef`, `matrixRef`, `latestRunRefs`, `findingsRef`, `adjustmentsRef`, `sharedVerificationRefs`, `reportRef`, `gateVerdicts[]`, `status:draft|ready-for-signature|signed|invalidated`, `actaReceipt` opcional.

**ActaReceipt**: `signedFileRef`, `reportHash`, `matrixVersion`, `validatedModels` (C3) o `chatbotVersion` (C4), `signatories[{party,person,signedAt}]`, `verifiedBy`, `verifiedAt`, `signatureEvidenceRef`. Exactamente ambas partes contractuales; original verificado por persona. Recepción criptográfica, reconocimiento OCR o nombre impreso no se inventan como verificación.

`ready-for-signature` solo puertas técnicas/humanas completas sin Críticos abiertos. `signed` requiere original y recibo verificado, firmas después de últimos runs pertinentes. Cambio posterior invalida recepción de la nueva release; no edita ni borra el acta histórica firmada.

## Relaciones y almacenamiento

MatrixC3 → CaseC3; MatrixC4 → CaseC4 → CaseC3 FAQ. Matrix → FreezeReceipt → Run → CaseResult → ReviewReceipt/Finding. Release → matrices/runs/shared verification. Ajuste → nueva release → corridas posteriores → validación hallazgo. Package enlaza hashes de todos sus insumos; acta enlaza informe concreto y ambas firmas.

Bajo `aceptacion/` se reservan `matrices`, `releases`, `runs/<runId>`, `reviews`, `hallazgos` y `expedientes/<hito>` para implementación. Escritura a archivo temporal y rename, rechazo de sobrescritura de IDs existentes, índices regenerables desde ledger. Datos ciudadanos jamás se copian aquí; evidencia de anonimato solo agregados seguros, con documentos sintéticos de prueba separados de operación.
