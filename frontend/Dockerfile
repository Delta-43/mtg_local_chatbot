# Production image for the PWA: build the static bundle, then serve it from
# the same Caddy instance that reverse-proxies the API -- one container, one
# domain, no separate frontend host/CORS setup needed. (Local dev still uses
# `npm run dev` / Vite directly, not this image -- see frontend/README.md.)
# Build context is the repo root (see docker-compose.yml's `caddy` service)
# so this stage can also pick up the root Caddyfile below.
FROM node:20-alpine AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ .
# Same-origin deploy: Caddy serves both the built PWA and /chat* on one
# domain, so the API base is relative ("") rather than a cross-origin URL.
# Override at build time (--build-arg VITE_API_BASE_URL=https://...) if the
# frontend is ever split onto a different origin than the backend.
ARG VITE_API_BASE_URL=""
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

FROM caddy:2
COPY --from=build /app/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile
