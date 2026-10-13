# Diagnóstico previo de SPEC004 — Interfaz e integración

Fecha: 2026-10-08. Rama: `develop`. Evaluación por lectura de documentación y código del árbol de trabajo, incluidos cambios locales. No se ejecutó aceptación de navegador, servicios reales ni pruebas de rendimiento. «Parcial» significa que hay piezas reutilizables, no que el requisito completo está aprobado.

## Fuentes revisadas

- PDF adjunto: §4.4 completo, criterios de §4.5 C4, servicios de identificación/registro/contactos/valoración, referencias de validación y tabla de fallos del Bloque 4. Extracto original y huella del PDF en [evidencias/requisitos-pdf.txt](evidencias/requisitos-pdf.txt).
- Constitución 1.0.0 y plantillas resueltas mediante `.specify/scripts/bash/resolve-template.sh`.
- SPEC001: [spec](../001-base-conocimiento-bloque1/spec.md), [plan](../001-base-conocimiento-bloque1/plan.md), [tareas](../001-base-conocimiento-bloque1/tasks.md), [resultado del quickstart](../001-base-conocimiento-bloque1/evidencias/quickstart/RESULTADO.md).
- SPEC002: [spec](../002-diseno-modelo-ia/spec.md), [plan](../002-diseno-modelo-ia/plan.md), [tareas](../002-diseno-modelo-ia/tasks.md) y [contrato ciudadano](../002-diseno-modelo-ia/contracts/chat-api.md).
- SPEC003: [spec](../003-diseno-conversacional/spec.md), [plan](../003-diseno-conversacional/plan.md), [tareas](../003-diseno-conversacional/tasks.md) y [contrato conversacional](../003-diseno-conversacional/contracts/conversational-api.md).
- Interfaz: `frontend/app/page.tsx`, `app/globals.css`, `smart/SmartAgentPanel.tsx`, `shared/ChatMarkdown.tsx`, `MessageContent.tsx`, `session.ts`, `chatErrors.ts`, `agentConfig.ts`, `nginx.conf`.
- Backend: `backend/src/index.ts`, `routes/chat.ts`, `routes/chatConfig.ts`, `chat/contracts.ts`, `admin/contacts.ts`, y estructura de `src/chat/`, `src/kb/`, migraciones y pruebas existentes.

## Estado de los SPEC previos

| SPEC | Tareas marcadas | Evidencia actual y límite | Consecuencia para 004 |
| --- | --- | --- | --- |
| 001 Base de conocimiento | 89/91 | KB/CLI/PostgreSQL/Qdrant implementados. T082 (validación completa) y T083 (tres ingestas producción) pendientes. Resultado quickstart registra 584 publicados, pruebas/sondas y limitaciones: sin dos ciclos reales, huella/revisión visual pendientes; fallo de proveedores no atribuible al índice. | Reutilizar corpus publicado, metadatos y continuidad de reindexación; no reconstruir KB ni declarar sus pendientes resueltos. Respuestas/citas reales dependen de esta base. |
| 002 Modelo IA | 5/100 | T001–T005 marcadas. Hay contratos, pools, contactos, autenticación, errores/perímetro y configuración parciales en código, aunque sus tareas no estén cerradas. `routes/chat.ts` todavía procesa `message/provider/model/autoRoute/history` y proveedores heredados; no se encontró adaptador Bedrock completo en `src/bedrock/`. | Archivos nuevos no prueban migración terminada. Esperar contrato español y ciclo autorizado real antes de aceptación integrada. Coordinar edición de panel/renderer/sesión para evitar duplicación. |
| 003 Conversacional | 0/27 | Plan/tareas apuntan a `frontend/src/components/ChatBot`/contexto y controladores nuevos, ausentes en inventario. Panel actual carece de consentimiento/categorías/emergencia del diseño; bienvenida parcial no coincide con alcance completo aprobado. | Integrar un único flujo inicial y corregir contrato del diseño antes de ejecutar tareas; no crear otro widget con otra sesión. |

