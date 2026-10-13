# Data Model & Entities

**Feature**: 003-diseno-conversacional
**Date**: 2026-10-08

This document defines the frontend state entities and the expected data shapes for the conversational UI. Persistence is handled by the backend (Bloque 5/7), so these models primarily describe the volatile React state and API payloads.

## 1. ChatState (Volatile UI State)

The top-level state managed by the React application in memory.

| Field | Type | Description |
|-------|------|-------------|
| `isStarted` | `boolean` | True if the welcome message has been displayed. |
| `authorizationStatus` | `enum` | `'PENDING' \| 'AUTORIZADO' \| 'NO_AUTORIZADO'` - Tracks the user's data privacy consent. |
| `category` | `string \| null` | The selected thematic category. Null if "No estoy seguro" or not yet selected. |
| `messages` | `Message[]` | The array of messages currently visible in the chat UI. |
| `isEmergencyMode` | `boolean` | True if the user selected the emergency flow. |

**Constraints**:
- Must NEVER be serialized to `localStorage`, `sessionStorage`, `IndexedDB`, or cookies.
- Cleared completely upon page reload or chat widget close/re-open (depending on iframe lifecycle).

## 2. Message

Represents a single chat bubble in the UI.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Ephemeral UUID for React rendering keys. |
| `role` | `enum` | `'USER' \| 'BOT' \| 'SYSTEM'` (System is used for fixed warnings/prompts). |
| `content` | `string` | The text or Markdown content of the message. |
| `timestamp` | `number` | Unix timestamp of when the message was generated/sent. |
| `isEmergencyContact`| `boolean`| Flag to render the message with special emergency UI styling. |

## 3. EmergencyContact (API Response)

The expected shape of the data retrieved from the backend for emergency channels.

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Display name of the channel (e.g., "Línea de Emergencia"). |
| `value` | `string` | The phone number, email, or URL. |
| `type` | `enum` | `'PHONE' \| 'WHATSAPP' \| 'EMAIL' \| 'URL'` |
| `description` | `string` | Brief description of when to use this channel (max 120 chars). |

## State Transitions (UX Flow)

1. **Initial**: `isStarted = false`. UI shows nothing or a "Start Chat" trigger.
2. **Welcome**: Trigger clicked -> `isStarted = true`, `messages` receives fixed welcome System message. `authorizationStatus` becomes `PENDING`. UI shows "Autorizo" / "No autorizo" buttons.
3. **Emergency Branch**: If "Emergencia" is clicked during Welcome -> `isEmergencyMode = true`. Fetch and display `EmergencyContact`s. Offer "Continuar flujo normal".
4. **Consent**: 
   - User clicks "Autorizo" -> `authorizationStatus = 'AUTORIZADO'`. 
   - User clicks "No autorizo" -> `authorizationStatus = 'NO_AUTORIZADO'`. UI appends warning System message.
5. **Categorization**: UI appends System message asking for category. User selects -> `category` is set.
6. **Active Chat**: User types -> Message appended. Payload dispatched to API based on `authorizationStatus`.

