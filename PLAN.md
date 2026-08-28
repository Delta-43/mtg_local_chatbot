# Project Plan

## Vision

An AI Magic: The Gathering rules judge: answer rules questions and card-specific
interactions accurately, grounded in the official Comprehensive Rules and Scryfall
card data, with citations required in every answer — not a chatbot that answers
from memory. Exposed over HTTP so it can sit behind other surfaces (web UI, bot
integrations) later, run either fully local or hosted publicly.

Originally scoped as a RAG pipeline over a local LLM (small enough for an old
i5-4590 / low-VRAM box) plus a Scryfall lookup tool. That fixed
classify-then-branch pipeline was rearchitected into a real tool-calling agent
(the agent decides which tools to call, not a hand-coded router), and the
deployment scripts/config were leaned out afterward to match — see `CLAUDE.md`
and `Description.md` for the resulting architecture.

## Completed

**Core agent**
- [x] Tool-calling agent (LangChain 1.x `create_agent`) replacing the fixed
      classify-then-branch pipeline
- [x] Pluggable LLM provider: local/cloud Ollama or hosted OpenRouter
- [x] Citation-required system prompt; structured `sources` (`rules`, `rulings`,
      `web_links`) parsed from actual tool-call history, not hand-set flags

**Rules retrieval**
- [x] `rules_mcp/`: standalone, self-contained MCP server — rules PDF
      acquisition, hierarchical parsing, ChromaDB ingestion, `search_rules` tool
- [x] Auto-refresh from wizards.com on boot, with a re-ingest guard (marker
      file) so a container restart doesn't re-embed and duplicate the collection

**Card data**
- [x] Card data delegated to a vendored, actively-maintained Scryfall MCP server
      (15 tools) instead of a bespoke wrapper
- [x] `get_card_rulings`: the one gap in the vendored server's tool set

**Contested/ambiguous rulings**
- [x] Self-hosted SearXNG + content extraction (`web_search`), used only when
      rules/rulings tools don't resolve the question

**API & deployment**
- [x] FastAPI with CORS, `X-API-Key` auth, per-key/IP rate limiting
- [x] Docker Compose: `mtg-judge`, `rules-mcp`, `scryfall-mcp`, `searxng`, Caddy
      (reverse proxy / automatic TLS)
- [x] Hybrid dev workflow (`run_bot.sh`): Dockerized supporting services + host-run
      backend for fast iteration

**This session's hardening pass**
- [x] Fixed rules-mcp ingestion (bind-mount `rmtree` failure, chromadb
      readonly-database state, both traced to actually running the stack)
- [x] Fixed citation parsing for MCP-sourced tool messages (content-block list vs.
      plain string)
- [x] Consistent `SCRYFALL_USER_AGENT` across both Scryfall code paths
- [x] Removed redundant/dead code: `scripts/config_to_env.py`, unused
      `python-dotenv`, stale planning doc, obsolete `docker-compose` `version` key
- [x] Collapsed CPU/GPU dual-mode scripts into one path; default model switched to
      `gemma4:cloud` (reliable tool-calling, no local GPU/CPU inference needed)
- [x] Verified end-to-end through the actual containerized stack, not just the
      host-run dev path
- [x] Repo cleanup: single `main` branch, stale prototype branches removed

