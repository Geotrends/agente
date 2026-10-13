# US3 · evidencia local (T051)

**Fecha**: 2026-10-08 · **adapter=double**, datos 100 % sintéticos.

| Criterio | Prueba | Resultado |
|---|---|---|
| DI-23 · 14 saneamientos (9 PII / 5 normas) | `test/di-pii.test.ts` | etiquetas exactas `[CÉDULA]`, `[TELÉFONO]`, `[CORREO]`, `[DIRECCIÓN]`, `[NOMBRE]`; 5 normas/códigos/fechas/cifras intactos |
| DI-23 · 8 equivalentes (4 con datos / 4 neutras) y 3 turnos | idem | aviso solo en las 4 con datos, sin reproducirlos y con la misma orientación |
| RNF-DI-01 · 15 salidas, 5 por dato, historial > 10 | `test/di-provider-privacy.test.ts` | ningún dato completo llega al proveedor; solo 10 pares; también se enmascaran fragmentos y respuestas previas |
| DI-22 · 8 provocaciones/neutras | idem | mismo prompt y misma orientación; la ofensa no dispara el aviso PII (**el tono lo juzga el revisor**) |
| IN-11 · 9 inyecciones (3 pregunta / 3 historial / 3 fragmento) | idem | el system prompt no cambia ni contiene la inyección; historial y fragmentos viajan como datos delimitados; la leyenda se conserva; un pedido de análisis ni llega al proveedor |
| IN-01/02/07 · 12 solicitudes (8 válidas / 4 inválidas) | `test/di-integracion/consent.test.ts` | UUID solo del backend; 15 pares → 10; inválidas (par malformado, UUID desconocido, UUID ajeno, historial sin autorización) sin LLM ni registro; campos `provider/model/autoRoute/prompt/message/history` rechazados |
| C4-DC-02 · 5 anónimas con 2 seguimientos | idem + `frontend/test/di-consent.test.ts` | sin historial hacia el modelo; solo 6 campos en BD; nada de texto/UUID/hash/token/IP; en pantalla solo la consulta actual |
| Destinos persistentes | `test/di-integracion/privacy.test.ts` | ninguna tabla `chat.*`/`admin.*`, ni el log de la aplicación, contiene el dato, la pregunta, `Authorization` ni el sujeto de la sesión |

## Límites conocidos

- La detección de PII es por **ancla léxica o de formato** (decisión heredada para no destruir normas): una cédula escrita a secas, sin la palabra que la nombra, **no** se enmascara. Los nombres de terceros se detectan solo tras palabras como «vecino», «señor», «se llama».
- Los módulos heredados `chatLog.ts` y `chatTraffic.ts` (CSV y cuotas por IP persistidas) **quedan sin uso** — la ruta nueva no los llama — pero sus archivos siguen en el repositorio; retirarlos requiere tu aprobación porque tienen cambios locales.
- `frontend/test/di-consent.test.ts` prueba la máquina de estados del consentimiento y `frontend/test/di-flows.test.mts` renderiza el panel con jsdom: «No autorizo» con 5 consultas (2 de seguimiento) sin `conversationId` ni historial y solo la consulta actual en pantalla; «Autorizo» con UUID del backend e historial ≤10 pares; recargar vuelve a pedir la decisión; nada de UUID ni preguntas en `sessionStorage`. El recorrido bypass/ruta directa en navegador real queda para T096.
