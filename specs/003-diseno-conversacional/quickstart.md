# Quickstart: Validation & Testing

**Feature**: 003-diseno-conversacional
**Última conciliación**: 2026-10-10 (alineado con la implementación)

Guía para validar los comportamientos conversacionales del Bloque 3 en el panel del chat (`frontend/smart/SmartAgentPanel.tsx`).

## Prerrequisitos

- Backend en marcha con el registro de contactos y la política de datos configurados (`GET /api/chat/config` responde 200).
- Frontend en marcha (`npm run dev` en `frontend/`) y panel abierto desde el Observatorio.
- Pruebas automáticas: `npm test` en `backend/` y en `frontend/` (jsdom; no sustituyen este recorrido en navegador real).

## Escenario 1: Apertura y bloqueo por consentimiento

1. Abrir el chat.
2. **Verificar**: lo primero visible es la apertura de Geobot: asistente automatizado, alcance de las tres direcciones, naturaleza preliminar y que no radica trámites ni decide (FR-001).
3. **Verificar**: el campo de consulta está deshabilitado y debajo aparecen «Autorizo» / «No autorizo» con el enlace a la política (FR-002).
4. Intentar escribir o enviar con el teclado: no debe ser posible.

## Escenario 2: Emergencia

1. Recargar el chat para reiniciar el flujo.
2. **Acción**: pulsar «Emergencia o situación en curso».
3. **Verificar**: aparecen de inmediato (≤ 2 s) los canales de atención inmediata del registro, sin pedir autorización; en la pestaña de red solo existe `GET /api/chat/config` (FR-006, FR-007).
4. **Acción**: pulsar «Continuar con la orientación».
5. **Verificar**: se oculta el bloque y se retoma la decisión «Autorizo» / «No autorizo».
6. Cambiar un canal inmediato en el panel de administración y recargar: el chat muestra el valor nuevo sin redespliegue.

## Escenario 3: Modo anónimo («No autorizo»)

1. Recargar el chat y pulsar «No autorizo».
2. **Verificar**: aparece el aviso fijo de que no se conserva la conversación y cada pregunta debe formularse completa (FR-003).
3. **Acción**: elegir una categoría y enviar una pregunta; repetir con 2 preguntas de seguimiento.
4. **Inspeccionar red**: el cuerpo de `POST /api/chat` contiene solo `pregunta` (y `categoria` si se eligió); no hay `conversationId` ni `historial`, y no existe `POST /api/conversations`.

## Escenario 4: Categorización

1. Recargar el chat y pulsar «Autorizo».
2. **Verificar**: el chat pide la dirección (Ecosistemas, Bienestar Animal, Gestión Ambiental, No estoy seguro) y el campo sigue deshabilitado hasta elegir (FR-004).
3. **Acción**: elegir «Bienestar Animal» y enviar una pregunta.
4. **Inspeccionar red**: `POST /api/chat` incluye `categoria: "Bienestar Animal"`, `conversationId` y, desde la segunda pregunta, `historial` (FR-005).
5. Repetir con «No estoy seguro»: el cuerpo no incluye `categoria`.
6. Hacer una pregunta cuyo documento pertenezca a otra dirección: igualmente se recupera.

## Escenario 5: Accesibilidad básica

1. Recorrer todo el flujo solo con teclado: opciones, categorías, emergencia y envío.
2. **Verificar**: foco visible, grupo de categoría anunciado con su leyenda y el botón elegido con `aria-pressed`, región de emergencia anunciada, respuestas anunciadas por la región viva.
3. Repetir en ancho de 390 px (móvil).
