# Guía de estilo — Geobot dentro del Observatorio (T016)

Fuente: portal oficial, lectura pública el 2026-10-10. Esta guía es evidencia **local**; la aprobación de RNF-C4-UI-04 exige además la comparación de estilos computados en el portal real (T039/T080).

## Artefactos fuente

| Artefacto | URL | SHA-256 |
| --- | --- | --- |
| CSS del Observatorio | `https://observatorioenvigado.geotrends.co/css/observatorio.css` | `b92057e91267a58abb49a2b16fe68892847ed50667b7e72d457ab4714f488a8c` |
| Logo | `https://observatorioenvigado.geotrends.co/img/logo_env.png` (PNG 200×200, 13 028 B) | `f02dbb6663f5a0d46bd7c92c04cb365013c4465d92964919b6d0e6fb394d1ee6` |
| Copia local del logo | `frontend/public/brand/logo-envigado.png` | igual al anterior |

El avatar existente (`agent-avatar.png`) **no** es el logo oficial y no se usa como tal.

## Colores (hexadecimal)

| Token | Hex | Origen (selector) | Uso en Geobot |
| --- | --- | --- | --- |
| `--obs-deep` | `#0c342c` | `:root`; texto de `body`, `.go-home`, `.layer-heatmap-tool__title` | texto principal, encabezado del panel |
| `--obs-green` | `#076653` | `:root`; `.layer-heatmap-btn i`, `accent-color` | botón de apertura, acciones primarias |
| `--obs-cream` | `#fffdee` | `:root`; `#calculated-area` | fondo de mensajes de Geobot |
| `--obs-mint` | `#e2fbce` | `:root` | fondo de estados informativos |
| `--obs-lime` | `#e3ef26` | `:root` | no se usa (sin contraste suficiente sobre blanco) |
| `--obs-night` | `#06231d` | `:root` | texto sobre fondos claros cuando se requiere mayor contraste |
| `#d8ff3e → #c6f51e` | degradado | `.btn-circle`, `.panel-filters .filter-btn.active` (texto `--obs-deep`) | botón activo/enviar |
| `#3e6666` | `#3e6666` | `.popup-tipo`, `.chart-panel-header` | texto secundario |
| `#ffffff` | `#ffffff` | superficies del portal | fondo del panel |

## Tipografía

| Declaración | Dónde |
| --- | --- |
| `font-family: 'Poppins', sans-serif; font-size: 13px; line-height: 1.3` | primera regla `body` |
| `font-family: "Segoe UI", sans-serif` | regla `body` del bloque «Observatorio Theme Sync» (posterior, **gana por cascada**) |

Ninguna regla `@font-face` ni `@import` de fuente existe en el CSS: el portal no descarga fuentes propias. Familia usada en Geobot: `"Segoe UI", sans-serif` (la computada del portal). Verificar la computada en navegador en T039; no se descarga ninguna fuente antes del primer clic (RNF-C4-UI-01).

## Contrastes medidos (WCAG 2.1, fórmula de luminancia relativa)

| Texto / fondo | Relación | Mínimo | Resultado |
| --- | --- | --- | --- |
| `#ffffff` sobre `#0c342c` | 13,61:1 | 4,5 | ✔ |
| `#ffffff` sobre `#076653` | 6,92:1 | 4,5 | ✔ |
| `#0c342c` sobre `#ffffff` | 13,61:1 | 4,5 | ✔ |
| `#076653` sobre `#ffffff` | 6,92:1 | 4,5 | ✔ |
| `#3e6666` sobre `#ffffff` | 6,37:1 | 4,5 | ✔ |
| `#0c342c` sobre `#c6f51e` | 10,68:1 | 4,5 | ✔ |
| `#0c342c` sobre `#d8ff3e` | 11,85:1 | 4,5 | ✔ |
| `#0c342c` sobre `#f7f8fa` | 12,81:1 | 4,5 | ✔ |

`#e3ef26` (lima) sobre blanco no cumple; por eso no se usa como texto.

## Estilos computados del portal (Chromium headless, 2026-10-10)

Medidos con `getComputedStyle` sobre `https://observatorioenvigado.geotrends.co/observatorio` (1366×800):

| Elemento | font-family | font-size | color | background |
| --- | --- | --- | --- | --- |
| `body` | `"Segoe UI", sans-serif` | 13px | `rgb(12, 52, 44)` = `#0c342c` | transparente |
| `.go-home` | `sans-serif` | 13px | `rgb(12, 52, 44)` | `rgb(255, 255, 255)` |
| `button` (primero) | `Arial` | 12.8px | `rgb(12, 52, 44)` | transparente |

Confirma que la familia efectiva del cuerpo es `"Segoe UI", sans-serif` y que `Poppins` no se aplica. Solo `FontAwesome` (iconos) figura en `document.fonts`; ninguna fuente de texto se descarga.

## Pendiente para aprobar N04

- Comparar estilos computados de diez elementos (botón, panel, encabezado, respuesta, …) contra el portal en navegador real (T039, T080).
- Confirmar con la entidad que `Segoe UI` es la tipografía institucional y no un respaldo accidental del CSS.
