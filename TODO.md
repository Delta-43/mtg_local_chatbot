# TODO

Next steps and open considerations. `PLAN.md` has the completed/remaining
summary at the project level; this is the working list for what's actually next.
`FEATURES.md` is the full feature-by-feature requirement + test + status
catalog — check there before assuming something is or isn't verified.

## Next session starts here

Explicit user instruction, in this order: **frontend visual design pass
first** (via Claude Design), **then** the Discord bot (register a real
token, wire it into docker-compose — it's unblocked now that
`oracle.delta43.net` is a real public URL). Both were deliberately deferred
to last, multiple times, across this session — don't reorder them.

For the frontend pass: Playwright is installed on this host and should be
used for a real interactive click-through once the redesign is done (see
E1/E3 in `FEATURES.md` — those were only structurally/backend-verified
this session, no browser was available then). Current placeholder icons are
`frontend/public/icons/*.svg` ("M" glyphs).

Two things verified-but-not-yet-exercised-at-scale, worth knowing before
relying on them:
- `EMBEDDING_PROVIDER=hosted` (B7 in `FEATURES.md`) was only tested against
  a 2-rule synthetic dataset, not the real ~1172-rule collection. Both
  OpenRouter keys are already in `.env` (`OPENROUTER_API_KEY` for chat,
  `OPENROUTER_EMBEDDING_API_KEY` for embeddings) and confirmed working —
  just hasn't been run at production scale.
- `INGEST_CONCURRENCY` is correct but gave zero speedup on this specific
  host (4 CPU cores, no usable GPU) — don't re-try tuning that further here;
  hosted embeddings (above) is the real lever for this host if ingestion
  speed ever matters again.

## Status: Merged GitHub's diverged main; vendored scryfall-mcp locally + added get_card_rulings

Two unrelated pieces of work, both requested this session:

