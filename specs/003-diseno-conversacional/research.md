# Phase 0: Research & Architecture Decisions

**Feature**: 003-diseno-conversacional
**Date**: 2026-10-08

## Decision 1: Conversational State Management

**Context**: The application must manage conversational state differently depending on the user's data treatment authorization ("Autorizo" vs "No autorizo"). If authorized, history is maintained and sent to the backend. If not authorized, the chat operates statelessly. Furthermore, per Constitution IV, the text of the conversation MUST live only in the volatile memory of the iframe, never in localStorage, cookies, or URL.

**Decision**: Use React Context and `useState` / `useReducer` at the top level of the chat widget component tree to maintain the ephemeral state of the conversation (messages, `autorizo` flag, selected `category`).

**Rationale**: 
- Strictly adheres to the privacy constraint (Constitution IV) by keeping data entirely in volatile memory. 
- React Context provides a clean way to pass the `autorizo` and `category` flags down to message input and submission handlers without prop drilling.

**Alternatives considered**:
- *Redux*: Too heavy for a single chat widget's ephemeral state.
- *Zustand*: Good alternative, but React Context is sufficient and requires no additional dependencies.
- *SessionStorage*: Explicitly prohibited by RF-C4-IN-01 / Constitution IV.

## Decision 2: Emergency Contacts Delivery

**Context**: When the user selects "Emergencia o situación en curso", the system must display the current immediate attention channels in under 2 seconds without invoking the LLM (SC-003, RF-C4-DC-04).

**Decision**: The backend (Express) will expose a dedicated, lightweight REST endpoint (e.g., `GET /api/contacts/emergency`) that retrieves the cached emergency contacts from PostgreSQL. The frontend will fetch this either on load or immediately upon clicking the emergency option.

**Rationale**:
- Ensures sub-2-second response times by bypassing the LLM processing pipeline.
- Adheres to the requirement of not hardcoding values in the frontend (Constitution II).

**Alternatives considered**:
- *Server-Side Rendering (SSR) injecting into window*: Next.js could inject it, but the chat is loaded via an iframe (per Bloque 4 UI specs), making a quick REST call from the client reliable and isolated.

## Decision 3: "Autorizo" / "No autorizo" Payload Handling

**Context**: The backend needs to know whether to persist the interaction and whether to expect a history array.

**Decision**: The frontend will include an `autorizo` boolean and a `category` string in every chat message payload sent to the backend API. If `autorizo` is false, the `history` array in the payload will be strictly empty, enforcing the stateless requirement at the client boundary before it even hits the backend.

**Rationale**:
- Defense in depth: The frontend doesn't send history, and the backend doesn't store it.
- Explicitly fulfills FR-003 and SC-002.

