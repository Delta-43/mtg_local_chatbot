# TODO

Next steps and open considerations. `PLAN.md` has the completed/remaining
summary at the project level; this is the working list for what's actually next.

## Next up: PWA frontend (design via Claude Design)

The backend has no frontend today — it's an HTTP API only (see README's API
Endpoints section). Before handing this to Claude Design, it's worth being
explicit about what it's designing against and what it can't assume yet.

### Current API contract (what the frontend has to work with)

`POST /chat`
```json
// request
{ "query": "string", "conversation_id": "string | null (accepted, currently unused)" }
// response
{
  "answer": "string (markdown-ish prose from the LLM)",
  "sources": { "rules": ["string"], "rulings": ["string"], "web_links": ["string"] }
}
```
- Single blocking call — no streaming. The full answer comes back at once, not
  token-by-token.
- `conversation_id` is accepted by the API but not used server-side yet (see
  below) — sending it today has no effect.
- Auth: `X-API-Key` header, only enforced if `server.api_keys` is configured
  (empty by default = disabled). It's a flat shared-secret list, not per-user
  accounts.
- Rate limiting: `server.rate_limit_per_minute` (default 20), keyed by API key
  if present, else by IP.

`GET /health` — `{ status, provider, ready, mcp_servers: { rules_mcp, scryfall_mcp } }`

### Things to flag to Claude Design

- **Citations are structured, not inline** — `sources.rules` / `sources.rulings` /
  `sources.web_links` come back as separate arrays alongside the prose answer
  (the answer text also mentions them in a "Citations:" block, since that's
  enforced by the agent's system prompt — so there's some redundancy between
  the prose and the structured field to design around, not just a clean split).
- **No structured card data in the response** — even though scryfall-mcp
  returns structured card data (image URLs, mana cost, etc.) internally, the
  `/chat` response only surfaces the LLM's prose summary of it. A card-visual
  treatment (image, mana symbols) would mean either parsing card names back out
  of the answer text, or a backend change to surface structured card data
  alongside the prose — not currently available as-is.
- **Query latency varies a lot** — simple rules lookups answer in a few
  seconds; queries that trigger `web_search` took 6-8s in testing, and multiple
  tool calls in sequence compound. No progress signal exists mid-request (see
  streaming below) — needs a real "thinking" state design, not just a spinner
  sized for a 1-2s wait.
- **Error surface is thin** — agent failures currently collapse to a generic
  `"I ran into an error processing your question. Please try again."` string
  in the `answer` field (HTTP 200, not an error status). Auth failures are 401,
  rate limits are 429. Design needs to handle "the answer field says something
  went wrong" as its own case, not just HTTP-status-driven error states.

### Backend work needed to support the PWA (not started)

- [ ] **CORS**: `server.cors_allowed_origins` is empty (disabled) by default.
      Needs to be set to the actual frontend origin(s) before a browser-based
      frontend can call `/chat` cross-origin at all.
- [ ] **HTTPS/domain**: `Caddyfile` currently serves plain HTTP on `:80` for
      local/IP-only access. PWAs require HTTPS to be installable (localhost is
      exempt during dev, but a real deployment isn't) — needs a real domain and
      the Caddyfile domain block swapped in (already scaffolded, just commented
      out) before install-to-home-screen can be tested for real.
- [ ] **Streaming**: if the PWA wants a token-by-token "typing" UX, `/chat`
      needs to become a streaming endpoint (SSE or websocket). LangChain/LangGraph
      support streaming; `MTGJudgeAgent.query()` currently awaits the full
      `ainvoke()` result before returning, so this is a real code change, not
      just a frontend concern.
- [ ] **Conversation memory**: `conversation_id` is plumbed through the API but
      unused server-side. Needed if the PWA's UX is an actual chat thread
      (multi-turn, referring back to earlier questions) rather than one-shot
      Q&A per message.
- [ ] **PWA asset serving**: manifest.json, service worker, icons — none of
      this exists. Needs a decision (see below) on where it's built/served from.

### Open decisions (not yet answered)

- Where does the frontend live? A new directory with its own build + a
  `frontend` service in `docker-compose.yml`/behind Caddy, static files served
  directly by Caddy, or a separate deploy target entirely (e.g. a static host)?
- Is `X-API-Key` (flat shared secret) sufficient for a public-facing PWA, or
  does going public mean real user accounts / per-user rate limiting instead of
  per-key?
- Offline behavior: the app fundamentally needs live calls to rules-mcp/
  scryfall-mcp/searxng, so there's no meaningful "offline chat." A service
  worker caching the app shell/static assets (so the PWA installs and opens
  instantly) is realistic; caching chat functionality itself isn't.

## Also remaining (carried over from PLAN.md, unrelated to the frontend push)

- [ ] Discord bot / other chat-platform integration
- [ ] Incremental/upsert rules ingestion — a Comprehensive Rules update
      currently triggers a full re-embed of the whole collection
- [ ] Tool-calling reliability with smaller/local (non-cloud) models — known
      tradeoff of model choice, no fix planned
- [ ] SearXNG's outbound IP can get rate-limited by upstream search engines
      under sustained traffic — best-effort, no mitigation in place
