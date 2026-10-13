# Identidad — comparación local (T039)

Fecha 2026-10-10. Spec: `frontend/test/brand.spec.ts` (Chromium, adapter controlled). Guía: `../../guia-estilo.md`.

## Diez elementos (estilos computados dentro del iframe)

| Elemento | color | fondo | familia | Coincide con la guía |
| --- | --- | --- | --- | --- |
| Botón de apertura (launcher) | `rgb(255,255,255)` | `rgb(7,102,83)` = `#076653` | `"Segoe UI", sans-serif` | ✔ |
| Encabezado | `rgb(255,255,255)` | `rgb(12,52,44)` = `#0c342c` | `"Segoe UI", sans-serif` | ✔ |
| Título «Geobot» (h1) | `rgb(255,255,255)` | — | `"Segoe UI", sans-serif` | ✔ |
| Subtítulo | `rgb(255,255,255)` | — | `"Segoe UI", sans-serif` | ✔ |
| Botón primario | `rgb(255,255,255)` | `#076653` | `"Segoe UI", sans-serif` | ✔ |
| Mensaje de Geobot | `#0c342c` | `rgb(255,253,238)` = `#fffdee` | `"Segoe UI", sans-serif` | ✔ |
| Mensaje del ciudadano | `#0c342c` | `rgb(226,251,206)` = `#e2fbce` | `"Segoe UI", sans-serif` | ✔ |
| Enlace | `rgb(7,102,83)` = `#076653` | — | `"Segoe UI", sans-serif` | ✔ |
| Botón enviar | `#0c342c` | degradado `#d8ff3e → #c6f51e` | `"Segoe UI", sans-serif` | ✔ |
| Panel | `#0c342c` | `#ffffff` | `"Segoe UI", sans-serif` | ✔ |

Logo: `/brand/logo-envigado.png` (hash en la guía) junto a «Geobot» en el encabezado.

## Contrastes medidos

| Par | Ratio | Mínimo |
| --- | --- | --- |
| blanco / `#0c342c` | 13,61 | 4,5 ✔ |
| blanco / `#076653` | 6,92 | 4,5 ✔ |
| `#0c342c` / `#fffdee` | ≥ 4,5 (comprobado en la prueba) | 4,5 ✔ |
| `#0c342c` / `#e2fbce` | ≥ 4,5 | 4,5 ✔ |
| `#076653` / `#fffdee` | ≥ 4,5 | 4,5 ✔ |
| `#0c342c` / `#ffffff` | 13,61 | 4,5 ✔ |

## Hallazgo corregido

Una regla heredada (`.chat-header p { color:#666 }`) daba 2,16:1 sobre el encabezado oscuro; la detectó axe y se corrigió en `chat/panel.css`.

## Pendiente

Comparación contra el portal desplegado con el widget instalado, y confirmación institucional de la familia tipográfica (T080).
