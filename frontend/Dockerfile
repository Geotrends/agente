# Frontend de Geobot.
#
# La página es 100 % cliente ("use client"), así que se exporta como estáticos
# y la sirve nginx: sin servidor de Node en producción. nginx además hace de
# proxy de /api hacia el backend, de modo que navegador y API comparten origen
# y no hace falta configurar CORS ni la URL del backend en ningún lado.

FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# Enlace oficial de contacto (HTTPS) para el caso en que los contactos no carguen; sin valor por defecto.
ARG NEXT_PUBLIC_OFFICIAL_CONTACT_URL=""
ENV NEXT_PUBLIC_OFFICIAL_CONTACT_URL=$NEXT_PUBLIC_OFFICIAL_CONTACT_URL
# Ruta relativa: el navegador llama al mismo host que le sirvió la página.
ENV NEXT_TELEMETRY_DISABLED=1 \
    NEXT_OUTPUT=export \
    NEXT_PUBLIC_AGENT_API_URL=/api/chat
RUN npm run build:widget && npm run build && node scripts/build-csp.mjs --out out --target csp-chat.conf

# Variante oficial de nginx que corre sin root y escucha en 8080.
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/out /usr/share/nginx/html
COPY --from=build /app/csp-chat.conf /etc/nginx/snippets/csp-chat.conf

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
