# US2 — resultados locales (T040)

Fecha 2026-10-10. Adapter **controlled**: fixtures de respuestas preparadas; sin modelo, KB publicada ni lector real.

| Suite | Resultado |
| --- | --- |
| `test/markdown.test.tsx` (U03: 3 pasos, 3 tablas, 3 prosa + títulos, br, enlaces con paréntesis, código) | 16/16 |
| `test/markdown-security.test.tsx` (N03: 10 maliciosas, malformados, 3 consultas con marcado) | 16/16 |
| `test/external-links.spec.ts` (U04: 10 citas + enlace + política/canales; ratón, teclado; tabla a 320 px) | 5/5 |
| `test/reading-a11y.spec.ts` (axe A/AA: apertura, emergencia, categoría, respuesta con lista+tabla+enlaces+fuentes) | 1/1, 0 violaciones |
| `test/brand.spec.ts` (N04: 10 elementos, contrastes) | 1/1 |
| Regresión SPEC002/003 (`npm test` heredado) | 17/17 |

## Garantías verificadas

- Elementos permitidos exactamente: `p br strong em ul ol li table thead tbody tr th td h3 h4 a` (+ `div` envoltura del shell). Atributos: `a[href,target,rel,aria-label]`, `th[scope]`.
- Cero ejecución en las 10 cargas; HTML bruto no interpretado; protocolos `javascript:`, `data:`, `ftp:`, `mailto:`, `tel:` y `http:` solo como texto.
- `target="_blank"` y `rel="noopener noreferrer"` en el 100 % de enlaces; nombre accesible con «(se abre en una pestaña nueva)».
- Tabla ancha desplaza en su contenedor (con foco por teclado) y no el panel a 320 px.

## No cubierto

- Revisión manual con teclado/lectores/zoom: `us2-manual.md`, pendiente.
- Citas reales sobre la KB publicada (T081); Firefox/WebKit/dispositivos reales (T079).
- Aprobación de N04 contra el portal con widget instalado (T080).

## Corrección de efecto lateral

La regla heredada de contraste del encabezado (2,16:1) se corrigió; las pruebas heredadas se actualizaron a los literales de SPEC004 (canales no cargados, transcripción anónima visible, aria-label de enlaces).
