# Validación de diseño — SPEC006

**Fecha**: 2026-10-10. Revisión de artefactos de `/speckit-plan`; no ejecución del software, AWS/carga ni aceptación de hitos.

## Resultado

Plan y diseño preparados para `/speckit-tasks`. Constitución I–X: PASS del diseño antes de investigación y después de fase1, sin excepciones. Trazabilidad completa: seis VA, cuatro PR y dos RNF heredados. Decisiones R1–R11 resueltas; accesos, expectativas verificadas, aprobaciones, evidencia real y firmas siguen prerequisitos de ejecución, no preguntas de arquitectura sin resolver.

Artefactos: plan.md, research.md, data-model.md, quickstart.md y contracts/matrices.md, execution.md, findings-delivery.md. Se preservaron spec/checklist originales y artefactos previos; no se creó tasks.md ni se cambió código del producto.

## Revisión cruzada y correcciones

Dos agentes de investigación solo lectura, requeridos por la habilidad, revisaron el arnés C3 y el arnés C4/evidencia compartida; luego revisaron el diseño final.

- Confirmada brecha de forzado: reemplazar ID dentro de adaptador no evita router/breaker/fallback. Diseño exige puerto privado de llamada directa única, con default de producción conservado y evidencia de modelo realmente enviado/completado.
- Confirmada brecha de matriz externa: eval-di lee cantidad/persona, pero usa catálogo fijo. Se exige cargar casos/esperadas aprobados y hash completo, con suites DI/VA separadas y denominadores por modo/modelo.
- Confirmada brecha de reporte UI: existencia de archivos no acredita corrida. Diseño consume resultados por caso, mantiene inventario004 y config CI controlada aparte de target real sin stub.
- Confirmada brecha load: runner existente no acredita mezcla de conversaciones/anónimas ni conciliación/versiones. SPEC005 conserva corrección/medición y006 verifica importación íntegra, sin nuevo medidor duplicado.
- Corrección de aprobación: ApprovalReceipt externo liga matriz completa y evidencia humana estable; la matriz no contiene hash del recibo que depende de ella. Evita ciclo de hashes y conserva metadatos de aprobación en contenido congelado.
- Corrección de revisión: resultado bruto inmutable, recibo humano externo y EvaluatedResult derivado. Agregar revisión no altera hash observado ni provoca inferencia innecesaria.
- Nombres de hashes alineados: FreezeReceipt.matrixContentHash canónico y matrixRef.sha256 de bytes, ambos verificados.
- Entornos por caso/revisión: ExecutionEnvironment registra OS/browser/versiones, físico/emulado, viewport, lector y conexión real, además de la identidad general de release.

## Comprobaciones documentales

- Cobertura y umbrales C3: ≥30 ordinarios, ≥8/dirección, ≥3/GT-P, ≥4/otros tipos, ≥9 ataques3+3+3; con seis GT-P ≥39 yceil90 %=36 por corrida.
- Cobertura C4: ocho flujos/ambos entornos, ambas decisiones y FAQ tres direcciones; distribución candidata22→20 aprobados, sin equiparar22 criteriosUI con22 flujosPR.
- Casos críticos protegidos100 %, hallazgos con estados/rúbricas originales, Críticos Cerrada, reejecución completa y selección vigente sin promedio de modelos ni corridas antiguas favorables.
- Ataques en base aislada, exposición efectiva, retiro verificado normal/fallo/cancelación/reinicio; base oficial intacta.
- UI-02 e IN-03 mismo ChatBot validado, dos días/six oleadas/cantidades/conciliación y revisión manual/dispositivos reales.
- Informes H5/H4 separados, cuatro/seis elementos, ambas firmas posteriores y originales verificados; herramientas no autentican firmas por nombre ni firman automáticamente.
- Enlaces locales del diseño comprobados; sin marcadores de plantilla ni aclaraciones pendientes. Comandos nuevos y flags ampliados están declarados propuestos; no se ejecutan al planificar.
- Hooks YAML parseado: hooks vacío, sin before_plan ni after_plan registrados. Setup apunta006; su BRANCH lógico no creó rama, Git real develop.

Próximo paso: generar tareas dependientes del plan. No atribuir a esta revisión cumplimiento de matrices reales, modelo AWS, pruebas físicas, carga ni firmas contractuales.
