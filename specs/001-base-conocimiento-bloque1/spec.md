# Feature Specification: Base de conocimiento institucional (Bloque 1)

**Feature Branch**: `001-base-conocimiento-bloque1` (el trabajo se integra en `develop`)

**Created**: 2026-10-07

**Status**: Draft

**Input**: User description: "Basado en el documento de documentacion_C3_C4 quiero empezar con
la implementacion del bloque 1. todos sus requisitos funcionales y no funcionales. Hay varias
cosas que ya se cumplen en el código actual, como otras que no. Debes de primero evaluar el
estado actual del proyecto para posteriormente definir que esta implementado, que esta
implementado pero no cumple con los requisitos y que no esta implementado."

**Requisitos cubiertos**: RF-C3-IV-01 a RF-C3-IV-12 y RNF-C3-IV-01 a RNF-C3-IV-03 (hitos
H1-C3 y H3-C3). Línea base: `GRT_Documentacion_C3_C4_ENV-15-32-1244-26_v1`.

## Estado actual

La evaluación completa, con evidencia por requisito, está en [diagnostico.md](./diagnostico.md).
Ninguno de los 15 requisitos se cumple por completo:

| Estado | Requisitos |
|---|---|
| Implementado pero no cumple | RF-C3-IV-01, IV-04, IV-07, IV-09; RNF-C3-IV-01 |
| Implementado de forma parcial | RF-C3-IV-03, IV-05, IV-06, IV-08, IV-11; RNF-C3-IV-02 |
| No implementado | RF-C3-IV-02, IV-10, IV-12; RNF-C3-IV-03 |

Los incumplimientos de mayor impacto:

- La base contiene fuentes fuera del alcance acordado (Concejo y ministerios).
- Falta el procedimiento GT-P-029 y los MG-P/MG-F citados.
- Un cambio en la estructura de una página sobrescribe la última versión buena.
- Las tablas de actividades de los procedimientos llegan ilegibles.
- No existe vigilancia periódica, umbral de confianza del OCR ni matriz documental con los
  12 campos.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Base acotada y trazable con matriz documental (Priority: P1)

El administrador del sistema y las Direcciones necesitan saber exactamente qué contiene la
base de conocimiento. Cada documento o página cargado aparece en una matriz documental con
su origen, la dirección responsable, el estado y la versión. Nada fuera de la matriz puede
alimentar las respuestas.

**Why this priority**: es la condición de las demás. Sin una base cerrada y auditable,
ninguna respuesta del chat puede considerarse validada (principio III de la constitución;
criterio de aceptación "Información validada" del C3).

**Independent Test**: se ejecuta la carga sobre las fuentes autorizadas y se compara la
matriz contra el contenido de la base. Coinciden 1 a 1 y no aparece contenido de fuentes
no autorizadas.

**Acceptance Scenarios**:

1. **Given** las fuentes autorizadas configuradas, **When** se completa una carga,
   **Then** la base contiene los 6 GT-P (004, 011, 020, 021, 027, 029), sus GT-F y normas
   vinculados, los MG-P/MG-F citados en esos GT-P y las páginas y documentos de las fuentes
   del Observatorio autorizadas, y nada más.
2. **Given** una carga completa, **When** se cuenta la matriz, **Then** tiene una fila por
   cada documento o página cargado, con los 12 campos diligenciados. Solo el contenido del
   Observatorio (páginas y PDF) lleva "N/A", y únicamente en código, versión y fecha de
   actualización. Su procedimiento de origen es el nombre de la fuente.
3. **Given** un MG cargado, **When** se busca su código, **Then** está citado en al menos
   uno de los GT-P de la base.
4. **Given** contenido de fuentes ya no autorizadas (Concejo, ministerios) en el corpus
   anterior, **When** se aplica esta feature, **Then** ese contenido deja de ser
   recuperable y no figura en la matriz.

---

### User Story 2 - Contenido fiel: fichas, páginas, tablas y formatos en blanco (Priority: P1)

Las Direcciones necesitan que lo que el sistema lee sea fiel al original:

- Cada procedimiento tiene una ficha con sus metadatos (código, versión, fechas, estado,
  formatos y normas vinculados).
- Cada página del Observatorio lleva su URL, la fecha de acceso y una huella de su contenido.
- Las tablas de actividades conservan sus filas y columnas.
- Ningún formato cargado contiene datos personales.

