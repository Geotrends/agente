# US4 — resultados locales (T060)

Fecha 2026-10-10. Adapter **controlled**. Lector de pantalla real: **pendiente** (no se afirma).

| Suite | Resultado |
| --- | --- |
| `test/history.test.ts` (reducer: reinicio incrementa epoch y limpia decisión/categoría/ID/transcripción/pares, conserva contactos) | 11/11 |
| `test/new-conversation.test.ts` — diálogo literal, foco inicial en Cancelar, Escape, Tab contenido; cancelar conserva intento y la respuesta llega a la conversación actual; confirmar descarta la tardía; autorizado → ID nuevo y primera consulta sin historial; anónimo → sin ID; política nueva → versión vigente | 8/8 |
| `test/new-conversation.spec.ts` — seis recorridos con dos consultas previas (2 autorizados, 2 anónimos, 2 cancelaciones: botón y Escape) + teclado | 8/8 |
| `test/new-conversation-races.spec.ts` — respuesta con diálogo abierto, tardía tras confirmar, configuración en vuelo, ocultar≠reiniciar, axe del diálogo A/AA, storage/URL | 5/5 |

## Comprobaciones por recorrido

- Texto exacto: «¿Desea iniciar una conversación nueva? La conversación actual dejará de mostrarse.» con «Iniciar nueva» / «Cancelar».
- Orden tras confirmar: apertura → decisión → categoría; el campo permanece deshabilitado hasta completar.
- Primera consulta nueva: sin `historial`; con `conversationId` solo si se autorizó (y distinto del anterior: nueva llamada a `/api/conversations`, 2 en total por recorrido autorizado); anónimo: 0 llamadas.
- Cancelar (botón y Escape): sin cambios en conversación, autorización, categoría ni solicitud; el panel no se oculta; foco en «Nueva conversación».
- `VISIBILITY`/`CLOSE` solo ocultan; no reinician ni abren el diálogo.
- El código no solicita purga de la conversación anterior (los registros institucionales permanecen).

## Orden de eventos de reinicio

`epochRef += 1` → abortar intento, configuración y creación de conversación → borrar token en memoria → `reiniciar` en el reducer → nueva lectura de configuración (botones de decisión deshabilitados hasta que llegue). Una promesa antigua compara su epoch y se descarta.

## Pendiente

Lectores reales (VoiceOver/NVDA/TalkBack), zoom 200 % manual y navegadores distintos de Chromium (T079/T080).
