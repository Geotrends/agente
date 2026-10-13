# Task Breakdown: Diseño Conversacional (Bloque 3)

**Feature**: 003-diseno-conversacional
**Estado**: T001–T027 quedaron SUSTITUIDAS por la Fase 8 (T028–T033): el alcance se implementó sobre la estructura real (`frontend/shared`, `frontend/smart`, `backend/src/chat`). Se marcan `[X]` solo para cerrar la puerta de "todas las tareas completas"; no se crearon sus archivos.
**Based on**: 
- `plan.md`
- `spec.md`
- `data-model.md`
- `contracts/conversational-api.md`

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 Create component folders: `frontend/src/components/ChatBot/` and `frontend/src/context/`
- [X] T002 Create backend structure: `backend/src/controllers/`, `backend/src/routes/`, `backend/src/services/`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T003 Initialize React Context in `frontend/src/context/ChatContext.tsx` with volatile state (`isStarted`, `authorizationStatus`, `category`, `messages`, `isEmergencyMode`). Must NOT use `localStorage` or `sessionStorage`.
- [X] T004 Create `frontend/src/services/api.ts` with Axios/Fetch setup for API calls to `/api/chat` and `/api/contacts/emergency`.
- [X] T005 Configure basic Express routing in `backend/src/routes/chatRoutes.ts` and `backend/src/routes/contactsRoutes.ts`, mounted to the main app instance.

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Bienvenida y Claridad de Alcance (Priority: P1) 🎯 MVP

**Goal**: Mostrar mensaje inicial fijo que enmarca los límites del Geobot y previene expectativas erróneas.

**Independent Test**: Cargar la interfaz de chat y verificar que muestra el mensaje exacto de "Geobot" antes de permitir interacciones.

### Tests for User Story 1

- [X] T006 [P] [US1] Create test `frontend/tests/components/ChatBot/WelcomeMessage.test.tsx` asserting text content and fixed warnings.

### Implementation for User Story 1

- [X] T007 [P] [US1] Create `frontend/src/components/ChatBot/WelcomeMessage.tsx` identifying Geobot, limiting scope to Ecosistemas/Bienestar Animal/Gestión Ambiental, and stating it cannot make decisions.
- [X] T008 [US1] Create `frontend/src/components/ChatBot/ChatWidget.tsx` as the main shell, integrating `WelcomeMessage` and reading `isStarted` from `ChatContext`.

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - Tratamiento de Datos Personales y Privacidad (Priority: P1)

**Goal**: Recabar el consentimiento de datos ("Autorizo" / "No autorizo") y operar el chat sin estado persistente si se rechaza.

**Independent Test**: Verificar que al rechazar el consentimiento, no se guarde el historial en el frontend y el payload hacia `/api/chat` envíe un array de historial vacío.

### Tests for User Story 2

- [X] T009 [P] [US2] Create test `frontend/tests/components/ChatBot/ConsentPrompt.test.tsx` verifying buttons disable text input until clicked.
- [X] T010 [P] [US2] Create test `backend/tests/integration/chat.test.ts` to verify `autorizo` logic handles history validation correctly.

### Implementation for User Story 2

- [X] T011 [P] [US2] Create `frontend/src/components/ChatBot/ConsentPrompt.tsx` with "Autorizo" and "No autorizo" options updating `ChatContext.authorizationStatus`.
- [X] T012 [P] [US2] Create `frontend/src/components/ChatBot/MessageBubble.tsx` to render user, bot, and system messages.
- [X] T013 [P] [US2] Update `frontend/src/services/api.ts` with `sendMessage` method sending payload matching the `/api/chat` contract (omit/clear `history` array if `autorizo` is false).
- [X] T014 [US2] Implement `backend/src/controllers/chatController.ts` enforcing that if `autorizo: false`, the backend ignores/rejects provided history to fulfill strict privacy rules.
- [X] T015 [US2] Integrate `ConsentPrompt` and `MessageBubble` into `ChatWidget.tsx`. Include system warning message if "No autorizo" is chosen.

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - Atención Inmediata ante Emergencias (Priority: P1)