**Why this priority**: una tabla desordenada produce un plazo o un responsable incorrecto,
y un formato diligenciado expone datos personales. Ambos son fallos críticos.

**Independent Test**: se generan las fichas y se comparan contra GMAS2. Se revisa una
muestra de tablas y el 100 % de los formatos.

**Acceptance Scenarios**:

1. **Given** un procedimiento de la matriz, **When** se genera su ficha, **Then** el
   encabezado tiene los 10 campos (código, nombre, dirección responsable, estado, URL de
   origen, versión, fecha de última actualización, fecha de acceso, códigos de formatos
   vinculados, códigos de normas vinculadas). Los códigos coinciden con los vinculados en
   GMAS2.
2. **Given** una página del Observatorio extraída dos veces sin cambios, **When** se
   comparan los encabezados, **Then** la huella es idéntica. Si el contenido cambió, la
   huella es distinta.
3. **Given** un procedimiento con la tabla "Flujos de trabajo y actividades", **When** se
   convierte, **Then** cada actividad conserva su número, descripción, responsable y
   tiempo en la fila y columna correctas.
4. **Given** un formato con algún campo de diligenciamiento lleno (nombre, documento de
   identidad, dirección, teléfono, correo o firma), **When** se intenta cargar, **Then** no
   se carga y se notifica al administrador.

---

### User Story 3 - Documentos escaneados confiables (Priority: P2)

El administrador necesita que los documentos escaneados entren a la base solo si su texto
es legible, y enterarse de cada uno que se descarta.

**Why this priority**: un escaneo ilegible produce respuestas sin sentido, y uno descartado
en silencio deja un hueco que nadie detecta.

**Independent Test**: se procesa el lote real de documentos con OCR. Se verifica que
cargados más descartados igualan el total y que cada descarte tiene su registro y su
notificación.

**Acceptance Scenarios**:

1. **Given** un PDF o DOCX con menos de 80 caracteres de texto nativo, o un archivo de
   imagen, **When** se procesa, **Then** pasa por OCR antes de convertirse. Un PDF o DOCX
   con 80 caracteres o más no pasa por OCR.
2. **Given** un documento procesado con OCR con confianza media superior al 80 %,
   **When** termina el procesamiento, **Then** se carga.
3. **Given** un documento procesado con OCR con confianza media del 80 % o menos,
   **When** termina el procesamiento, **Then** no se carga, queda un registro (código o URL,
   confianza, fecha y hora) y el administrador recibe una notificación.
4. **Given** cualquier documento procesado, **When** se consulta el registro de
   procesamiento, **Then** muestra su conteo de caracteres nativos y si se aplicó OCR.

---

### User Story 4 - Vigilancia automática de las fuentes (Priority: P2)

El administrador necesita que el sistema revise cada enlace configurado al menos cada 7
días, sin intervención manual, para detectar cambios, derogaciones y fallas, y conservar la
última versión validada cuando algo falla.

**Why this priority**: evita responder con información obsoleta o derogada, y evita que la
base quede desactualizada en silencio.

**Independent Test**: se dejan correr dos verificaciones programadas consecutivas y se
revisa el registro. Después se fuerzan un derogado de prueba y un enlace inaccesible.

**Acceptance Scenarios**:

1. **Given** los enlaces configurados, **When** pasan dos ciclos programados, **Then** cada
   enlace tiene al menos 2 verificaciones separadas por 7 días o menos, cada una con fecha y
   hora, enlace, estado detectado (vigente o derogado) y resultado (sin cambios, cambio
   detectado o error).
2. **Given** un documento de la base cuyo estado en GMAS2 pasa a derogado, **When** la
   verificación lo detecta, **Then** queda marcado como derogado en la matriz, el 100 % de
   las consultas posteriores no recupera fragmentos de él, y el administrador recibe una
   notificación con el documento, la fecha y la hora.
3. **Given** un enlace inaccesible o con la estructura modificada, **When** falla su
   verificación, **Then** se notifica al administrador en esa misma ejecución (enlace,
   fecha, hora y tipo de error), y las consultas siguen recuperando la última versión
   validada.
4. **Given** un enlace con contenido modificado, **When** la verificación lo detecta,
   **Then** la nueva versión queda pendiente de aprobación y no se recupera hasta que el
   administrador la publique. Mientras tanto se sigue usando la versión publicada.

---

### User Story 5 - Reindexación sin interrupción y en tiempo acotado (Priority: P3)