Los diagnósticos históricos describen estados anteriores. Los números anteriores se obtuvieron de las marcas actuales de tareas; la conclusión sobre funcionalidad se basa también en código. No se modificaron esas marcas.

## Cobertura actual de los 12 requisitos UI

Ninguno cuenta con evidencia suficiente para declarar cumplimiento integral. Inventario: **7 parciales, 4 ausentes y 1 sin acreditación institucional**.

| Requisito | Estado | Evidencia / brecha concreta |
| --- | --- | --- |
| RF-C4-UI-01 | Ausente | `app/page.tsx` presenta chat dentro de página autónoma; sin script de apertura, botón flotante ni ciclo iframe integrado al Observatorio en fuentes revisadas. No se acredita instalación externa. |
| RF-C4-UI-02 | Parcial | Hay estilos adaptables, pero no contenedor iframe con reglas 768/400/min(640,85 %) ni control de cierre que cumpla pruebas móviles. |
| RF-C4-UI-03 | Parcial | `ChatMarkdown` produce listas/tablas y contenedor; encabezados no incluyen `scope="col"`. Falta evidencia de nueve respuestas y lector móvil/escritorio. |
| RF-C4-UI-04 | Parcial | Renderer usa nueva pestaña, `noopener noreferrer` y texto oculto; no indicador visual externo uniforme. Citas separadas en panel usan solo `rel="noreferrer"`; faltan aviso/política y prueba de todos los enlaces. |
| RF-C4-UI-05 | Ausente | No control «Nueva conversación», diálogo literal ni reinicio de autorización/categoría/ID/historial. |
| RF-C4-UI-06 | Ausente | Sin controles, motivos, servicio de valoración ni asociación a ID de respuesta/registro confirmado. |
| RF-C4-UI-07 | Parcial | `loading`, puntos animados y región status existen, pero texto no es literal, el campo no está deshabilitado y se consulta estado técnico de indexación. Falta verificar ≤500 ms/sin foco/envíos. |
| RF-C4-UI-08 | Parcial | Maneja algunos fallos, pero no mensaje contractual con tres canales precargados ni dos reintentos; `agentConfig` puede mostrar host del backend y `chatErrors` estado HTTP. |
| RNF-C4-UI-01 | Ausente | Aplicación completa carga al entrar a su página; no script aislado ≤10 KB con carga diferida del iframe y evidencia de red del Observatorio. |
| RNF-C4-UI-02 | Parcial | Hay etiquetas, región viva y foco, pero sin cobertura automática de todos los estados ni manual teclado/lectores/zoom/contraste del flujo completo. |
| RNF-C4-UI-03 | Parcial | Consultas como texto y escape React reutilizables. Renderer admite http, h1/h2/h5/h6, code/hr y contenedores más allá de lista de contenido del PDF; la ausencia de ejecución por sí sola no cumple allowlist exacta. |
| RNF-C4-UI-04 | Sin acreditación | Geobot/avatar/estilos existen; no guía contrastada contra hoja oficial, ni prueba de que avatar corresponda al logo institucional. No inventar identidad. |

## Diferencias de contrato que deben reconciliarse

