# Feature Specification: Diseño Conversacional (Bloque 3)

**Feature Branch**: `003-diseno-conversacional`

**Created**: 2026-10-08

**Status**: Draft

**Input**: User description: "necesito que crees el spec para el bloque 3, diseño conversacional, debes de cubrir el 100% de los requisitos funcionales y no funcionales presentes en la documentacion adjunta. Ademas debes de revisar el spec001 y spec002 ya creados para que tengas una idea clara de que es lo que esta planificado para ser realizado en el codigo asi puedes adaptar este spec para construir sobre los specs anteriores."

**Requisitos cubiertos**: RF-C4-DC-01, RF-C4-DC-02, RF-C4-DC-03, RF-C4-DC-04 y mitigación de fallos de la Tabla 7. (Hito H1-C4).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Bienvenida y Claridad de Alcance (Priority: P1)

El ciudadano al iniciar una conversación necesita saber con quién está interactuando, cuáles son sus límites y qué no puede hacer el asistente, para ajustar sus expectativas y no atribuirle capacidad de decisión o pensar que habla con un humano.

**Why this priority**: Evita frustración en el usuario y mitiga el fallo Crítico donde el ciudadano atribuye al ChatBot capacidad de radicar trámites, decidir, o cree hablar con un funcionario.

**Independent Test**: Iniciar 5 conversaciones nuevas (3 en escritorio, 2 en móvil) y verificar que en el 100% aparezca el mensaje inicial fijo exacto antes de permitir cualquier consulta.

**Acceptance Scenarios**:

1. **Given** que el usuario abre el ChatBot por primera vez, **When** carga la interfaz conversacional, **Then** se muestra un mensaje de apertura fijo identificando a "Geobot" (asistente automatizado), indicando su alcance limitado a tres direcciones (Ecosistemas, Bienestar Animal, Gestión Ambiental), su naturaleza preliminar y que NO radica trámites ni toma decisiones administrativas.
2. **Given** que el mensaje de apertura se está mostrando, **When** el usuario intenta enviar una consulta, **Then** el sistema exige primero interactuar con el flujo inicial (aceptar/rechazar tratamiento de datos).

---

### User Story 2 - Tratamiento de Datos Personales y Privacidad (Priority: P1)

El ciudadano debe poder decidir si autoriza el tratamiento de sus datos personales. Si no lo hace, el sistema debe seguir operando, pero garantizando el anonimato (sin historial ni almacenamiento de la conversación).

**Why this priority**: Es un requisito legal y de privacidad estricto. Mitiga el fallo donde datos personales son almacenados o transmitidos a un proveedor externo sin autorización o retransmitidos en turnos sucesivos.

**Independent Test**: Realizar recorridos completos seleccionando "Autorizo" y "No autorizo", inspeccionando el payload enviado al C3 y verificando en base de datos la persistencia o anonimato de la conversación.

**Acceptance Scenarios**:

1. **Given** que el ChatBot mostró el mensaje de apertura, **When** presenta el aviso de tratamiento de datos, **Then** deshabilita el campo de consulta hasta que el usuario elija explícitamente "Autorizo" o "No autorizo".
2. **Given** que el usuario selecciona "Autorizo", **When** realiza una consulta, **Then** el ChatBot envía la consulta con historial de turnos y permite persistencia en la conversación.
3. **Given** que el usuario selecciona "No autorizo", **When** realiza una consulta, **Then** el ChatBot muestra un mensaje fijo indicando que la conversación no se conserva y cada pregunta debe formularse completa. El ChatBot opera en modo sin registro, envía cada consulta al C3 de forma autónoma sin turnos previos, sin caracteres arrastrados de preguntas anteriores y no guarda fila de conversación al cerrar.

---

### User Story 3 - Categorización Temática para Priorización (Priority: P2)

Para mejorar la relevancia de las respuestas, el sistema debe permitir al usuario enmarcar su consulta dentro de una de las direcciones de la Secretaría de Medio Ambiente, sin que esto restrinja o bloquee la búsqueda si hay documentos de otras áreas que apliquen.

**Why this priority**: Mejora la experiencia y precisión de recuperación. Mitiga el fallo donde una categorización errónea por desconocimiento del ciudadano deja sin recuperar el documento correcto.

**Independent Test**: Ejecutar consultas seleccionando cada una de las 4 opciones de categoría y verificar en la red que la categoría viaje al C3 como parámetro, comprobando que documentos de otra dirección aún puedan recuperarse.

**Acceptance Scenarios**:

1. **Given** que el usuario resolvió el aviso de privacidad, **When** el sistema le pide seleccionar una categoría, **Then** ofrece: "Ecosistemas", "Bienestar Animal", "Gestión Ambiental" y "No estoy seguro".
2. **Given** que el usuario elige una dirección específica, **When** realiza la consulta, **Then** el ChatBot envía la categoría al C3 como criterio de priorización sin excluir documentos de las otras direcciones.
3. **Given** que el usuario elige "No estoy seguro", **When** realiza la consulta, **Then** el ChatBot envía la consulta al C3 sin criterio de priorización.

---

### User Story 4 - Atención Inmediata ante Emergencias (Priority: P1)

El ciudadano que tiene una situación en curso o emergencia no debe quedar atrapado en flujos informativos ni aceptar términos legales antes de recibir canales de atención humana urgente.

**Why this priority**: Es vital para el servicio público. Mitiga el fallo donde el ciudadano con una situación de riesgo queda retenido en el flujo del bot en lugar de recibir un canal de atención humana.

