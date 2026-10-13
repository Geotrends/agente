# Contrato: exportación de la matriz documental (.xlsx)

**Requisitos**: RF-C3-IV-11, RF-C3-IV-12. **Origen**: vista `kb.v_matriz`.
**Comando**: `kb exportar-matriz` ([CLI](./kb-cli.md)).

- **Archivo**: `matriz-documental-<yyyy-mm-dd>.xlsx`.
- **Hoja**: una sola, llamada `Matriz documental`.
- **Filas**: la fila 1 lleva los encabezados y hay una fila por elemento de la matriz, en
  cualquier estado.
- **Orden**: por `tipo`, después por `codigo` o `nombre`.

| # | Columna | Valor | "N/A" cuando |
|---|---|---|---|
| 1 | Código | `codigo` | página o documento del Observatorio |
| 2 | Nombre | `nombre` | — |
| 3 | Tipo | Procedimiento / Formato / Norma / Página / Documento | — |
| 4 | Dirección responsable | Ecosistemas / Bienestar Animal / Gestión Ambiental / Secretaría (general) | — |
| 5 | URL de origen | `url_origen` (texto, no hipervínculo de fórmula) | — |
| 6 | Estado | Pendiente de aprobación / Publicado / Derogado | — |
| 7 | Versión | `version_documento` | página o documento del Observatorio |
| 8 | Fecha de última actualización | `dd/mm/aaaa` | página o documento del Observatorio |
| 9 | Formato original | `HTML`, `PDF`, `DOCX`… | — |
| 10 | Uso de OCR | Sí / No | — |
| 11 | Fecha de carga | `dd/mm/aaaa hh:mm` (America/Bogota), fecha del primer registro | — |
| 12 | Procedimiento de origen | códigos GT-P separados por coma; en el contenido del Observatorio, el nombre de la fuente | — |

Verificación (RF-C3-IV-12):

- abre en Excel y en LibreOffice;
- número de filas = `select count(*) from kb.kb_elemento`;
- 12 columnas exactas;
- "N/A" solo en las columnas 1, 7 y 8, y solo en filas del contenido del Observatorio.

Ninguna celda empieza por `=`, `+`, `-` o `@`: se antepone un apóstrofo para evitar
inyección de fórmulas.
