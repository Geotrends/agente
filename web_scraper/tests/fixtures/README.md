# Fixtures HTML reales

Generadas con `python -m scripts.capture_fixtures`. No editar a mano: si la
fuente cambia, se vuelven a capturar y las pruebas dicen qué se rompió.

| Fixture | URL pedida | Host/URL final | ¿Necesita JS? | Nota |
|---|---|---|---|---|
| GT-P-004 | https://gmas2.envigado.gov.co/gmas/VisualizacionDocumento.public?documento=0000010207 | https://gmas2.envigado.gov.co/gmas/VisualizacionDocumento.public?documento=0000010207 | sí | estado: Vigente |
| GT-P-021 | https://gmas2.envigado.gov.co/gmas/VisualizacionDocumento.public?documento=0000010445 | https://gmas2.envigado.gov.co/gmas/VisualizacionDocumento.public?documento=0000010445 | sí | estado: Vigente |
| GT-P-029 | https://gmas2.envigado.gov.co/gmas/VisualizacionDocumento.public?documento=0000004622 | https://gmas2.envigado.gov.co/gmas/VisualizacionDocumento.public?documento=0000004622 | sí | estado: Vigente |
| GT-F-011 | https://gmas2.envigado.gov.co/gmas/VisualizacionDocumento.public?documento=0000013830 | https://gmas2.envigado.gov.co/gmas/VisualizacionDocumento.public?documento=0000013830 | sí | estado: Vigente |
| MG-P-003 | https://gmas2.envigado.gov.co/gmas/VisualizacionDocumento.public?documento=0000002961 | https://gmas2.envigado.gov.co/gmas/VisualizacionDocumento.public?documento=0000002961 | sí | estado: Derogado |
| GT-N-218 | https://gmas2.envigado.gov.co/gmas/VisualizacionDocumento.public?documento=0000001203 | https://gmas2.envigado.gov.co/gmas/VisualizacionDocumento.public?documento=0000001203 | sí | estado: Vigente |
| derogado | https://gmas2.envigado.gov.co/gmas/VisualizacionDocumento.public?documento=0000000475 | https://gmas2.envigado.gov.co/gmas/VisualizacionDocumento.public?documento=0000000475 | sí | estado: Derogado |
| observatorioenvigado.geotrends.co | https://observatorioenvigado.geotrends.co/observatorio | https://observatorioenvigado.geotrends.co/observatorio | sí | texto crudo 1215 vs renderizado 2927 caracteres |
| ambientometroenvigado.com | https://ambientometroenvigado.com/ | https://ambientometroenvigado.com/ | no | texto crudo 11412 vs renderizado 12359 caracteres |

Notas de la captura del 2026-10-07:

- `MG-P-003.html` y `derogado.html` (MG-F-002) están derogados en GMAS2, aunque GT-P-004 los
  cita. Por eso hoy no hay MG en el corpus (research R10).
- `observatorioenvigado.geotrends.co` es un visor de mapas (MapLibre) que necesita JS
  (`render_js=True`) y nunca deja la red inactiva: se renderiza con `load` + espera.
- Host canónico de ambientometro: `ambientometroenvigado.com`, sin `www.`.