El ciudadano no debe notar que la base se está actualizando, y el administrador necesita que
una carga completa termine en menos de 2 horas.

**Why this priority**: es una salvaguarda operativa. Hoy la reindexación documentada
detiene el chat.

**Independent Test**: se lanza una reindexación completa enviando una consulta cada 30
segundos. Después se repite con un fallo forzado a mitad de la indexación.

**Acceptance Scenarios**:

1. **Given** una reindexación completa en curso, **When** llegan consultas cada 30
   segundos, **Then** el 100 % se responde sin error con la última versión completa.
2. **Given** una indexación que falla a mitad, **When** se consulta, **Then** se responde
   con la versión completa anterior. Nunca se responde con resultados parciales.
3. **Given** la base completa en el entorno de producción, **When** se mide la ingesta
   completa tres veces, **Then** las tres terminan en menos de 2 horas.

---

### User Story 6 - Exportación de la matriz y retención de registros (Priority: P3)

El administrador necesita exportar la matriz documental a una hoja de cálculo para revisarla
con las Direcciones. Además, necesita conservar durante al menos 12 meses los registros de
verificaciones, descartes por OCR y notificaciones.

**Why this priority**: soporta la revisión institucional y permite reconstruir qué versión
estaba vigente en una fecha dada. No bloquea el funcionamiento del chat.

**Independent Test**: se exporta la matriz y se abre en Excel y en LibreOffice. Se insertan
registros con fecha simulada de 11 meses y se verifica que siguen consultables.

**Acceptance Scenarios**:

1. **Given** la matriz documental, **When** el administrador la exporta, **Then** obtiene
   un archivo .xlsx que abre en Excel y en LibreOffice, con el mismo número de filas que la
   matriz y las 12 columnas.
2. **Given** registros de verificación, de descarte por OCR y notificaciones con 11 meses
   de antigüedad, **When** se consultan, **Then** siguen disponibles.

---

### Edge Cases

- **Documento vinculado a varios GT-P** (p. ej. MG-F-051): la matriz registra todos sus
  procedimientos de origen en una sola fila; no se duplica.
- **GT-P que pasa a derogado**: se marca y se excluye. Sus formatos y normas siguen en la
  base solo si otro GT-P vigente los vincula; si no, se excluyen y se notifican.