| Tema | SPEC003 diseñado | SPEC002 objetivo / código vigente | Decisión requerida al planificar 004 |
| --- | --- | --- | --- |
| Consulta | `message`, `autorizo`, `category`, `history` de mensajes USER/BOT | SPEC002: `pregunta`, `conversationId`, `categoria`, `historial` de pares completos; código activo aún `message/provider/autoRoute/history`. | Alinear 003 y frontend con contrato español objetivo y migración real; una sola interfaz pública. No equiparar campos por coincidencia parcial. |
| Consentimiento/ID | Booleano `autorizo`; no ciclo explícito de emisión de ID | SPEC002: `POST /api/conversations` tras autorizar/política, ID backend ligado a sesión técnica; ruta aún no disponible en inventario. | Distinguir token técnico de autorización y conversationId. No generar IDs cliente ni mantenerlos en sessionStorage. |
| Respuesta | `response`, `sources(title,url,date)` | SPEC002: `respuesta`, `fuentes(nombre,enlace,fecha)`, tipo/modo/ID opcional; panel actual espera `answer/meta`. | Preservar fechas/citas y omitir valoración si no hay responseId. No exponer proveedores/modelos/meta técnicos. |
| Contactos | `GET /api/contacts/emergency` propuesto, lista de inmediatos | `GET /api/chat/config` implementado y montado; devuelve apertura/política/bloque completo, requiere configuración/BD. No prueba de respuesta real de configuración en esta revisión. | Reutilizar bloque completo sin endpoint paralelo de emergencia; comprobar ≤2 s servicio, ≤5 s cliente y recuperación IN-06. |
| Valoración | No definida en SPEC003 | SPEC002 deja valoración/analítica fuera; sin ruta de valoración actual. | Dependencia nueva directa de UI-06: especificar contrato, persistencia/unicidad/validación conforme RF-C3-IN-09 y pruebas reales. No dejarla sin propietario por estar fuera de 002. |
| Historial | Últimos diez intercambios descritos pero payload de mensajes | Código actual envía mensajes visibles, incluidos potenciales errores; no consentimiento. | Solo pares completos exitosos, diez recientes; anónimo sin contexto; fallidas/tardías excluidas. Transcripción volátil visible distinta de historial enviado. |
| Sesión | Contexto volátil propuesto | `shared/session.ts` persiste token técnico en sessionStorage y hace reintento de transporte tras 401. | Unificar sesión en memoria conforme plan 002; token no es ID de conversación. Revisar renovación para impedir reintentos ocultos de generación. |
| Espera/errores | Delegados al Bloque 4 | Código/proxy mantiene presupuestos heredados y posibles errores técnicos visibles. | C3 ≤40 s, interfaz 45 s, cancelación/tardías; mensajes fijos y dos reintentos manuales. |
| Incrustación | Iframe mencionado | Nginx no configura `frame-ancestors` ciudadano específico; backend usa helmet, que no acredita política de la página iframe servida por nginx. | Verificar política en respuesta real del iframe y únicamente origen oficial, incluyendo móviles. |

## Integración y puertas de cierre

1. **Conservar SPEC001**: usar únicamente KB publicada, citas oficiales y continuidad; registrar pendientes previos sin trasladar ingesta al navegador.
2. **Alinear SPEC002/SPEC003**: revisar contratos antes de modificar panel compartido. Backend autorizado, configuración y respuestas primero; un único flujo de consentimiento/categoría/emergencia después. T026/T027/T038/T048 de 002 y tareas 003 se superponen con superficies de 004 y deben coordinarse, sin construir duplicados.
3. **Completar interfaz**: envoltura/lazy load, geometría, renderer, enlaces, espera/fallo, reinicio y valoración. Interfaz no selecciona proveedor ni cambia alcance documental.
4. **Completar servicios directos faltantes**: emisión de IDs, registro confirmado/valoración, contactos y errores seguros. Asignar trabajo en plan/tareas de 004 o vincular tarea previa con evidencia; una dependencia sin propietario no permite cierre.
5. **Verificar 12/12 UI y 8/8 C4-IN**: automatización y revisión manual sobre versión identificada, cinco entornos, estados completos, portal/mapa e integración real. Cumplir también verificación del servicio de valoración (12 envíos) y contactos (3 llamadas). Dobles validan casos límite, no aceptación de persistencia/portal real.

No se requiere implementar todo Bloque 7 para UI, pero sí los servicios y controles de seguridad/privacidad que la interfaz usa. Falta de entorno del Observatorio, estilos oficiales o servicios funcionales se registra como pendiente de aceptación, nunca como cumplimiento por simulación.
