# Revisión manual de formatos (T050; RF-C3-IV-10, SC-005)

Cada formato (GT-F, MG-F) cargado en la base se revisa a mano antes de publicarlo,
aunque el control automático (`backend/src/kb/blankForms.ts`) ya lo haya dado por
"en blanco". El control automático no ve firmas escaneadas ni datos dentro de imágenes.

**Cómo revisar**

1. Lista de formatos: `make kb CMD="pendientes --json"` (o `exportar-matriz` cuando
   exista, filtrando `Tipo = Formato`).
2. Abrir el archivo **original** descargado de GMAS2 (`.doc`, `.docx` o `.pdf`), no el
   texto extraído.
3. Verificar que estén vacíos: nombres, documentos de identidad, direcciones, teléfonos,
   correos personales y firmas. Los correos y teléfonos institucionales del Municipio
   impresos en el formato no cuentan como diligenciamiento.
4. Llenar una fila por formato. Resultado: `en blanco` o `diligenciado`. Si es
   `diligenciado`, no se publica y se reporta al Líder de Proyecto.

La columna "Control automático" registra el resultado de `formatoEnBlanco` sobre los
archivos de la corrida en vivo del 2026-10-07. La revisión manual no lo reemplaza.

| Código | Archivo original | Control automático | Revisor | Fecha | Resultado | Observaciones |
|---|---|---|---|---|---|---|
| GT-F-011 | gt-f-011_solicitud_de_gestión_de_trámites_ambientales.docx | en blanco | Luis Ojeda|2026-10-08 |En blanco | |
| GT-F-012 | gt-f-012_informe_tecnico_de_visita.doc | en blanco |Luis Ojeda|2026-10-08|En blanco | |
| GT-F-014 | gt-f-014_visita_de_fauna_domestica.doc | en blanco |Luis Ojeda|2026-10-08|En Blanco | |
| GT-F-015 | gt-f-015_solicitud_de_esterilizacion.doc | en blanco |Luis Ojeda |2026-10-08 |En Blanco | |
| GT-F-058 | gt-f-058_cuestionario_para_solicitud_de_adopción_fauna_doméstica_enfoque_diferencial.docx | en blanco |Luis Ojeda |2026-10-08 |En Blanco | |
| GT-F-066 | gt-f-066_solicitud_identificación_por_medio_de_microchip.doc | en blanco |Luis Ojeda |2026-10-08 |En Blanco | |
| GT-F-076 | gt-f-0076_solicitud_identificación_por_medio_de_microchip_enfoque_diferencial.docx | en blanco |Luis Ojeda |2026-10-08 |En Blanco | |
| MG-F-051 | mg-f-051_evaluacion_del_servicio_de_gestion_de_tramites_o_servicios.docx | en blanco |Luis Ojeda |2026-10-08 |En Blanco | |

**Cierre**: la tarea T050 se marca cuando el 100 % de las filas tiene revisor, fecha y
resultado.

| Total formatos | Revisados | En blanco | Diligenciados |
|---|---|---|---|
| 8 |8 |8 |0 |
