# US1 — resultados locales (T030)

Fecha: 2026-10-10. Adapter: **controlled** (API simulada con `page.route`; export estático real de `/chat`, host fixture y CSP generada por `build-csp.mjs`). Navegador: **Chromium headless** (único disponible aquí; Firefox/WebKit/Edge/Chrome no instalados, y ninguno es Chrome Android ni Safari iOS reales). Esto NO acredita RF-C4-UI-01/02 para los cinco entornos exigidos: queda para T078/T079.

Comando: `npm --prefix frontend run build:e2e && npx playwright test --project=chromium` → **20/20**.

## Artefactos medidos

| Dato | Valor |
| --- | --- |
| `public/embed/geobot-launcher.js` | **5 083 bytes** sin comprimir (límite 10 000), sha256 `f4915193084dbadb014b4c79f091054b9bef0b87a362b10ffa2fe6cf291e17c6` |
| Dependencias del launcher | ninguna (sin React/Next/imports dinámicos); solo `widget/protocol.ts` |
| CSP de `/chat` (variante prueba) | 1 cabecera; `default-src 'self'`, `script-src 'self'` + 7 hashes, `style-src 'self'`, `object-src 'none'`, `frame-ancestors <host>`; sin `X-Frame-Options` |
| Producción | misma generación con `--ancestor https://observatorioenvigado.geotrends.co` (Dockerfile) |

## Casos

| Spec | Caso | Resultado |
| --- | --- | --- |
| widget-launcher | 3 cargas con caché vacía: 0 solicitudes al dominio Geobot antes del clic; 1 iframe tras el primer clic | ✔ |
| widget-launcher | 2 consultas + 5 ciclos ocultar/mostrar: transcripción íntegra, 1 sesión, 1 conversación, 2 consultas, sin recarga del iframe, cámara del mapa intacta | ✔ |
| widget-launcher | oculto: fuera del árbol accesible; botón visible | ✔ |
| widget-viewport | 320×640, 375×667, 767×900 → pantalla completa; 768×900 y 1366×768 → 400 × min(640, ⌊0,85·alto⌋); sin desplazamiento horizontal; cierre visible | ✔ |
| widget-viewport | cierre devuelve el foco al botón | ✔ |
| widget-viewport | móvil: `role=dialog`, `aria-modal`, exterior `inert`, restauración exacta (lo ya inerte sigue inerte), Tab ×25 no sale del iframe | ✔ |
| widget-viewport | escritorio: sin diálogo ni `inert` | ✔ |
| widget-viewport | 6 mensajes ajenos/malformados ignorados; el tráfico iframe→host solo contiene READY y no lleva texto, token, UUID, categoría ni decisión; origen = Geobot | ✔ |
| widget-csp | una sola CSP, `frame-ancestors` exacto, sin XFO | ✔ |
| widget-csp | incrusta el host autorizado; `127.0.0.1` (origen distinto) queda bloqueado (`chrome-error://`) | ✔ |
| widget-startup | launcher → puente → flujo → cliente: 0 sesiones antes de decidir; luego 1 sesión, 1 conversación, cuerpos sin `provider/model/message/history`, 2.ª consulta con 1 par | ✔ |
| widget-startup | ocultar con consulta pendiente no la cancela; reaparece una única respuesta | ✔ |
| storage | token/UUID/texto ausentes de localStorage, sessionStorage, cookies, URL e IndexedDB (Autorizo y No autorizo); recarga reinicia | ✔ |

## No cubierto (pendiente, sin simular)

- Firefox, WebKit, Edge y Chrome por canal; Chrome Android y Safari iOS reales; teclado virtual y safe areas reales.
- Bloqueo CSP en móviles, 6 pruebas de incrustación con el origen de producción (T079).
- Nginx real sirviendo `/chat` (no hay Docker/nginx en este entorno): la configuración `location = /chat` está escrita pero no ejecutada.
- Instalación en el portal real (T078).
- HAR sanitizado: se registraron las listas de solicitudes por aserción, no un archivo HAR.