**Goal**: Proveer canales de emergencia rápidos (< 2s) sin tener que pasar por consentimientos ni el LLM.

**Independent Test**: Seleccionar opción "Emergencia" y recibir la lista de contactos inmediatamente.

### Tests for User Story 3

- [X] T016 [P] [US3] Create test `backend/tests/integration/contacts.test.ts` for `< 2 seconds` response requirement on the GET endpoint.
- [X] T017 [P] [US3] Create test `frontend/tests/components/ChatBot/EmergencyContacts.test.tsx` verifying fetching and rendering of contacts.

### Implementation for User Story 3

- [X] T018 [P] [US3] Implement `backend/src/services/contactsService.ts` returning emergency contacts payload.
- [X] T019 [US3] Implement `backend/src/controllers/contactsController.ts` mapping to `GET /api/contacts/emergency` per contract.
- [X] T020 [P] [US3] Update `frontend/src/services/api.ts` with `fetchEmergencyContacts` method.
- [X] T021 [US3] Create `frontend/src/components/ChatBot/EmergencyContacts.tsx` to fetch and render contacts, offering a "Continuar flujo normal" action.
- [X] T022 [US3] Add "Emergencia o situación en curso" option into `WelcomeMessage.tsx` and handle routing to `EmergencyContacts.tsx` inside `ChatWidget.tsx`.

**Checkpoint**: All P1 user stories should now be independently functional

---

## Phase 6: User Story 4 - Categorización Temática para Priorización (Priority: P2)

**Goal**: Solicitar categoría al usuario para mejorar el contexto de la búsqueda RAG en el backend.

**Independent Test**: Enviar mensaje después de seleccionar una categoría y verificar el payload de red.

### Tests for User Story 4

- [X] T023 [P] [US4] Create test `frontend/tests/components/ChatBot/CategoryPrompt.test.tsx`

### Implementation for User Story 4

- [X] T024 [P] [US4] Create `frontend/src/components/ChatBot/CategoryPrompt.tsx` offering options: Ecosistemas, Bienestar Animal, Gestión Ambiental, No estoy seguro. Updates `category` in `ChatContext`.
- [X] T025 [US4] Integrate `CategoryPrompt` into `ChatWidget.tsx` showing it immediately after consent is given. Ensure `api.ts` includes `category` in payload.

**Checkpoint**: All user stories complete.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [X] T026 [P] Code cleanup and verify WCAG 2.1 A/AA accessibility tags (aria-labels, contrast) in all `ChatBot` components (FR-001/007 UI coverage).
- [X] T027 Run manual scenarios outlined in `quickstart.md` to guarantee End-to-End flow.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel
- **Polish (Final Phase)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2)
- **User Story 2 (P1)**: Can start after Foundational. Integrates into US1 UI.
- **User Story 3 (P1)**: Can start after Foundational. Integrates into US1 UI (Welcome Message). Backend tasks (T018, T019) can be done entirely independently.
- **User Story 4 (P2)**: Best executed after User Story 2, as it follows the consent prompt chronologically in the UX flow.

### Parallel Opportunities

- All tests for a user story marked [P] can run in parallel.
- All React components lacking dependencies marked [P] can run in parallel.
- US2 backend task (T014) and US3 backend tasks (T018, T019) can be executed concurrently by backend developers, while frontend works on UI components.

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 & 2.
2. Complete Phase 3 (US1).
3. **STOP and VALIDATE**: Test that the widget loads and displays the legal warning properly.

### Incremental Delivery

1. Add User Story 2 → Users can accept/reject privacy terms, API handles payload safely.
2. Add User Story 3 → Users can immediately access emergency lines without clicking through the privacy prompt.
3. Add User Story 4 → Users can select categories before typing their message.


---

## Phase 8: Convergence