**Independent Test**: Seleccionar la opción de emergencia al abrir el bot y verificar que los contactos aparezcan en <2 segundos sin invocar al modelo LLM.

**Acceptance Scenarios**:

1. **Given** que el usuario acaba de abrir el ChatBot, **When** selecciona la opción "Emergencia o situación en curso" accesible desde el mensaje de apertura, **Then** el sistema muestra inmediatamente los canales de atención vigentes sin exigir autorización de datos ni enviar consulta al C3.
2. **Given** que el usuario recibe los canales de emergencia, **When** el sistema le ofrece continuar, **Then** puede retomar el flujo normal de orientación formal (aceptando términos y condiciones).
3. **Given** que los números de emergencia cambian en el panel de administración, **When** el usuario entra y presiona "Emergencia", **Then** el sistema muestra los datos actualizados inmediatamente sin necesidad de redespliegue de la aplicación.

### Edge Cases

- **Usuario recarga la página durante el flujo de inicio**: El flujo debe reiniciarse desde el mensaje de apertura.
- **Usuario intenta forzar el envío de texto antes de completar el flujo (ej. manipulando el DOM)**: El frontend y el backend deben rechazar la petición o bloquearla.
- **Falla la carga de contactos de emergencia desde el backend (RF-C3-IN-10)**: Debe mostrarse un mensaje de fallback amigable guiando al ciudadano a las páginas oficiales del municipio (mitigando que quede sin opciones).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El ChatBot DEBE mostrar, al iniciar cada conversación y antes de aceptar consultas, un mensaje de apertura fijo que identifique a "Geobot", declare su alcance limitado a Ecosistemas, Bienestar Animal y Gestión Ambiental, especifique su naturaleza preliminar y advierta que no radica trámites ni toma decisiones. (RF-C4-DC-01)
- **FR-002**: El ChatBot DEBE presentar un aviso de tratamiento de datos personales con enlace a la política del Municipio y exigir selección obligatoria y excluyente ("Autorizo" / "No autorizo") antes de habilitar el campo de consulta. (RF-C4-DC-02)
- **FR-003**: Si el usuario selecciona "No autorizo", el ChatBot DEBE operar en modo "sin registro": cada consulta se envía al C3 de forma autónoma sin historial de turnos, y se informa al usuario mediante un mensaje fijo que debe formular cada pregunta completa ya que no hay persistencia. (RF-C4-DC-02)
- **FR-004**: El ChatBot DEBE solicitar la selección de una categoría ("Ecosistemas", "Bienestar Animal", "Gestión Ambiental", "No estoy seguro") tras el tratamiento de datos y antes de la primera consulta. (RF-C4-DC-03)
- **FR-005**: El ChatBot DEBE enviar la categoría seleccionada al C3 como criterio de priorización (sin exclusión). Si elige "No estoy seguro", no se envía criterio de priorización. (RF-C4-DC-03)
- **FR-006**: El ChatBot DEBE ofrecer la opción "Emergencia o situación en curso" de forma accesible desde el mensaje de apertura, sin requerir aceptación de tratamiento de datos. (RF-C4-DC-04)
- **FR-007**: Al seleccionar la opción de emergencia, el ChatBot DEBE mostrar de inmediato los canales de atención inmediata vigentes (obtenidos del bloque administrable) sin enviar consulta al C3, y luego ofrecer continuar con la orientación normal. (RF-C4-DC-04)

### Key Entities

- **Mensaje de Apertura**: Texto fijo parametrizado que establece los límites y expectativas del usuario.
- **Autorización de Datos**: Estado booleano en la sesión del frontend (y propagado al C3) que determina si el flujo soporta historial y persistencia.
- **Categoría**: Etiqueta seleccionada por el usuario (o nula) que se envía en el payload de la consulta.
- **Contacto de Emergencia**: Datos dinámicos (teléfonos, URLs) servidos por el backend para respuesta ultrarrápida sin pasar por el LLM.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: En 5 conversaciones nuevas, el 100% muestra el mensaje fijo exacto de Geobot antes de permitir la consulta, cumpliendo RF-C4-DC-01.
- **SC-002**: En modo "No autorizo", 5 consultas de prueba demuestran un payload con 0 turnos previos, 0 caracteres de arrastre y 0 filas de conversación guardadas al cerrar.
- **SC-003**: Al seleccionar "Emergencia", los canales configurados se muestran en menos de 2 segundos, generando 0 llamadas al C3 para inferirlos.
- **SC-004**: En 12 pruebas de categorización, la opción seleccionada viaja correctamente al C3, y en casos cruzados (documento de otra dirección que responde la duda) el sistema lo recupera exitosamente a pesar del filtro de prioridad.

## Assumptions

- **Flujo Desacoplado**: Se asume que el backend C3 ya ha implementado (o implementará según Bloque 5/7) el manejo del flag `autorizo` para descartar historiales en base de datos. Este spec rige el comportamiento del frontend y la lógica de estado conversacional.
- **Configuración Dinámica**: Se asume que los canales de atención inmediata se pueden solicitar de forma rápida mediante un endpoint que no requiere procesamiento LLM, como está definido en RF-C3-IN-10.
- **Textos Fijos**: Los textos ("Autorizo", "No estoy seguro", etc.) provistos en el PDF son mandatorios y se implementarán literalmente.
- **Tolerancia a fallos**: El frontend (Bloque 4) controlará los casos donde C3 responda errores, pero la responsabilidad de este Bloque 3 es asegurar que el flujo de diseño conversacional (UI/UX lógica) se cumpla antes de enviar la pregunta.