**PWA + Discord push** (this session — see `TODO.md` for what's still open)
- [x] Multi-turn conversation memory: SQLite-backed LangGraph checkpointer
      (`AsyncSqliteSaver`), keyed by `conversation_id` (now returned by
      `/chat` and `/chat/stream`, generated server-side when omitted)
- [x] SSE streaming: new `POST /chat/stream` (`/chat` unchanged, kept as the
      blocking JSON endpoint) — `event: token`/`sources`/`done`/`error` frames
- [x] Security/abuse-prevention harness: prompt-injection-hardened system
      prompt (tool output treated as untrusted data), `query` length cap
      (2000 chars), tiered auth (`X-API-Key` now optional — anonymous
      keyless tier for a public frontend that can't keep a key secret, vs.
      an authenticated tier for trusted server-side callers), and a
      SQLite-backed daily quota per tier on top of the existing per-minute
      rate limit
- [x] PWA scaffold (`frontend/`): React + Vite + `vite-plugin-pwa`, SSE chat
      UI, `conversation_id` persisted client-side — builds and typechecks
      clean; deploys as a separate target (e.g. Vercel), not part of
      docker-compose/Caddy
- [x] Discord bot scaffold (`discord_bot/`): thin `discord.py` client, `/judge`
      slash command, per-channel conversation threading, per-user cooldown,
      optional guild allowlist — calls the existing `/chat` API rather than
      importing agent internals; verified importable/runnable standalone
- [x] Verified backend changes end-to-end against a mocked agent (memory
      threading, tiered auth, quota enforcement, SSE framing, input
      validation), then again against the **full live local stack**
      (real `gemma4:cloud` inference, real rules-mcp/scryfall-mcp/searxng):
      two-turn memory, memory surviving a full container restart, live daily
      quota cutover, CORS allow/deny, and the prompt-injection guard actually
      refusing a jailbreak attempt against a real model. Also ran the PWA's
      actual shipped client code (`frontend/src/api/client.ts`, esbuild-bundled
      and executed in Node against Fetch/ReadableStream, same APIs a browser
      uses) and the Discord bot's actual `api_client.chat()`/`bot.py` helpers
      against the live backend — both worked end-to-end, including per-channel
      conversation continuity. Full in-browser click-through wasn't possible in
      this sandbox (no root to install Chromium's system libs), so this is
      real-code-against-real-backend verification, not a manual UI click-through.
- [x] **Found and fixed a real streaming bug during this live test**:
      `stream_tokens()`'s `stream_mode="messages"` emits every message-shaped
      chunk in the graph, not just AI token deltas — full `ToolMessage`
      objects (raw `search_rules` output, sometimes from more than one tool
      call) were flowing through as `event: token` frames ahead of the actual
      answer. Fixed by filtering to `isinstance(token_msg, AIMessageChunk)`
      in `llm_agent/agent.py`. Caught precisely because this was tested
      against a real multi-tool-call query, not a mock.
- [x] Ran a real headless-browser (Playwright/Chromium) click-through of the
      PWA against the live backend once a browser became available in this
      environment: page load, submit, thinking indicator, token-by-token
      render, sources panel expand, `conversation_id` persisted to
      `localStorage`, a genuine multi-turn follow-up answered correctly, and
      "New chat" clearing both the transcript and the stored id. Zero console
      errors on the happy path.
- [x] **Found and fixed a real frontend UX bug via that same browser test**:
      hitting the anonymous daily quota (a real 429, not simulated) rendered
      as "Couldn't reach the judge" — the same generic message as an actual
      network failure. Added `HttpError` (carries the HTTP status) in
      `frontend/src/api/client.ts` and branched on `status === 429` in
      `ChatWindow.tsx` to show "You've hit the request limit for now..."
      instead. Re-verified in-browser with the quota forced to 0.

**Public deployment push** (this session — targets `oracle.delta43.net` via
Cloudflare Tunnel; see `TODO.md` for full detail)
- [x] PWA moved from "separate deploy target" to same-origin with the
      backend: `frontend/Dockerfile` (new, multi-stage) builds the PWA and
      bakes it into the `caddy` image; `docker-compose.yml`'s `caddy` service
      now builds this instead of pulling the bare `caddy:2` image
- [x] `Caddyfile` rewritten to route `/chat*`/`/health` to `mtg-judge` and
      everything else to the static build (SPA fallback), and to stay on
      plain `:80` by design — TLS terminates at Cloudflare's edge via the
      tunnel, not at Caddy. The old direct-domain Let's Encrypt block is
      kept, commented, as an alternative for non-tunnel deploys.
- [x] `cloudflared` added to `docker-compose.yml` as an opt-in service
      (`--profile tunnel`), driven by `CLOUDFLARE_TUNNEL_TOKEN`
- [x] `scripts/backup_to_r2.py` + `r2-backup` compose service (opt-in,
      `--profile backup`): snapshots conversation memory + the rules Chroma
      index to a Cloudflare R2 bucket (S3-compatible API via `boto3`) on an
      interval, so state survives a VPS rebuild
- [x] Both new services deliberately **not** `docker-compose up`-required —
      compose profiles keep them out of the default path entirely, and (a real
      bug caught while building this) their env vars use `:-` defaults rather
      than `:?`-required, since compose interpolates every service's env
      block at parse time regardless of which `--profile` flags are passed —
      a hard requirement there would have broken plain `docker-compose up`
      for everyone not using these profiles
- [x] Verified locally: `docker compose config` parses clean with and without
      `--profile tunnel --profile backup`; the `caddy` image builds for real
      (`npm ci && tsc -b && vite build` inside the multi-stage build) and
      `caddy validate` passes; a standalone container smoke-test confirmed
      static serving (200), SPA fallback (200 on an unknown deep link), and
      API-path routing (502-to-nowhere, correctly, with `mtg-judge` absent
      from that isolated test)
- [x] `CLOUDFLARE_TUNNEL_TOKEN` wired to a real tunnel and brought up against
      this host's actual live stack: connector authenticated, 4 edge
      connections registered, `mtg-caddy` rebuilt with the new frontend image
      and confirmed serving the PWA + proxying to a real healthy backend.
      Found and documented a real host-specific gotcha in the process: a
      pre-existing `nginx_proxy_manager` on this host owns the real public
      `80`/`443`, so the tunnel's ingress target is `http://localhost:8880`
      here, not `:80` — see `TODO.md`.
- [x] **`oracle.delta43.net` is live**: public hostname added in the Zero
      Trust dashboard pointed at `http://localhost:8880`; verified from
      outside the container network — DNS resolves, `/` serves the PWA
      (200), `/health` proxies through TLS + the tunnel to a real healthy
      backend.
- [x] **R2 backup verified against a real bucket** (`mtg-oracle-backups`,
      scoped API token): `--profile backup` brought up against this host's
      actual live `data/`, script logged success, independently re-checked
      with `aws s3 ls` against the real R2 endpoint — 8 objects, sizes
      matching local `data/chroma` + `conversations.db` exactly. Now running
      on a 1-hour loop.
- [ ] Frontend visual design pass (icons/branding still placeholder "M"
      glyphs) — planned via Claude Design, not started

**Product surfaces**
- [x] Web UI — scaffolded (`frontend/`), deploy path now decided
      (same-origin via Caddy, see above), not yet live
- [x] Discord bot — scaffolded (`discord_bot/`), **deliberately deferred**
      until the backend + PWA are live publicly (decided this session — see
      `TODO.md`)

**Deployment**
- [ ] Discord bot docker-compose service — deferred until there's a public
      API URL for it to call instead of an internal service name

**Rules ingestion**
- [ ] Incremental/upsert ingestion — a real Comprehensive Rules update currently
      triggers a full re-embed of the whole collection, not just changed rules

**Reliability**
- [ ] Tool-calling reliability with smaller/local (non-cloud) models is
      inconsistent — they're more prone to skipping tools they should use and
      answering from memory instead. No fix planned; documented as a known
      tradeoff of model choice.
- [ ] SearXNG's outbound IP can get rate-limited by upstream search engines
      (Reddit, and over time Google/Bing) under sustained traffic — best-effort,
      no mitigation in place.

**Security (deferred, out of scope for this pass — see PLAN's harness above)**
- [ ] Full jailbreak-proofing — not solvable via system prompt alone; the
      injection-hardening added this session is mitigation, not a guarantee
- [ ] CAPTCHA/Turnstile or session-token issuance for the PWA's anonymous
      tier — revisit only if anonymous-tier abuse actually materializes
- [ ] WAF/bot-scraper blocking at the Caddy layer — not needed at current scale
