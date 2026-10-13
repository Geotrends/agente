# Contrato: informe de corrida (scraper → kb-worker)

**Productor**: `web_scraper` (Python). **Consumidor**: `kb-worker` (TypeScript).
**Ubicación**: `/data/runs/<run_id>.json` en el volumen de datos.

**Escritura atómica**: se escribe primero `<run_id>.json.tmp` y se renombra al terminar. El
`kb-worker` ignora los `.tmp`. Al procesarlo, lo mueve a `/data/runs/procesados/`.

**Requisitos**: RF-C3-IV-02 (verificaciones), IV-03 (estado), IV-04 (errores), IV-05
(metadatos GMAS2), IV-06 (hash de página).

## Forma

```jsonc
{
  "schema_version": 1,
  "run_id": "uuid-v4",
  "programada": true,                       // false si se lanzó a mano
  "iniciada_en": "2026-10-11T02:00:00-05:00",
  "terminada_en": "2026-10-11T02:41:10-05:00",
  "fuentes": ["gmas2_envigado", "ambientometro", "envigado_com", "observatorio_geotrends"],
  "completa": true,                         // false si se abortó; el kb-worker la registra
                                            // pero no infiere bajas ni "fuera de alcance"
  "enlaces": [ /* Enlace[] */ ]
}
```

### Enlace

```jsonc
{
  "url": "https://gmas2.envigado.gov.co/gmas/VisualizacionDocumento.public?documento=0000010207",
  "fuente": "gmas2_envigado",
  "fecha_hora": "2026-10-11T02:03:12-05:00",
  "rol": "procedimiento",                   // procedimiento | vinculado | descarga | pagina | documento
  "padre": null,                            // URL del enlace que lo descubrió (el GT-P, para vinculados)
  "titulo": "GT-P-004 - Procedimiento…",     // título de la página o texto del enlace del documento; null si no hay
  "estado_detectado": "vigente",            // vigente | derogado | no_aplica
  "resultado": "cambio_detectado",          // nuevo | sin_cambios | cambio_detectado | error
  "error": null,                            // { "tipo": "inaccesible|http|estructura_modificada|timeout|fuera_de_alcance",
                                            //   "codigo_http": 503 | null, "detalle": "texto sin trazas" }
  "hash_contenido": "sha256 hex | null",    // del contenido normalizado; null si hubo error
  "archivo": "gmas2_envigado/paginas_md/gmas/gt-p-004_....md",  // ruta relativa a /data; null si no se escribió
  "archivo_original": null,                 // ruta de la descarga (pdf/docx/...) cuando rol = descarga|documento
  "hash_original": null,
  "gmas": {                                 // solo fuente gmas2_envigado y rol procedimiento|vinculado
    "id": "0000010207",
    "codigo": "GT-P-004",
    "nombre": "Procedimiento permisos y autorizaciones ambientales",
    "version": "06",
    "fecha_actualizacion": "2022-09-12",
    "estado": "Vigente",
    "dependencia": "SECRETARÍA DE MEDIO AMBIENTE Y DESARROLLO AGROPECUARIO",
    "vinculados": [
      { "codigo": "GT-F-011", "nombre": "Trámites Ambientales", "id": "0000013830",
        "url": "https://gmas2.envigado.gov.co/gmas/VisualizacionDocumento.public?documento=0000013830",
        "grupo": "Registros" }
    ],
    "descarga": null                        // en un vinculado: URL absoluta de downloadFile.public
  }
}
```

## Reglas

1. **Errores sin pérdida**: con `resultado = error`, el scraper **no** sobrescribe el archivo
   anterior. `archivo` es `null` (RF-C3-IV-04).
2. **Estructura modificada**: se declara `estructura_modificada` cuando:
   - en GMAS2 falta el código, el estado o la tabla de cabecera;
   - en una página, el contenido útil cae por debajo del 30 % de la última extracción
     válida de esa URL. El umbral es configurable.
3. **Documentos derogados**: con `estado_detectado = derogado` se registra el enlace, pero
   no se descarga ni se siguen sus vinculados (RF-C3-IV-03, R10).
4. **Huella estable**: `hash_contenido` se calcula sobre el texto normalizado **después** de
   eliminar el ruido de interfaz (R8), para que el contenido dinámico no produzca falsos
   `cambio_detectado`.
5. **Hosts permitidos**: todo enlace cuyo host no esté en la lista permitida se reporta con
   `error.tipo = fuera_de_alcance` y no se descarga.
6. **Cobertura**: el scraper emite una entrada `resultado = error` (`error.tipo =
   "inaccesible"`, `detalle = "no alcanzado"`) por cada URL conocida en `MetadataStore` de
   las fuentes de la corrida que no visitó.
7. **Bajas**: una URL ausente de un informe **completo** solo se interpreta como "ya no
   vinculada" si **todos** sus padres se visitaron **sin error** en esa misma corrida y
   ninguno la lista. Si algún padre dio error, el vinculado se conserva intacto
   (RF-C3-IV-04).
