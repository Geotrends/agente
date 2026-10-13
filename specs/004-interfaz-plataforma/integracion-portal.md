# Integración del widget en el Observatorio (T078 — preparado, NO instalado)

Estado: **snippet y rollback preparados; la instalación en el entorno de aceptación del portal no se ha realizado** (no hay acceso ni autorización operativa en esta ejecución). La tarea T078 permanece pendiente; un fixture local no la sustituye.

## Qué se instala

Una sola etiqueta `<script>` en `https://observatorioenvigado.geotrends.co/observatorio`, antes de `</body>`:

```html
<script
  src="https://<dominio-de-geobot>/embed/geobot-launcher.js"
  data-geobot-origin="https://<dominio-de-geobot>"
  data-gutter-right="16"
  data-gutter-bottom="16"
  async></script>
```

- `<dominio-de-geobot>`: origen HTTPS donde nginx sirve el frontend (`/embed/geobot-launcher.js` y `/chat`). Debe coincidir en ambos atributos.
- `data-gutter-*`: separación (px) respecto de los controles del mapa; ajustar durante la instalación **sin** tocar el CSS del portal ni el z-index del mapa.
- El script pesa 5 083 bytes (límite 10 000), no usa cookies/storage y no hace solicitudes a Geobot antes del primer clic; no recibe conversación ni contactos.

## Qué debe estar configurado en el servidor de Geobot

| Elemento | Valor |
| --- | --- |
| `Content-Security-Policy` de `/chat` | generada por `frontend/scripts/build-csp.mjs`: `frame-ancestors https://observatorioenvigado.geotrends.co` y hashes de scripts en línea; sin `X-Frame-Options` |
| `CHAT_ALLOWED_ORIGINS` (backend) | `https://observatorioenvigado.geotrends.co` |
| `NEXT_PUBLIC_OFFICIAL_CONTACT_URL` (build) | enlace HTTPS oficial de contacto del Municipio |
| `CONSENT_POLICY_VERSION` / `CONSENT_POLICY_URL` | los vigentes, aportados por la operación |

## Verificación posterior a la instalación (T078/T079)

1. Botón «Geobot» visible abajo a la derecha sin desplazar y sin tapar controles del mapa; mapa sin cambios de cámara/capas.
2. Red con caché vacía: antes del clic solo el script; tras el clic, `/chat` y sus recursos; los clics siguientes no recargan el iframe.
3. Origen exacto: la página oficial incrusta; un origen ajeno, un subdominio y `http://` quedan bloqueados (consola/`frame-ancestors`).
4. Assets después del clic: logo y fuentes solo tras la primera activación.

## Rollback

1. Retirar la etiqueta `<script>` del portal (el botón y el iframe desaparecen en la siguiente carga; no deja estado en el navegador).
2. Si fue necesario, revertir la imagen del frontend a la etiqueta anterior; el backend no cambia de contrato salvo `POST /api/ratings` (aditivo) y la migración `007_valoracion.sql` (aditiva, no destructiva).
3. No requiere purgar datos: el widget no persiste nada en el navegador.
