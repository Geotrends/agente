# Contrato — Scraper con renderizado (FR-013)

## Reglas
1. Toda **navegación o iframe** del navegador se permite solo si su host está en la lista de hosts permitidos. Los subrecursos (scripts, estilos, imágenes, XHR) de terceros públicos se permiten —las fuentes SPA no renderizan sin sus CDN— pero **toda solicitud a una dirección interna** (loopback, privada, enlace local, metadatos de nube) se aborta. Es una desviación deliberada de «cada subrecurso» del plan.
2. Tras `goto`, el host de `page.url` debe estar en la lista; si no, la página se descarta.
3. El contenido guardado queda asociado a la URL final validada del navegador.

## Entrada del informe de ejecución (descarte)

```json
{ "url": "<url solicitada>", "error": { "tipo": "fuera_de_alcance", "detalle": "host_no_permitido" } }
```

Es un error de enlace del informe existente: el backend ya lo importa y notifica `verificacion_fallida` por URL, agrupando repeticiones (principio VI). No viaja ningún cuerpo de página.
