# TODO

Next steps and open considerations. `PLAN.md` has the completed/remaining
summary at the project level; this is the working list for what's actually next.

## Status: PWA + Discord backend push — built and verified against the live local stack

This session landed conversation memory, SSE streaming, a security/abuse
harness, and scaffolds for both the PWA (`frontend/`) and the Discord bot
(`discord_bot/`) — then deployed the full stack locally (`docker-compose up`,
real `gemma4:cloud` inference, real rules-mcp/scryfall-mcp/searxng) and
re-ran verification against it, not just a mocked agent. See `PLAN.md`'s
"PWA + Discord push" entry for the full list, including a real streaming bug
(raw tool output leaking into `/chat/stream`'s token frames) that this live
pass caught and fixed.

A real headless-browser click-through (Playwright/Chromium) confirmed the PWA
works end-to-end against the live backend and caught a real frontend bug: a
429 (daily quota hit) rendered as "Couldn't reach the judge" — the same
message as a genuine network failure. Fixed (`HttpError` in
`frontend/src/api/client.ts`, branched in `ChatWindow.tsx`) and re-verified
in-browser with the quota forced to 0. See `PLAN.md` for both this and the
earlier streaming bug found during the first live pass.

**Still not done**: actual deployment anywhere public. This session added the
plumbing for a specific plan (Cloudflare Tunnel to `oracle.delta43.net`, PWA
served same-origin by Caddy, R2 backup of `data/`) — see the sections below —
but none of it has run against a real Cloudflare account/tunnel/bucket yet,
only local builds and standalone smoke tests. The Discord bot is deliberately
deferred until the backend + PWA are actually live publicly, and has still
only been tested via its API-calling code path, not against a real Discord
gateway connection/token.

### Local deployment notes (this host specifically)

- This host already runs unrelated services on the ports this project
  defaults to (searxng 8080, scryfall-mcp 3000, Caddy 80/443) — a
  git-ignored `docker-compose.override.yml` remaps them (8081, 3001,
  8880/8843) and adds a direct `127.0.0.1:8000:8000` mapping on `mtg-judge`
  for curl testing without going through Caddy. Not needed on a host without
  those conflicts.
- The dedicated Ollama instance (port 11435, see `CLAUDE.md`) failed to start
  under this shell's ambient `OLLAMA_MODELS=/repos/ollama/models` (a path
  that doesn't exist/isn't writable here) — started it instead with
  `OLLAMA_MODELS="$HOME/.ollama/models" ./scripts/run_ollama.sh`. Worth
  checking for on any host where `setup.sh`'s model-pull step fails with
  "could not connect to ollama server."
- rules-mcp's HTTP server (and therefore `/health`) doesn't come up until
  first-boot ingestion finishes (~8-10 min) — `mtg-judge` will crash-loop
  against it until then. `restart: unless-stopped` recovers it automatically
  once rules-mcp is ready; this is expected, not a bug, but worth knowing
  before assuming something's broken on a fresh `docker-compose up`.

## Current API contract

`POST /chat`
```json
// request
{ "query": "string (max 2000 chars)", "conversation_id": "string | null" }
// response
{
  "answer": "string (markdown-ish prose from the LLM)",
  "sources": { "rules": ["string"], "rulings": ["string"], "web_links": ["string"] },
  "conversation_id": "string (always present -- server-generated if omitted in the request)"
}
```
- Still a single blocking call. Send the returned `conversation_id` back on
  the next request in the same thread for multi-turn memory; omit it to start
  a new conversation.

`POST /chat/stream` — same request body. `text/event-stream` response:
`event: token` (repeated, `{"text": "..."}`), one `event: sources`
(`{"rules": [...], ...}`), then `event: done` (`{"conversation_id": "..."}`)
— or `event: error` (`{"message": "..."}`) in place of the last two if the
run fails.

- **Auth is now tiered, not all-or-nothing.** No `X-API-Key` header =
  anonymous tier (allowed through, lower daily quota, keyed by IP). A
  presented key must be valid (`401` if not) = authenticated tier (higher
  daily quota, keyed by the key). This exists because a PWA can't keep a
  client-side key secret — see `frontend/src/api/client.ts`'s comment.
- Rate limiting: existing per-minute limit (`RATE_LIMIT_PER_MINUTE`,
  default 20) is unchanged, plus a new daily quota
  (`DAILY_QUOTA_ANONYMOUS`=30 / `DAILY_QUOTA_AUTHENTICATED`=500, both
  configurable) backed by a `usage_counters` table in the same SQLite file as
  conversation memory. Both return `429`.
- Error surface is still thin: agent failures collapse to an apologetic
  string in `answer` (blocking) or an `event: error` frame (streaming), both
  HTTP 200/well-formed-stream, not an error status. Frontend/bot clients
  handle this as a display-time check, not an HTTP-status branch.

`GET /health` — unchanged: `{ status, provider, ready, mcp_servers }`.

## Next up

### Verify against the live stack — done

- [x] Ran `docker-compose up` for real: two-turn memory test, container
      restart to confirm SQLite persistence, `/chat/stream` token-by-token
      output, CORS allow/deny, tiered-auth 401/200, daily quota 429 cutover,
      oversized/empty query rejection, and a direct jailbreak attempt against
      the real model (correctly refused).
