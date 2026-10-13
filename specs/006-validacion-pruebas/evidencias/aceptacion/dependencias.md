# Dependencias SPEC006

Fecha: 2026-10-10. Propietario es módulo/spec responsable, no persona asignada ficticia.

| Insumo | Propietario | Requisito / evidencia disponible | Brecha vigente |
|---|---|---|---|
| Base publicada, seis GT-P | SPEC001, src/kb, backend/config | RF-C3-VA-01/06; matriz documental/fichas y harness KB | Hash de corpus publicado y verificación documental humana pendientes; T082/T083/T092 no se cierran aquí |
| Modelos/calibración | SPEC002, src/bedrock, chat/modelRouting | RF-C3-VA-03; SDK Converse, eval-di, configuración y tests DI | Forcing no evita router; calibración/AWS/revisión real por verificar |
| Consentimiento/emergencia | SPEC003, frontend/chat, chat/orchestrator | RF-C4-PR-01/02; contrato consolidado003–005 | Navegadores/dispositivos reales pendientes (T035) |
| UI-02/N02/T080 | SPEC004, frontend/test, scripts/report-ui.mjs | RNF-C4-UI-02; suites controladas e inventario | Inventario no prueba resultado; portal, lectores físicos y revisión manual no acreditados |
| Rol exclusivo | SPEC005, bedrock/client, scripts/check-iam-policy.ts | RF-C3-VA-03; comprobador IAM | Rol en servidor y ausencia de credenciales alternas requieren evidencia autorizada |
| N303/T063/T064/T078 | SPEC005, scripts/lib/loadRunner y loadReconciliation | RNF-C3-IN-03; runner/conciliador existentes | Seis oleadas/dos días/150 registros reales y aislamiento de tráfico no acreditados |

Baseline contiene fotografía exacta de marcas actuales. Ningún prerequisito se declara conforme por existir su runner. No se modificaron tareas anteriores.
