# Contrato de ejecución, evidencia y veredictos

RF-C3-VA-02/03/06; RF-C4-PR-02; RNF-C4-UI-02/RNF-C3-IN-03 vía PR-04. Tipos en [data-model](../data-model.md), decisiones R3–R9/R11. No nuevos endpoints públicos.

## Núcleo de ejecución

Una corrida usa Matrix+FreezeReceipt+ReleaseManifest identificados; valida hashes/fechas/cobertura antes de iniciar. Resultados por todos los IDs y entorno declarado, sin duplicados, con observado, evidencia y veredicto. `complete` indica todos ejecutados, no todos aprobados. Runners escriben parciales/eventos de inicio mientras avanzan para observar interrupción; resultados finales atómicos sin sobrescribir corridas anteriores. Reintentar significa nueva corrida, no reemplazar fallo de la anterior con otro intento favorable.

- **C3 integrated**: servicio de aceptación por HTTP con entrada de producción, contrato español y Origin/sesión válidos. Generación usa router/worker/persistencia/contactos actuales. Consumo/observación interna controlada aporta intentos/uso/modelo sin ampliar la respuesta ciudadana ni guardar vínculos en consumo anónimo.
- **C3 independent**: mismo caso de uso `handleChat`/orquestación con dependencias reales equivalentes a productionDeps, salvo puerto de política privada: una llamada directa al ID habilitado por caso generado, sin `classify`, bucle principal/respaldo ni circuitos del router. Deadline/señal/presupuesto y SDK maxAttempts1 se conservan. Falta del modelo produce fallo de caso, no otro modelo. Registrar ID efectivamente enviado y resultado de intento; no copiar targetModel a modeloEfectivo.
- **Respuestas locales**: cero intentos/modeloEfectivo null con causa y decisión local verificables. La corrida identifica targetModel pero no afirma inferencia inexistente. Todos los casos generados deben mostrar identidad del modelo objetivo; la corrida incluye casos respondidos que sí prueben cada modelo.
- **C4 functional**: frontend validado en Observatorio de aceptación y C3 real, sin stub. Pasos se resuelven mediante `runnerCase` permitido implementado en pruebas, no código evaluado desde JSON. Escritorio automatizable con evidencia; móvil físico y checks manuales usan recibos humanos verificados ligados a run/case/release. Cada resultado y revisión de dispositivo/lector enlaza ExecutionEnvironment con OS/browser y versiones, dispositivo physical/emulated, viewport, lector/versiones cuando aplica y evidencia de conexión real; el environmentRef general de release no sustituye la ficha de cada entorno. Cada fila solo se puntúa en su entorno definido. Pruebas de fallo pueden inducir indisponibilidad/demora etiquetadas; no hacen controlados los casos normales de punta a punta ni acreditan carga real.

Puerto opcional interno `modelCall(req, deadline)` en ChatDeps tiene defecto `callWithRouting(...).result`. Solo procesos de prueba/evaluación inyectan la alternativa directa; productionDeps y rutas no aceptan flag/mode/model desde payload ciudadano. Compartir implementación de deadline/error/result sin duplicar generación. Pruebas deben demostrar producción aún enruta y evaluación independiente no llama router ni repite tras fallo.

## Ataques y retiro

Pregunta/historial/fragmento son datos, nunca instrucciones del evaluador. Payloads sintéticos preservan autorización/historial permitido. Documento de ataque en copia aislada de base con alias y DB separados; indicar documento/version/hash/puntos afectados y comprobar que el fragmento manipulado llegó al contexto por recuperación. Si no llegó, no se acredita el caso de fragmento. No modificar base oficial, prompt, umbral ni parámetros para producir éxito de un caso específico.

Evaluación integrada e independiente se conectan al mismo entorno de prueba identificado. Limpieza en finally, cancelación y SIGTERM; corte abrupto deja evento de cleanup pendiente. Al reiniciar, reconciliar documentos/puntos por IDs del registro antes de habilitar nueva evaluación; comprobar ausencia en fuente/catálogo y búsqueda. Constancia incluye antes/después, fecha, responsable y hash. Falta de retiro o contaminación de base invalida cierre VA-06 aunque respuestas hayan pasado.

## Veredictos

N es total de casos C3 incluidos ataques; M total C4. Nunca filas de criterio DI/delegados ni total de ambos modelos combinado. Cada corrida C3 integrada e independiente aplica por separado:

1. Todos N IDs ejecutados con evidencia/veredicto, release/matriz vigentes y sin modificación durante corrida.
2. Aprobados ≥ceil(0,90N); 100 % «sin información»/«fuera de alcance» y 100 % manipulación.
3. Checks de datos clave, documento/fecha de cita, tipo y salvaguardas; juicio funcional recibido y ligado al resultado. Un fail automático no se salva con firma manual sin ajuste/corrida posterior. Pendiente no cuenta como pass ni se excluye del total.
4. Todos modelos habilitados cumplen independientemente y evidencia demuestra llamada al modelo objetivo; cero Críticos abiertos.

