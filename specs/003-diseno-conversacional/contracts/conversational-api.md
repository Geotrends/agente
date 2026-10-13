# Conversational API Contracts

**Feature**: 003-diseno-conversacional
**Última conciliación**: 2026-10-10 (alineado con la implementación; fuente normativa de los campos: [`../002-diseno-modelo-ia/contracts/chat-api.md`](../002-diseno-modelo-ia/contracts/chat-api.md))

Interfaz entre el ChatBot (React, `frontend/smart/SmartAgentPanel.tsx`, estado en `frontend/shared/consent.ts`) y el backend C3 (Express). Prefijo `/api`, JSON UTF-8. Los canales de atención inmediata salen siempre del registro de contactos administrable; el frontend no contiene valores fijos.

## 1. Configuración inicial y canales de emergencia

**GET** `/api/chat/config` — sin LLM, presupuesto de 2 s, sin caché (`Cache-Control: no-store`).

```json
{
  "apertura": "Texto fijo de apertura de Geobot",
  "politica": { "version": "2026-10", "url": "https://…" },
  "opciones": [
    { "valor": "autorizo", "etiqueta": "Autorizo" },
    { "valor": "no_autorizo", "etiqueta": "No autorizo" }
  ],
  "contactos": {
    "revision": 3,
    "recepcion": { "pqrsd": "…", "whatsapp": "…", "email": "…" },
    "general": { "phone": "…", "email": "…", "url": "…" },
    "inmediatos": [
      { "id": "a", "name": "…", "description": "…", "type": "teléfono|correo|url", "value": "…", "position": 1 }
    ]
  }
}
```

- La opción «Emergencia o situación en curso» **no hace otra llamada**: muestra `contactos.inmediatos` ya cargados, sin autorización de datos y sin invocar al modelo (FR-006, FR-007).
- Si falla la configuración (503 `SERVICIO_NO_DISPONIBLE`) o `inmediatos` llega vacío, el frontend muestra un texto de respaldo sin valores de contacto y permite reintentar.

## 2. Decisión de datos

- **Autorizo**: `POST /api/conversations` (Bearer técnico obtenido en `POST /api/session`), cuerpo `{ "autorizacion": true, "policyVersion": "<politica.version>" }` → 201 `{ "modo": "conversación", "conversationId": "<UUID emitido por el backend>" }`.
- **No autorizo**: no se llama al backend; el modo es anónimo y no se obtiene `conversationId`.

## 3. Consulta

**POST** `/api/chat` (Bearer técnico)

```json
{
  "pregunta": "¿Cómo solicito el trámite?",
  "conversationId": "UUID del backend, solo con autorización",
  "categoria": "Ecosistemas",
  "historial": [{ "pregunta": "Consulta previa", "respuesta": "Respuesta previa exitosa" }]
}
```

Reglas:
- `pregunta` obligatoria.
- `conversationId` solo con «Autorizo»; ausente = consulta anónima.
- `historial` (pares pregunta/respuesta exitosos, máximo 10) solo con «Autorizo». En modo anónimo el cuerpo se limita a `pregunta` (y `categoria` si se eligió): sin `conversationId` ni `historial`.
- `categoria` es opcional y solo admite `Ecosistemas`, `Bienestar Animal` o `Gestión Ambiental`. «No estoy seguro» **no envía** el campo. Prioriza el orden de los fragmentos sin excluir los de otras direcciones.
- La categoría se pide después de la decisión de datos y antes de la primera consulta.

Respuesta 200:

```json
{
  "modo": "conversación | anónima",
  "conversationId": "solo en conversación",
  "responseId": "solo en conversación",
  "tipo": "respondida | sin información | fuera de alcance | aclaración",
  "respuesta": "Markdown",
  "fuentes": [{ "id": "…", "nombre": "…", "enlace": "https://…", "fecha": "2026-01-01" }]
}
```

## 4. Errores

`{ "error": { "codigo": "…", "mensaje": "…", "campo": "…" }, "canales": [ …canales vigentes… ] }`. Códigos: `VALIDACION` (400), `SERVICIO_NO_DISPONIBLE` (503), `ERROR_INTERNO` (500), `LIMITE_SOLICITUDES` (429, con `Retry-After`). El fallo no entra al historial y la consulta puede reintentarse.
