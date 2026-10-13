# Contrato: encabezados de fichas y páginas

**Productor**: `kb-worker`. **Almacenamiento**: `kb_version.contenido_md`. **Exportación**:
`kb exportar-fichas`.

Ambos formatos son Markdown con frontmatter YAML. Los valores van entre comillas dobles y las
fechas en ISO 8601.

## Ficha de procedimiento (GT-P, MG-P) — RF-C3-IV-05

```yaml
---
codigo: "GT-P-004"
nombre: "Procedimiento permisos y autorizaciones ambientales"
direccion_responsable: "Gestión Ambiental"
estado: "Vigente"
url_origen: "https://gmas2.envigado.gov.co/gmas/VisualizacionDocumento.public?documento=0000010207"
version: "06"
fecha_actualizacion: "2022-09-12"
fecha_acceso: "2026-10-11T02:03:12-05:00"
formatos_vinculados: ["GT-F-011", "GT-F-012", "MG-F-002", "MG-F-051"]
normas_vinculadas: ["GT-N-218"]
---
```

Reglas:

- Los **10 campos son obligatorios**. Una lista vacía se escribe `[]`, nunca se omite.
- `formatos_vinculados` y `normas_vinculadas` salen de `gmas.vinculados` del informe de
  corrida y se clasifican por la letra de tipo del código (R9).
- `MG-P` vinculados no entran en estas dos listas. Cuentan para el alcance (RF-C3-IV-01).
- El cuerpo es el procedimiento completo, con las tablas normalizadas (RF-C3-IV-09).

## Página del Observatorio — RF-C3-IV-06

```yaml
---
url_origen: "https://ambientometroenvigado.com/calidad-del-aire/"
fecha_acceso: "2026-10-11T02:20:40-05:00"
hash_contenido: "3f1c…(64 hex)"
titulo: "Calidad del aire"
---
```

Reglas:

- Los tres primeros campos son obligatorios. `titulo` es opcional y sirve para las citas.
- `hash_contenido` es el mismo valor que `kb_version.hash_contenido`: el SHA-256 del texto
  normalizado del cuerpo, sin el encabezado. Por eso el hash es estable aunque cambie
  `fecha_acceso`.

## Documentos sin ficha (formatos, normas, documentos del Observatorio)

Su `contenido_md` lleva un encabezado mínimo con `codigo` (si lo tienen), `nombre`,
`url_origen` y `fecha_acceso`. Lo que exigen la matriz y las citas vive en `kb_elemento`.
