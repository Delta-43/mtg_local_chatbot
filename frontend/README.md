# MTG Judge PWA

React + Vite PWA frontend for the `mtg_local_chatbot` backend. Deploys as a
**separate target** from the rest of this repo (e.g. Vercel/Netlify) — it is
not built or served by `docker-compose`/Caddy; it calls the backend API
cross-origin.

## Setup

```bash
npm install
cp .env.example .env   # point VITE_API_BASE_URL at your backend
npm run dev
```

The backend must have `CORS_ALLOWED_ORIGINS` set to include this app's origin
(`http://localhost:5173` for `npm run dev`, plus whatever origin your deploy
host assigns) — see the root `CLAUDE.md`/`project_config.yml`.

## Notes

- Calls `/chat/stream` (SSE, via `fetch` + `ReadableStream` — not
  `EventSource`, since this needs a `POST` with a JSON body) for token-by-token
  responses, and persists the returned `conversation_id` in `localStorage` for
  multi-turn continuity.
- Sends **no `X-API-Key`** — a key baked into this bundle would be readable by
  anyone via devtools, so it isn't a real secret. The backend's anonymous tier
  (IP-based rate limit + a lower daily quota) is what protects this path.
- Service worker (via `vite-plugin-pwa`) only caches the static app shell;
  `/chat` and `/chat/stream` are explicitly excluded (`NetworkOnly`) — there is
  no meaningful offline chat, since the backend needs live calls to
  rules-mcp/scryfall-mcp/searxng.
- `public/icons/*.svg` are placeholder icons — swap them for real artwork
  before a real deploy.

## Build

```bash
npm run build   # outputs to dist/
```