- **Confianza OCR exactamente del 80 %**: se descarta (el requisito exige "superior al
  80 %").
- **PDF con 80 caracteres nativos o más pero con la capa de texto ilegible**: no pasa por
  OCR, según RF-C3-IV-08. Se carga, queda marcado en el registro de procesamiento como
  texto nativo de baja calidad y se notifica al administrador para que lo revise.
- **Página con contenido dinámico** (fechas, contadores, "Cargando..."): ese ruido no debe
  cambiar la huella ni producir falsos "cambio detectado".
- **Enlace caído durante varias semanas**: cada ejecución registra el error, la última
  versión validada sigue en uso y la notificación se emite desde la primera falla.
- **Fuente del Observatorio nuevo sin contenido publicado aún**: la fuente queda configurada
  y su verificación registra el resultado; no bloquea el resto de la carga.
- **Formato descargable en GMAS2 con firmas o nombres de funcionarios en el bloque
  "Crea / Revisa / Aprueba"** de la página del visor: es información institucional, no
  diligenciamiento, y no impide la carga.
- **Escaneo vacío** (sin caracteres tras OCR): cuenta como descarte con confianza 0 %.

## Requirements *(mandatory)*

### Functional Requirements

**Alcance y matriz (RF-C3-IV-01, IV-11, IV-12)**

- **FR-001**: El sistema DEBE construir la base solo a partir de:
  - los procedimientos GT-P-004, GT-P-011, GT-P-020, GT-P-021, GT-P-027 y GT-P-029 de GMAS2;
  - los formatos y normas vinculados a cada uno;
  - los MG-P y MG-F citados dentro de esos GT-P;
  - las fuentes del Observatorio autorizadas: páginas y documentos de ambientometroenvigado.com,
    las 4 páginas de envigado.gov.co (servicio al ciudadano, contáctenos, PQRS y trámites
    de la Secretaría) y las páginas de observatorioenvigado.geotrends.co.
  (RF-C3-IV-01)
- **FR-002**: El sistema DEBE retirar de la base y de la recuperación todo contenido que no
  pertenezca al alcance de FR-001, incluido el del Concejo y los ministerios cargado antes.
  (RF-C3-IV-01)
- **FR-003**: El sistema DEBE mantener una matriz documental con una fila por documento o
  página cargado y estos 12 campos: código, nombre, tipo, dirección responsable, URL de
  origen, estado, versión, fecha de última actualización, formato original, indicador de uso
  de OCR, fecha de carga y procedimiento de origen. Solo esos tres campos admiten "N/A", y
  solo en el contenido del Observatorio. Reglas:
  - En el contenido del Observatorio (sus páginas y los documentos que publica, como los PDF
    de ambientometro), el código, la versión y la fecha de actualización DEBEN decir "N/A".
  - En ese mismo contenido, el procedimiento de origen DEBE ser el nombre de la fuente
    ("Ambientómetro", "Envigado.gov.co", "Observatorio Geotrends").
  - La fecha de carga DEBE ser la fecha en que el elemento se registró en la base. Aplica
    también a los elementos pendientes de aprobación.
  (RF-C3-IV-11)
- **FR-004**: El sistema DEBE asignar la dirección responsable así:
  - GT-P-004 → Gestión Ambiental;
  - GT-P-011, 020, 021 y 027 → Bienestar Animal;
  - GT-P-029 → Ecosistemas.
  Los documentos vinculados heredan la dirección de su procedimiento de origen. El contenido
  que no proviene de un GT-P se asigna con un mapa por sección del sitio; lo que no case con
  ninguna sección se registra como "Secretaría (general)". (RF-C3-IV-11)
- **FR-005**: El sistema DEBE garantizar que el número de filas de la matriz sea igual al
  número de documentos y páginas cargados, y que una auditoría no encuentre contenido
  recuperable fuera de la matriz. (RF-C3-IV-01, IV-11)
- **FR-006**: El sistema DEBE permitir al administrador del sistema exportar la matriz
  completa en formato .xlsx con las 12 columnas de FR-003. (RF-C3-IV-12)

**Fichas y páginas (RF-C3-IV-05, IV-06, IV-09, IV-10)**

- **FR-007**: El sistema DEBE generar, mediante extracción automatizada, una ficha en
  Markdown por cada GT-P y MG-P de la matriz. La ficha DEBE contener el procedimiento
  completo y un encabezado con los 10 campos del escenario 2.1. (RF-C3-IV-05)
- **FR-008**: El sistema DEBE almacenar cada página del Observatorio como un archivo
  Markdown con su contenido y un encabezado con la URL de origen, la fecha de acceso y una
  huella del contenido. La huella DEBE ser idéntica si el contenido no cambió y distinta si
  cambió. (RF-C3-IV-06)
- **FR-009**: El sistema DEBE conservar, al convertir cada GT-P y MG-P, todas las filas y
  columnas de sus tablas con el contenido de cada celda, incluidas las tablas anidadas del
  visor de GMAS2. DEBE eliminar el ruido de la interfaz ("Cargando...", botones de vista).
  (RF-C3-IV-09)
- **FR-010**: El sistema DEBE cargar los formatos (GT-F, MG-F) solo si todos sus campos de
  diligenciamiento están vacíos: nombres, documentos de identidad, direcciones, teléfonos,
  correos y firmas. Un formato con datos personales NO DEBE cargarse y DEBE notificarse al
  administrador. (RF-C3-IV-10)

**OCR (RF-C3-IV-07, IV-08)**

- **FR-011**: El sistema DEBE aplicar OCR antes de convertir a Markdown a:
  - todo PDF o DOCX cuyo texto nativo, medido sobre el documento completo, tenga menos de
    80 caracteres;
  - todo archivo de imagen.
  NO DEBE aplicar OCR a un PDF o DOCX con 80 caracteres nativos o más. (RF-C3-IV-08)
- **FR-012**: El sistema DEBE registrar, por cada documento procesado, el conteo de
  caracteres nativos y si se aplicó OCR. (RF-C3-IV-08)
- **FR-013**: El sistema DEBE cargar un documento procesado con OCR solo si la confianza
  media que reporta el motor de OCR es superior al 80 %. Cada descarte DEBE generar un
  registro (código o URL, confianza, fecha y hora) y una notificación al administrador.
  Cargados más descartados DEBEN igualar el total del lote. (RF-C3-IV-07)

**Vigilancia de fuentes (RF-C3-IV-02, IV-03, IV-04)**

- **FR-014**: El sistema DEBE verificar automáticamente cada enlace configurado, sin
  intervención manual, con no más de 7 días entre verificaciones. Cada verificación DEBE
  registrar la fecha y hora, el enlace, el estado detectado (vigente o derogado) y el
  resultado (sin cambios, cambio detectado o error). (RF-C3-IV-02)
- **FR-015**: El sistema DEBE marcar como derogado en la matriz, desde el momento en que lo
  detecta, todo documento cuyo estado en GMAS2 sea derogado. DEBE excluirlo de la
  recuperación en todas las consultas posteriores y notificar al administrador con el
  documento, la fecha y la hora. (RF-C3-IV-03, en relación con RF-C3-AD-03)
- **FR-016**: El sistema DEBE notificar al administrador desde la primera verificación
  fallida de un enlace (inaccesible o con estructura modificada), con el enlace, la fecha,
  la hora y el tipo de error. DEBE mantener en uso la última versión validada; una
  extracción fallida o degradada NUNCA DEBE reemplazarla. (RF-C3-IV-04)
- **FR-017**: El sistema DEBE registrar el contenido nuevo o modificado que detecte una
  verificación como pendiente de aprobación. Ese contenido NO DEBE ser recuperable hasta que
  el administrador lo publique; mientras tanto se usa la versión publicada. (Principio III
  de la constitución; prepara RF-C3-AD-21)

**Notificaciones y registros**

- **FR-018**: El sistema DEBE persistir las notificaciones al administrador (derogado,
  verificación fallida, descarte por OCR, formato con datos personales, texto nativo de
  baja calidad) con tipo, fecha y hora, descripción y estado ("No revisada" / "Revisada").
  Estas notificaciones NO DEBEN enviarse por canales externos. Su pantalla en el panel llega
  con el bloque 7 (RF-C3-AD-28). (RF-C3-IV-03, IV-04, IV-07)
- **FR-019**: El sistema DEBE conservar durante al menos 12 meses los registros de
  verificación, de descarte por OCR y las notificaciones. La retención DEBE ser configurable
  y verificable con registros de fecha simulada. (RNF-C3-IV-03)

### Non-Functional Requirements

- **NFR-001**: La ingesta y la indexación completas de la base (conversión, OCR,
  representación semántica e indexación) DEBEN terminar en menos de 2 horas en el entorno de
  producción, en 3 de 3 mediciones. (RNF-C3-IV-01)
- **NFR-002**: Durante una ingesta o reindexación, el sistema DEBE responder el 100 % de las
  consultas con la última versión completa de la base, y reemplazarla solo cuando la nueva
  indexación termine correctamente, sin detener el servicio de chat. (RNF-C3-IV-02)

### Key Entities *(include if feature involves data)*

- **Elemento de la base (fila de la matriz)**: un documento o una página cargado. Lleva los
  12 campos de FR-003 y un estado (pendiente de aprobación, publicado o derogado). Se
  relaciona con uno o varios procedimientos de origen y con su contenido indexado.
- **Ficha de conocimiento**: representación en Markdown de un GT-P o MG-P, con encabezado de
  10 campos y el contenido completo, incluidas las tablas.
- **Página del Observatorio**: representación en Markdown de una página web, con URL, fecha
  de acceso y huella del contenido.
- **Enlace configurado**: URL vigilada por la verificación periódica; pertenece a una fuente
  autorizada.
- **Verificación**: resultado de revisar un enlace en una ejecución (fecha y hora, enlace,
  estado detectado, resultado y, si aplica, tipo de error).
- **Registro de procesamiento**: por documento, conteo de caracteres nativos, si se aplicó
  OCR, confianza del OCR y decisión (cargado o descartado).
- **Notificación al administrador**: evento con tipo, objeto afectado, fecha y hora,
  descripción y estado de revisión.
- **Mapa de direcciones**: asignación de cada GT-P a su dirección, y de cada sección de sitio
  a una dirección o a "Secretaría (general)".

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100 % de lo cargado figura en la matriz con su código o URL y su dirección
  responsable, y una auditoría encuentra 0 elementos recuperables fuera de la matriz.
- **SC-002**: Los 6 GT-P del alcance están en la base, y el 100 % de los MG cargados está
  citado en al menos uno de ellos.
- **SC-003**: El 100 % de las fichas tiene los 10 campos, y sus códigos de formatos y normas
  coinciden con GMAS2 al compararlos directamente.
- **SC-004**: En una revisión visual de 2 de los 6 procedimientos, el 100 % de sus tablas
  conserva filas, columnas y contenido. Si alguna falla, se revisan los 6 y todos pasan.
- **SC-005**: El 100 % de los formatos cargados tiene vacíos sus campos de
  diligenciamiento.
- **SC-006**: En el lote real de documentos con OCR, cargados más descartados igualan el
  total, todo documento con confianza superior al 80 % queda cargado y cada descarte tiene
  registro y notificación.
- **SC-007**: El registro muestra 2 verificaciones programadas consecutivas de cada enlace,
  separadas por 7 días o menos y sin intervención manual.
- **SC-008**: Con un documento de prueba derogado, 0 de las consultas posteriores recuperan
  fragmentos de él. Con un enlace caído, la notificación aparece en la misma ejecución y las
  consultas siguen respondiendo con la versión anterior.
- **SC-009**: Durante una reindexación completa, el 100 % de las consultas de prueba (una
  cada 30 segundos) se responde sin error, también con un fallo forzado a mitad.
- **SC-010**: La ingesta completa termina en menos de 2 horas en 3 de 3 mediciones.
- **SC-011**: La exportación abre en Excel y en LibreOffice con el mismo número de filas
  que la matriz y 12 columnas.
- **SC-012**: Los registros con 11 meses de antigüedad simulada siguen consultables.
- **SC-013**: Dos extracciones de la misma página sin cambios producen la misma huella, y
  con un cambio producen huellas distintas, en el 100 % de las páginas de prueba
  (RF-C3-IV-06).

## Assumptions

- **Fuentes autorizadas** (confirmado por el usuario):
  - GMAS2 (los 6 GT-P y sus vinculados);
  - ambientometroenvigado.com, páginas y documentos adjuntos;
  - las 4 páginas actuales de envigado.gov.co;
  - observatorioenvigado.geotrends.co.
  Concejo, MinAmbiente y MinAgricultura salen del alcance.
- **GT-P-029** se encuentra en GMAS2 con el identificador `0000004622` (confirmado por el
  usuario).
- **"Normas vinculadas"** incluye toda norma enlazada desde un GT-P, aunque su código no
  empiece por GT-N (p. ej. CS-N-012, IV-N-102, IV-N-258), porque GMAS2 las asocia al
  procedimiento.
- **Mapa por sección del sitio**: lo propone el equipo de desarrollo durante el plan y lo
  confirma el Líder de Proyecto antes de la carga inicial.
- **Panel de administración**: las notificaciones y la exportación se generan y se
  persisten en esta feature, y quedan disponibles por un servicio y por una acción del
  operador. Sus pantallas llegan con el bloque 7 (confirmado por el usuario). Hasta
  entonces, la publicación de contenido pendiente (FR-017) se hace con una acción
  controlada del administrador técnico.
- **Carga inicial**: la base inicial se publica como un lote, una vez que las Direcciones
  validan la matriz (hito H3-C3). Después rige el flujo de pendiente → publicado.
- **Persistencia** (fijada por la constitución y confirmada por el usuario): esta feature
  incluye migrar la matriz, los registros y las notificaciones a PostgreSQL, y la indexación
  vectorial a Qdrant. El plan la detalla.
- **Frecuencia de verificación**: un ciclo semanal por defecto. Es configurable, pero nunca
  con más de 7 días entre verificaciones.
- **Momento de la exclusión de un derogado**: se aplica al procesar el informe de la corrida
  que lo detecta. Nominalmente ocurre en segundos, y como máximo en 5 minutos con el sondeo
  de respaldo.
- **"Estructura modificada"**: una extracción se considera degradada cuando no encuentra
  los elementos esperados de su fuente (p. ej. el código, el estado o las secciones de un
  GT-P), o cuando su contenido útil cae muy por debajo de la versión validada. El umbral
  exacto se fija en el plan.
- **Requisitos fuera de este bloque**: la fragmentación (RF-C3-DI-13), la selección de
  fragmentos (RF-C3-DI-14), la carga manual de documentos y la gestión de la lista de
  enlaces (RF-C3-AD-01, AD-14 a AD-17) pertenecen a los bloques 2 y 7. Esta feature no las
  modifica más allá de lo necesario para no romperlas.
