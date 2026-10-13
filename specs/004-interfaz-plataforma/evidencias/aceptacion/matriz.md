# Matriz de aceptación SPEC004 — generada

Generada por `frontend/scripts/report-ui.mjs`. **No es un acta de aceptación**: «controlado» significa API simulada, navegador emulado o base de pruebas; la aceptación real exige los entornos de la columna final.

## Identidad de la corrida

```json
{
  "fecha": "2026-10-10T20:48:54.438Z",
  "commit": "3f56d8e91a78e8cf9f39c86472940f58eb5f09e8",
  "cambiosLocales": "186",
  "hashCambios": "cdd24915cecad827a20bc2184d44231e685a9794a913cc2db6eb1ba74a9683f2",
  "matrizHash": "3aae3e53025fd0872340b954c6edc8aa275924604e367410a9a91dedca0ab0fc",
  "launcher": {
    "bytes": 5083,
    "sha256": "f4915193084dbadb014b4c79f091054b9bef0b87a362b10ffa2fe6cf291e17c6"
  },
  "logo": "f02dbb6663f5a0d46bd7c92c04cb365013c4465d92964919b6d0e6fb394d1ee6",
  "cssOficial": "b92057e91267a58abb49a2b16fe68892847ed50667b7e72d457ab4714f488a8c (guia-estilo.md)",
  "adapter": "controlled"
}
```

| Caso | Requisito | Cantidades | Suites locales | Estado local | Pendiente en entorno real |
| --- | --- | --- | --- | --- | --- |
| U01 | RF-C4-UI-01 | {"entornos":5,"consultas":2,"ciclos":5} | `frontend/test/widget-launcher.spec.ts`<br>`frontend/test/widget-startup.spec.ts` | cubierto (controlado) | Chrome/Firefox/Edge escritorio, Chrome Android y Safari iOS sobre el portal (T078/T079) |
| U02 | RF-C4-UI-02 | {"anchos":5} | `frontend/test/widget-viewport.spec.ts` | cubierto (controlado) | Teclado virtual Android/iOS y orientación (T079) |
| U03 | RF-C4-UI-03 | {"respuestas":9} | `frontend/test/markdown.test.tsx`<br>`frontend/test/external-links.spec.ts` | cubierto (controlado) | Lector de pantalla (T080) |
| U04 | RF-C4-UI-04 | {"respuestas":10} | `frontend/test/external-links.spec.ts` | cubierto (controlado) | Escritorio/móvil con toque (T079) |
| U05 | RF-C4-UI-05 | {"recorridos":6} | `frontend/test/new-conversation.test.ts`<br>`frontend/test/new-conversation.spec.ts`<br>`frontend/test/new-conversation-races.spec.ts` | cubierto (controlado) | Lector real sobre el diálogo (T080) |
| U06 | RF-C4-UI-06 | {"autorizadas":10,"anonimas":3} | `frontend/test/feedback.test.tsx`<br>`frontend/test/feedback.spec.ts`<br>`backend/test/ui-integracion/feedback-api.test.ts` | cubierto (controlado) | Servicios reales y lector (T080/T081) |
| U07 | RF-C4-UI-07 | {"consultas":5,"indicadorMs":500} | `frontend/test/query-attempt.test.ts`<br>`frontend/test/query-failures.spec.ts` | cubierto (controlado) | Cronología con servicio real (T081) |
| U08 | RF-C4-UI-08 | {"fallas":6} | `frontend/test/query-failures.spec.ts`<br>`frontend/test/contact-recovery.test.ts` | cubierto (controlado) | Causas reales de red/plazo (T081) |
| N01 | RNF-C4-UI-01 | {"cargas":3,"bytesMax":10000} | `frontend/test/widget-launcher.spec.ts`<br>`frontend/scripts/build-widget.mjs` | cubierto (controlado) | HAR de la página real del portal (T079) |
| N02 | RNF-C4-UI-02 | {"estados":"lista de estados de acceptance.md"} | `frontend/test/all-states-a11y.spec.ts`<br>`frontend/test/reading-a11y.spec.ts`<br>`frontend/test/feedback-a11y.spec.ts` | cubierto (controlado) | Revisión manual firmada, lectores y zoom 200 % (T080) |
| N03 | RNF-C4-UI-03 | {"maliciosas":10,"consultas":3} | `frontend/test/markdown-security.test.tsx` | cubierto (controlado) | Cargas del C3 real (T081) |
| N04 | RNF-C4-UI-04 | {"elementos":10} | `frontend/test/brand.spec.ts` | cubierto (controlado) | Comparación con el portal con el widget instalado (T080) |
| I01 | RF-C4-IN-01 | {"recorridos":6} | `frontend/test/startup.test.tsx`<br>`frontend/test/storage.spec.ts`<br>`backend/test/ui-integracion/privacy.test.ts` | cubierto (controlado) | Backend real con Bedrock (T081) |
| I02 | RF-C4-IN-02 | {"recorridos":3,"consultas":12,"pares":10} | `frontend/test/history.test.ts`<br>`backend/test/ui-integracion/prerequisites.test.ts` | cubierto (controlado) | Doce consultas con modelo real (T081) |
| I03 | RF-C4-IN-03 | {"pruebas":4} | `frontend/test/query-attempt.test.ts`<br>`frontend/test/query-integration.spec.ts` | cubierto (controlado) | Tiempo real de navegador/servicio (T081) |
| I04 | RF-C4-IN-04 | {"pruebas":6} | `frontend/test/contact-recovery.test.ts`<br>`frontend/test/query-integration.spec.ts` | cubierto (controlado) | Errores reales del proxy (T081) |
| I05 | RF-C4-IN-05 | {"respuestas":6} | `frontend/test/feedback.test.tsx`<br>`frontend/test/feedback.spec.ts` | cubierto (controlado) | Registro real (T081) |
| I06 | RF-C4-IN-06 | {"pruebas":4,"esperaMaxMs":5000} | `frontend/test/contact-recovery.test.ts`<br>`frontend/test/query-integration.spec.ts` | cubierto (controlado) | Contactos reales editados en el panel (T081) |
| P01 | RNF-C4-IN-01 | {"recorridos":3} | `frontend/test/storage.spec.ts`<br>`frontend/test/startup.test.tsx` | cubierto (controlado) | Chrome y Firefox reales (T079) |
| P02 | RNF-C4-IN-02 | {"pruebas":6} | `frontend/test/widget-csp.spec.ts` | cubierto (controlado) | Cabeceras de nginx con el origen oficial y bloqueos en Android/iOS (T079) |
| B09 | RF-C3-IN-09 | {"envios":12,"validos":7,"invalidos":5} | `backend/test/ui-integracion/feedback-api.test.ts`<br>`backend/test/ui-integracion/feedback-database.test.ts` | cubierto (controlado) | Base real de despliegue (T081) |
| B10 | RF-C3-IN-10 | {"llamadas":3,"maxMs":2000} | `backend/test/ui-integracion/contact-config.test.ts` | cubierto (controlado) | Panel y base de despliegue (T081) |

Casos: 22/22. Con evidencia controlada: 22. Con evidencia real: 0.