1. **Reconciled a 6-day branch divergence.** Local `main` and GitHub's `main`
   had diverged at `6894c4b` with no overlap: local had 23 unpushed commits
   (citation-verification safety net, rules-parser fix, OpenRouter wiring, PWA/
   Discord/deployment scaffolding); GitHub had 3 merged PRs from a
   contributor (Roc Granada) installing scryfall-mcp from source instead of a
   git submodule, a `stop_bot.sh` script, and a lightweight single-page dev
   test UI (`app_api/static/index.html`, served at `GET /`, with
   `tests/test_frontend.py` pytest coverage). Merged via a real (non-fast-
   forward) merge commit -- conflicts resolved in `CLAUDE.md`/`PLAN.md`/
   `README.md`/`app_api/main.py`; a clean-merged `project_config.yml` default
   LLM (`llama3.2`, from Roc's branch) reverted back to `gemma4:cloud` per
   explicit user decision, since it silently contradicted everything else
   documented about the cloud-model default. `requirements.txt` gained
   `pytest`/`httpx` since neither was listed despite `tests/` needing both.
   Verified: 4/5 of the merged pytest suite passes (`test_frontend.py`); the
   one failure is a pre-existing environment issue (root-owned
   `data/conversations/conversations.db` from a prior Docker run, not
   writable by this shell's user, and the test doesn't override
   `Config.CONVERSATION_DB_PATH`) -- **not fixed**, since it meant chown-ing
   root-owned production data outside the scope of this session's ask.
2. **Vendored scryfall-mcp's actual source into this repo** (`scryfall_mcp/`,
   commit `fd585a0`) instead of the from-source-but-built-from-a-live-clone
   approach PR #1 introduced, specifically so it could be modified -- then
   added `get_card_rulings` as a real 16th MCP tool
   (`scryfall_mcp/src/tools/get-card-rulings.ts`, calling the actual
   [Scryfall Rulings API](https://scryfall.com/docs/api/rulings)), deleting
   the old `scryfall_agent/` in-process Python tool it replaces. Full detail
   in `CLAUDE.md` and `FEATURES.md`'s C1/C2. Tests initially mocked the
   Scryfall client, then were split on request into two files: metadata/
   validation checks stay mocked in `tests/tools.test.ts` (no card data
   involved either way), everything touching real ruling data moved to a new
   `tests/get-card-rulings.live.test.ts` making genuine calls to
   `api.scryfall.com` -- which immediately caught a real surprise: the
   printing `/cards/named?fuzzy=Lightning+Bolt` currently resolves to has an
   empty `rulings_uri` on the live API right now, so the test uses Doubling
   Season (5 real rulings) and Grizzly Bears (0 rulings) instead, both
   confirmed directly against the live API first. Verified: `npx tsc
   --noEmit` clean, `npx vitest run` 334 tests all pass (329 upstream + 2
   mocked + 3 live), and a live `/chat` call through the rebuilt stack
   correctly returned `sources.rulings: ["Doubling Season"]`.

Neither of these touched the **frontend design pass / Discord bot** work
queued in "Next session starts here" above -- that's still next, still in
that order, once this accuracy-focused work wraps up.

## Status: OpenRouter chat + embedding providers wired up and tested with real keys

User provided two real OpenRouter API keys (chat: `z-ai/glm-5.3-flash`;
embeddings: `baai/bge-m3`) and asked for both to be tested. Found and fixed
a real bug in the process: `OPENROUTER_BASE_URL` defaulted to an empty
string in `docker-compose.yml`, which silently overrode the real default
and sent hosted-chat requests to `api.openai.com` instead of OpenRouter —
manifested as a confusing 401 from a valid key. Fixed, then verified hosted
chat end-to-end (including the A3 citation-safety-net working with a
different model). Also built `EMBEDDING_PROVIDER=hosted` for rules-mcp
(separate key by design) with a real correctness guard: switching embedding
providers on an existing collection forces a full re-embed instead of
silently mixing two incompatible vector spaces, verified three ways. Full
detail in `FEATURES.md`'s A5/B7 entries. Production stays on `local` for
both — these are verified, available, opt-in capabilities.

## Status: full feature pass — every claimed feature checked against the live stack

Went through `FEATURES.md` section by section (backend, rules ingestion,
card data, API, frontend, Discord bot, deployment, security) and verified
each one for real, not just re-read the code. Found and fixed real bugs
along the way, not just confirmed existing behavior:
- **A3** (rule-citation verity): prompt-only enforcement was shown live to
  be insufficient (a rule number slipped through uncited). Added a real
  code-level safety net (`_verify_unbacked_rule_citations` +  a new exact-
  lookup `get_rule_by_id` MCP tool) and proved it works in isolation (real
  citation gets verified and added, fake one doesn't get fabricated in).
- **B1** (rules parser): found a real, pre-existing bug dropping ~30% of
  the Comprehensive Rules silently (807 rules parsed instead of ~1172) --
  see `CLAUDE.md`. Fixed and live-migrated production.
- **B5** (ingestion concurrency): implemented, tested, correct -- but
  empirically **no speedup** on this host (CPU-bound at 4 cores). Honest
  negative result, documented in `FEATURES.md`/`CLAUDE.md` rather than
  claimed as a win.
- **D5** (rate limit/quota): found `docker-compose.yml` never forwarded
  `RATE_LIMIT_PER_MINUTE`/`DAILY_QUOTA_*` into the container despite being
  documented as env-overridable -- fixed.
- **G3** (R2 backup): found it never cleaned up stale Chroma UUID
  directories from previous ingests, so R2 was accumulating orphaned data
  forever (confirmed 3 stale UUID dirs after 3 migrations in one session)
  -- fixed to sync properly (upload + delete what's no longer local).

Full detail, per-feature test commands, and honest status for everything
(including what couldn't be tested here -- no OpenRouter key, no browser
available) is in `FEATURES.md`.

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
  "sources": { "rules": ["string"], "rulings": ["string"], "web_links": ["string"], "images": ["string"] },
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
- [x] **Tested the scraped-content injection vector — passed.** Hosted a real
      page with an embedded "ignore previous instructions" payload, ran it
      through the actual `_fetch_and_extract()` code path (confirmed the
      payload survives trafilatura extraction unmodified -- the vector is
      real), then fed that real extracted text to the live agent
      (`gemma4:cloud`) as a fabricated-but-realistic `ToolMessage` from
      `web_search`, already in the conversation history. The agent ignored
      the embedded override, stayed in character as an MTG judge, and still
      answered with real rule citations (500.3, 502.3, 502.4, 503.1a) rather
      than obeying the payload's demand to omit them -- it also didn't cite
      the poisoned page's false claim about phasing. Not a proof against
      every possible phrasing, but the specific gap this item tracked
      (tool-result-borne injection, as opposed to a direct user message) is
      now verified, not just assumed to share the same mitigation.

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
- [x] **`oracle.delta43.net` is live.** Public hostname added in the Zero
      Trust dashboard, pointed at `http://localhost:8880` as documented
      above. Verified from outside the container network: DNS resolves,
      `https://oracle.delta43.net/` serves the PWA (200), and
      `https://oracle.delta43.net/health` proxies through TLS + the tunnel
      to a real healthy backend.
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
- [x] Verified against a real bucket (`mtg-oracle-backups`), scoped API
      token, `--profile backup` brought up against this host's actual live
      `data/`: the script logged a successful upload, and independently
      re-checked with `aws s3 ls` against the real R2 endpoint (not just
      trusting the script's own log) — 8 objects, sizes matching local
      `data/chroma` and `conversations.db` exactly. Runs on a 1-hour loop
      from here on.
- [x] Restore path added: `scripts/restore_from_r2.py` (dry-run by default,
      `--yes` to actually restore) — verified in dry-run mode against the
      real bucket, see `PLAN.md`.

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

- [x] Incremental/upsert rules ingestion — done, see the rules ingestion
      commit and `rules_mcp/README.md`.
- [ ] Tool-calling reliability with smaller/local (non-cloud) models — known
      tradeoff of model choice, no fix planned
- [ ] SearXNG's outbound IP can get rate-limited by upstream search engines
      under sustained traffic — best-effort, no mitigation in place