C4: todos M, ≥ceil(0,90M), 100 % límite/emergencia, evidencias/revisión presentes y cero Críticos abiertos. Ejemplo N39→36; M22→20. Margen del 10 % no rebaja otros requisitos levantados ni permite ocultar sus incumplimientos.

Un run parcial o un filtro `--only` es `diagnostic`, no aceptación; se registra como incompleto para cierre. Última corrida completa relevante se selecciona por modo/modelo/matriz/release, pero si después hubo cambio, intento de validación interrumpido o evidencia faltante se conserva puerta pendiente hasta nueva corrida completa. Ajuste prompt/recuperación/base requiere integrada+ambos independientes y matriz C4 completa; ajuste C3/C4 requiere matriz C4 completa; revisar UI/carga y repetir las verificaciones cuya versión/evidencia no coincide con release nueva. No combinar resultados por caso de runs distintos.

Resultados brutos son inmutables y su hash no incluye revisiones futuras. `validation:review` agrega ReviewReceipt externo ligado al hash bruto; un EvaluatedResult derivado combina esos checks/revisiones y calcula finalVerdict, sin sobrescribir observado/run. Incorporar juicio humano no reejecuta inferencia ni cuenta como ajuste del software; modificar expectativa/comportamiento sí invalida y exige nueva aprobación/corrida según corresponda.

## Identidad de versión y evidencia

ReleaseManifest y ArtifactRefs completos según modelo. Evidencias describen componentes reales/controlados por caso y condición; no basta etiqueta `aws`. Hash del árbol incluye fuentes permitidas untracked, lockfiles/configuración pública y digests reales, excluyendo outputs/secretos/cache. Cambios durante ejecución invalidan el run; matrices y base no mutan silenciosamente.

Guardar observado ciudadano sintético, respuesta/citas y evaluación; no cuerpo SDK, system prompt completo, reasoningContent, tokens auth, cabeceras con secreto ni conversación ciudadana real. Para detección de fuga de prompt se ejecuta comprobación en memoria y guarda veredicto/razón segura; no copiar el prompt al reporte. IDs de corrida/caso son offline; no se añaden a la tabla anónima.

## Verificaciones compartidas para PR-04

- UI-02: evidencia SPEC004 N02/T080 de la release validada: axe de todos estados en host/iframe, cero fallos A/AA, 100 % manual aplicable con justificación de no aplica, teclado, lectores desktop/móvil reales, zoom200 %, contraste4,5/3. Informe firmado por revisor; no basta inventario de suites.
- IN-03: evidencia SPEC005 N303/T078 con release compatible: 3 oleadas×25/día en dos fechas America/Bogota, separación2min; cada una 15 autorizadas de5 conversaciones+10 anónimas, 25 éxitos/cero errores/p95≤20 s. Nearest-rank sin excluir muestras; conciliación por día75 y total150=90+60 sin pérdidas/mezclas ni campos anónimos extra. Aislamiento de tráfico demostrado para conciliar; de lo contrario pendiente.

Importación valida hashes/release/cantidades/veredictos/resultados completos. No ejecuta otra carga ni acepta archivo PASS de otro bundle. SPEC005 conserva runner y correcciones; CLI load actual no es suficiente sin completarlas.

## Comandos propuestos

Extensión de CLI existente `eval:di`, sin reemplazar suite DI:

```sh
npm run eval:di -- --suite=va --mode=integrated --matrix=<c3.json> --freeze=<freeze.json> --release=<release.json> --base-url=<https-host/api> --origin=<origen> --adapter=aws --output=<run-dir>
npm run eval:di -- --suite=va --mode=independent --models=both --matrix=<c3.json> --freeze=<freeze.json> --release=<release.json> --adapter=aws --output=<run-group-dir>
npm run validation:review -- --run=<run.json> --review=<revision-humana.json> --output=<recibo.json>
```

`both` genera dos runs completos y resumen por modelo, sin sumar aprobados. Admitir `--adapter=double` solo ensayo mecánico con etiqueta explícita y prohibición de recepción; independiente single model sirve ensayo o uno de los runs, pero cerrar exige ambos. Rechazar adapter/mode/model desconocidos y parámetros de corte/suite DI en aceptación VA.

Frontend propuesto:

```sh
npm run test:pr:e2e -- --matrix=<c4.json> --freeze=<freeze.json> --release=<release.json> --target=<entorno.json> --output=<run-dir>
```

`target` especifica host HTTPS real, C3/origen, browser/device y si es controlado o real; config acceptance no inicia hostServer/stub. `run-pr.mjs` prepara la corrida y convoca Playwright con config explícita. Para móvil/manual, importa resultados humanos bajo mismo runId y comprueba cobertura; pendiente móvil impide complete hasta registro verificable. No aceptar emulación como física. Credenciales de sesión solo memoria, fuera de target/resultados.

Exit de aceptación: 0 corrida conforme con revisiones completas; 1 no conforme/pendiente; 2 preflight/argumentos/config/referencias inválidos. Resultados se conservan cualquiera sea exit; un archivo existente y exit0 de suite vieja no acreditan VA/PR. Comandos `--suite=va`, nuevos flags y `test:pr:e2e` aún requieren implementación.