- [ ] Not yet tested: `web_search`'s actual scraped-page content containing
      an embedded instruction (the jailbreak test used a direct user-message
      injection, not one smuggled through a tool result) — same mitigation,
      untested against that specific vector.

### PWA: from scaffold to deployed

- [x] Deploy target decided: **same-origin with the backend**, not a separate
      host — `frontend/Dockerfile` (new) multi-stage-builds the PWA and bakes
      it into the `caddy` image alongside the reverse proxy, so
      `oracle.delta43.net` serves both the UI and `/chat*`/`/health` with no
      CORS config needed for the primary deploy. `docker-compose.yml`'s
      `caddy` service now `build`s this instead of using the bare `caddy:2`
      image; `Caddyfile` rewritten to route `/chat*`/`/health` to `mtg-judge`
      and everything else to the static build (SPA fallback via
      `try_files`). Verified: image builds clean, `caddy validate` passes,
      and a standalone container smoke-test confirmed both static serving
      (200) and API routing (502-to-nowhere, correctly, since `mtg-judge`
      wasn't running in that isolated test) work.
- [x] Domain/TLS story resolved for the **Cloudflare Tunnel** path
      specifically (see "Public deployment" below) — no port needs to be
      opened, TLS terminates at Cloudflare's edge, `Caddyfile` deliberately
      stays on plain `:80`. The old commented-out Let's Encrypt domain block
      is kept as an alternative for anyone deploying without a tunnel
      (direct port 80/443 exposure).
- [x] `cloudflared` pointed at a real tunnel token and brought up
      (`docker-compose --profile tunnel up -d`) against this host's actual
      running stack (not a mock) — connector authenticated, 4 edge
      connections registered, connectivity pre-checks all passed. Also
      rebuilt+recreated `mtg-caddy` with the new frontend-serving image and
      confirmed against the live backend: PWA index (200), SPA fallback on
      an unknown deep link (200), `/health` proxied through to a real
      healthy `mtg-judge` (`rules_mcp`/`scryfall_mcp` both `true`).
- [x] Found a real host-specific gotcha this way: `nginx_proxy_manager`
      (unrelated, pre-existing) owns this host's actual public `80`/`443`,
      so `docker-compose.override.yml` remaps `caddy` to
      `127.0.0.1:8880`/`8843` — the tunnel's public hostname has to target
      `http://localhost:8880`, not `:80`, on this host. README's Cloudflare
      Tunnel section now calls this out generically (check `docker port
      mtg-caddy`).
- [ ] **Blocked on the Cloudflare dashboard, not this repo**:
      `oracle.delta43.net` doesn't resolve yet (`getent hosts
      oracle.delta43.net` — no answer; general DNS resolution otherwise
      works fine from this host). The tunnel connector itself is live and
      authenticated, so this is the public-hostname/DNS step in the Zero
      Trust dashboard (Networks → Tunnels → your tunnel → Public Hostname)
      — add `oracle.delta43.net` there pointed at `http://localhost:8880`,
      which also auto-creates the CNAME DNS record.
- [ ] Real icons/branding — `frontend/public/icons/*.svg` are still
      placeholder "M" glyphs. Next up: a Claude-Design pass on the frontend
      generally (icons, chat UI polish), per your stated plan.
- [ ] Decide whether anonymous-tier abuse ever becomes real enough to justify
      a CAPTCHA/Turnstile challenge or session tokens (deferred by design this
      pass — see `PLAN.md`'s security section).

### R2 backup (new this session)

- [x] `scripts/backup_to_r2.py` — snapshots `data/conversations/conversations.db`
      and `data/chroma/` to an R2 bucket (S3-compatible API via `boto3`); a
      single overwritten "latest" snapshot, not versioned history. No-ops
      with a log line (exit 0) if `R2_*` env vars aren't set, so it's safe to
      leave the `backup` compose profile out entirely.
- [x] `r2-backup` docker-compose service, gated behind `--profile backup`,
      loops on `R2_BACKUP_INTERVAL_SECONDS` (default 3600).
- [ ] Not yet done: an actual R2 bucket/API token exists to test against, and
      there's no restore path yet (would mean downloading objects back into
      `data/` by hand — fine for now, but worth a real script if this gets
      relied on).

### Discord bot: deliberately deferred

Decided this session: **get the backend + PWA live on oracle.delta43.net
first**, then come back to the Discord bot once there's a stable public API
URL for it to call (rather than an internal service name). Still needed when
that happens:

- [ ] Register a real Discord application/bot token, invite it to a server
      with the `applications.commands` scope.
- [ ] Issue it a dedicated entry in the backend's `API_KEYS` (not shared with
      anything else, so its daily quota is tracked independently).
- [ ] Decide on `discord_bot/bot_config.yml`'s `allowed_guild_ids` (empty =
      any server it's invited to) and `cooldown_seconds` for real usage.
- [ ] Wire a `discord-bot` docker-compose service pointed at the public
      `oracle.delta43.net` URL (not an internal service name).

## Also remaining (carried over from PLAN.md, unrelated to this push)

- [ ] Incremental/upsert rules ingestion — a Comprehensive Rules update
      currently triggers a full re-embed of the whole collection
- [ ] Tool-calling reliability with smaller/local (non-cloud) models — known
      tradeoff of model choice, no fix planned
- [ ] SearXNG's outbound IP can get rate-limited by upstream search engines
      under sustained traffic — best-effort, no mitigation in place