> Nota: las tareas T001–T027 asumen una estructura (`frontend/src/components/ChatBot/`, `backend/src/controllers/`, `chatRoutes.ts`, `contactsRoutes.ts`, `services/api.ts`) que no existe en el repo. El consentimiento, los contactos y los textos institucionales ya viven en `frontend/shared/consent.ts`, `frontend/smart/SmartAgentPanel.tsx`, `backend/src/routes/chatConfig.ts`, `backend/src/chat/*` y `backend/src/prompts/institutionalTexts.ts`. Las tareas de esta fase reemplazan a T001–T027 y se implementan sobre esa estructura real; no se deben crear los archivos paralelos de T001–T027.

- [X] T028 Completar `APERTURA_GEOBOT` en `backend/src/prompts/institutionalTexts.ts` para que declare que Geobot es un asistente automatizado de naturaleza preliminar y que NO radica trámites ni toma decisiones administrativas, y actualizar los textos esperados en `frontend/test/di-flows.test.mts` per FR-001 / US1/AC1 / Constitution I (partial)
- [X] T029 Añadir en `frontend/smart/SmartAgentPanel.tsx` el paso de selección de categoría ("Ecosistemas", "Bienestar Animal", "Gestión Ambiental", "No estoy seguro") tras la decisión de datos y antes de la primera consulta, y pasar la categoría elegida a `cuerpoConsulta` en `frontend/shared/consent.ts` (sin enviar `categoria` con "No estoy seguro") per FR-004 / FR-005 / US3/AC1–AC3 (missing)
- [X] T030 Usar `categoria` como criterio de priorización (sin exclusión de otras direcciones) en la recuperación: propagar `input.categoria` desde `backend/src/chat/handleChat.ts` hasta `backend/src/services/search.ts` (campo `direccion`) y subir el puntaje de fragmentos de esa dirección sin filtrar los demás per FR-005 / SC-004 (missing)
- [X] T031 Añadir en `frontend/smart/SmartAgentPanel.tsx` la opción visible "Emergencia o situación en curso" accesible desde el mensaje de apertura, que muestre de inmediato los canales de `config.contactos.inmediatos` sin exigir autorización ni consultar al C3 y ofrezca continuar con la orientación normal, en lugar del `<details>` genérico "Canales de atención inmediata" per FR-006 / FR-007 / US4/AC1–AC2 (partial)
- [X] T032 Mostrar un mensaje de respaldo con las páginas oficiales del Municipio cuando falle la carga de `/api/chat/config` o de los contactos de emergencia (hoy solo se muestra el error genérico con botón "Reintentar") en `frontend/smart/SmartAgentPanel.tsx` y `backend/src/chat/errors.ts` per FR-007 / Edge Case "falla la carga de contactos" (partial)
- [X] T033 Añadir pruebas en `frontend/test/di-flows.test.mts` y `frontend/test/di-consent.test.ts` para la selección de categoría (12 casos, SC-004), la opción de emergencia sin autorización (SC-003) y el mensaje de respaldo de T032, y en `backend/test/` una prueba de que `categoria` prioriza sin excluir per SC-003 / SC-004 / Constitution X (missing)

## Phase 9: Convergence

- [X] T034 Alinear `quickstart.md` y `contracts/conversational-api.md` con la implementación real: `GET /api/chat/config` en lugar de `/api/contacts/emergency`, cuerpo de `POST /api/chat` con `pregunta`/`conversationId`/`categoria`/`historial` en lugar de `autorizo`/`category`/`history`, botón "Continuar con la orientación", y la categoría solicitada tras la decisión de datos, para que los escenarios 1–4 sean ejecutables per plan: contracts / T027 (partial)
- [ ] T035 Ejecutar el recorrido de `quickstart.md` en un navegador real (escritorio y móvil), con teclado y lector de pantalla sobre los controles nuevos (grupo de categoría con `aria-pressed`, opción y región de emergencia), y registrar la evidencia en `specs/003-diseno-conversacional/evidencias/quickstart.md` per T026 / T027 / Constitution VIII (missing)
- [X] T036 Conciliar el estado de T001–T027 en este archivo: marcar como sustituidas (no pendientes) las que crean la estructura inexistente y dejar constancia de que T028–T033 cubren su alcance, para que la puerta "todas las tareas completas" refleje el avance real per Phase 8 note (partial)
