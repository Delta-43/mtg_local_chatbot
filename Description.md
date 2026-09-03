# MTG Judge Chatbot — Full Project Description

This document explains the current architecture of the MTG Judge Chatbot: a
tool-calling agent (not a fixed classify-then-branch pipeline), composed from a
standalone rules-search MCP server, a Scryfall MCP server (which also serves
official card rulings), and a self-hosted web-search tool — with a pluggable
LLM backend so the same code runs locally or served publicly.

---

## 1. What the project does

The MTG Judge Chatbot is an AI assistant for **Magic: The Gathering** rules
questions. At answer time, a tool-calling agent decides for itself which of the
following to consult, in what order:

1. Official Comprehensive Rules content, retrieved semantically from a local
   ChromaDB index (via `rules-mcp`).
2. Live Scryfall card data — oracle text, legality, pricing, sets, deckbuilding
   helpers — via the `scryfall-mcp` server.
3. Official Scryfall rulings for a specific card, via `scryfall-mcp`'s
   `get_card_rulings` tool (added locally -- the one gap in upstream's tool
   set; see section 5.4).
4. Public web search (self-hosted SearXNG + content extraction), used only for
   interactions that are ambiguous, contested, or not resolved by 1-3.
5. A pluggable LLM (Ollama — local weights or an Ollama cloud model — or a
   hosted model via OpenRouter) that reasons over the tool results and produces
   the final, cited answer.

The service is exposed over HTTP with FastAPI (CORS, API-key auth, rate limiting),
so it can sit behind a web UI, a bot, or be reused directly by other
implementations.

### Design goals

| Goal | How it is met |
|---|---|
| Grounded, cited answers | Agent's system prompt requires a citation block (rule numbers, rulings, source URLs); never answer from memory alone |
| Runs local-first or public | Pluggable LLM provider (Ollama, local or cloud, vs. hosted OpenRouter); no code path assumes local-only |
| Don't duplicate existing OSS | Card data delegated to a local fork of an actively maintained Scryfall MCP server instead of a bespoke wrapper; only the one gap in its tool set (rulings) was added locally |
| Rules retrieval is a reusable asset | `rules_mcp/` is self-contained (no imports from the rest of this repo) so it can be lifted into its own repo |
| Reproducible, self-hosted deployment | docker-compose with a Caddy reverse proxy for TLS |

---

## 2. Current architecture

Two operational phases:

1. Offline preparation (owned entirely by `rules-mcp`, runs automatically on
   container boot):
   1. Download and parse the MTG rules PDF into hierarchical JSON.
   2. Chunk and embed the parsed rules into ChromaDB.

2. Online serving:
   1. Accept a chat query.
   2. The agent decides which tool(s) to call — `search_rules`, one or more of
      `scryfall-mcp`'s 16 tools (including `get_card_rulings`), and/or
      `web_search` — and can call more than one, in sequence, based on what
      earlier results return.
   3. The agent produces a final answer with a required citation block, built
      from the tool calls it actually made (not a hand-set flag).

### Logical flow

```text
Client -> Caddy -> FastAPI (app_api/main.py)
                 -> tool-calling agent (llm_agent/agent.py)
                    |-- rules-mcp (MCP, HTTP): search_rules
                    |-- scryfall-mcp (MCP, HTTP): search_cards, get_card, get_card_rulings, ...
                    `-- web_search (in-process @tool: SearXNG + trafilatura)
```

---

## 3. Component layout

- `app_api`: FastAPI app lifecycle, HTTP endpoints, CORS, API-key auth, rate
  limiting, and an aggregate health check across the MCP servers.
- `llm_agent`: the tool-calling agent (`agent.py`), the pluggable LLM factory
  (`llm_provider.py`), and the `web_search` tool (`web_search_tool.py`).
- `rules_mcp`: standalone MCP server — rules PDF acquisition, hierarchical
  parsing, ChromaDB ingestion, and the `search_rules` tool. Self-contained; see
  its own [README](rules_mcp/README.md).
- `scryfall_mcp`: a local fork of
  [bmurdock/scryfall-mcp](https://github.com/bmurdock/scryfall-mcp) (MIT),
  vendored directly into this repo (not a submodule, not built from a live
  remote clone) so it can be modified -- which it has been, to add
  `get_card_rulings` as a 16th native tool (see section 5.4).
- `searxng`: config for a self-hosted metasearch instance backing `web_search`.
- `core_config`: canonical configuration loader for the main backend (YAML-first,
  env-override). `rules_mcp` deliberately does **not** use this — it has its own
  minimal env-var-only settings module so it stays independently portable.
- `scripts`: the Ollama launcher and Docker entrypoint.

Runtime data lives under `data/`, owned by `rules-mcp`:

- `data/pdf_parser`: rules PDF + parsed JSON artifacts.
- `data/chroma`: persisted vector index.

---

## 4. Configuration model

Configuration is **YAML-first** using `project_config.yml` for the main backend,
with environment variables overriding YAML values.

- `llm_provider`: `provider` (`local`/`hosted`), `openrouter_model`,
  `openrouter_base_url` (key itself is env-only: `OPENROUTER_API_KEY`).
- `mcp`: `rules_url`, `scryfall_url`.
- `web_search`: `searxng_url`, `max_results`, `fetch_top_n`.
- `server`: `host`/`port`, `cors_allowed_origins`, `api_keys`,
  `rate_limit_per_minute`.

`rules_mcp` is configured entirely via its own environment variables (no YAML) —
see its README — since it's meant to be extractable as an independent project.

Key implementation files:

- `core_config/settings.py`: main backend's config resolution and typed coercion
  (reads `project_config.yml` directly, with env vars overriding YAML values --
  no separate export step, in or out of Docker).
- `rules_mcp/settings.py`: rules-mcp's independent, env-var-only settings.
- `project_config.yml`: canonical main-backend settings.
- `scripts/docker_entrypoint.sh`: main backend's container startup bootstrap --
  just resolves `HOST`/`PORT` via `core_config.Config` and execs uvicorn.

---

## 5. Main modules

### 5.1 API surface (`app_api/main.py`)

- `GET /health`: reports LLM provider, agent readiness, and whether `rules-mcp`
  and `scryfall-mcp` are reachable.
- `POST /chat`: judge response endpoint — async end-to-end, rate-limited, and
  gated by `X-API-Key` when `API_KEYS` is configured.
- Lifespan startup builds the agent once (constructs the MCP client, loads tools,
  builds the chat model) and fails fast if `LLM_PROVIDER=hosted` without an API key.

### 5.2 Tool-calling agent (`llm_agent/agent.py`)

- Builds the LLM via `llm_provider.build_chat_model()` (local/cloud Ollama, or
  hosted OpenRouter).
- Loads MCP tools from `rules-mcp` and `scryfall-mcp` via `langchain-mcp-adapters`'
  `MultiServerMCPClient`, and adds `get_card_rulings` and `web_search` in-process.
- Wires everything into a `langchain.agents.create_agent` tool-calling graph with a
  system prompt that requires tool-grounded answers and a citation block.
- Parses the agent's tool-call history back into a structured `sources` object
  (`rules`, `rulings`, `web_links`) for the API response, instead of hand-set
  flags. MCP-sourced tool messages carry content as a list of content blocks
  (not a plain string, unlike the in-process `@tool`s) -- this is unwrapped
  before the citation regexes run against it.

### 5.3 Rules MCP server (`rules_mcp/`)

- `parser.py`: finds/downloads the latest rules PDF (with fallback URL support),
  parses chapter/section/rule/subrule hierarchy into JSON.
- `ingestor.py`: chunks and embeds the parsed rules into ChromaDB. A `recreate=True`
  rebuild clears the persist directory's *contents* rather than removing the
  directory itself (it's a Docker bind-mount point; removing it raises "Device or
  resource busy"), and writes an `.ingest_complete` marker file on success.
- `server.py`: exposes `search_rules` as an MCP tool over Streamable HTTP, plus a
  `/health` route; re-ingests automatically on boot only when the rules PDF
  changed or the marker file is missing (avoids re-embedding — and duplicating —
  the whole collection on every container restart). The "is it already ingested"
  check is a plain file-existence check, not a Chroma query: chromadb caches
  system state per persist-directory path within a process, so a throwaway
  client opened just to read a count would leave the *next* client (the one
  `ingest()` itself opens, after a `recreate=True` wipe) stuck against stale
  state, failing writes with "attempt to write a readonly database".

### 5.4 Scryfall tools

- `scryfall_mcp`: a local fork of upstream's server -- search, card lookup,
  pricing, sets, deckbuilding, synergy, format-staples, and more, 15 tools
  total, unmodified from upstream.
- `scryfall_mcp/src/tools/get-card-rulings.ts`: the 16th tool, added locally.
  Resolves a card the same way `get_card` does (name, set/collector-number, or
  Scryfall ID via `ScryfallClient.getCard()`), then fetches its `rulings_uri`
  (`ScryfallClient.getCardRulings()`) -- the real
  [Scryfall Rulings API](https://scryfall.com/docs/api/rulings). Replaces the
  old `scryfall_agent/scryfall_tools.py` in-process Python tool, which hit the
  same endpoints directly from the main backend; that gap only existed because
  upstream didn't expose rulings; now it does, natively, alongside the other
  15 tools.

### 5.5 Web search (`llm_agent/web_search_tool.py`)

- Queries a self-hosted SearXNG instance's JSON API for candidate results.
- Fetches and extracts (`trafilatura`) the top few result pages for real content
  instead of thin snippets, falling back to the snippet if extraction fails.
- Used by the agent only when rules/rulings tools don't resolve the question —
  enforced by the system prompt, not by code.

---

## 6. Runtime scripts

- `setup.sh`: one-shot local setup — venv, deps, starts the dedicated Ollama
  instance, pulls the configured models into it. No host-side parser/ingestor
  step (that's inside `rules-mcp` now).
- `run_bot.sh`: brings up `rules-mcp`, `scryfall-mcp`, and `searxng` via
  `docker compose` (loopback-only ports), waits for them to report healthy, then
  runs the FastAPI backend directly on the host. Starts the dedicated Ollama
  instance first if it isn't already running.
- `scripts/run_ollama.sh`: the dedicated Ollama instance both the backend and
  `rules-mcp` point at, on its own port (`11435`, not Ollama's usual `11434`) so
  it coexists with any system-wide Ollama rather than fighting it for the port,
  and bound to `0.0.0.0` rather than `127.0.0.1` -- `rules-mcp` reaches it from
  inside Docker via `host.docker.internal`, which resolves to the host's
  bridge-gateway address, not loopback, so a loopback-only bind is unreachable
  from the container. Hardware detection (GPU/CPU) is left to Ollama's own
  defaults; if a GPU driver misbehaves, that's addressed via Ollama's own env
  vars (e.g. `OLLAMA_VULKAN=0`), not project-specific scripting.

---

## 7. Docker deployment

- `docker-compose.yml` defines five services: `mtg-judge` (main backend),
  `rules-mcp`, `scryfall-mcp` (built from `scryfall_mcp/Dockerfile`),
  `searxng`, and `caddy` (reverse proxy / TLS — the only service with a published
  public port).
- `mtg-judge`, `rules-mcp`, `scryfall-mcp`, and `searxng` share a `mtg-network`
  bridge network and address each other by service name.
- `rules-mcp`, `scryfall-mcp`, and `searxng` are also bound to `127.0.0.1` on the
  host, so the `run_bot.sh` hybrid workflow (host-run backend, dockerized
  supporting services) can reach them without exposing them publicly.
- `mtg-judge` and `rules-mcp` reach the dedicated Ollama instance via
  `host.docker.internal` + `extra_hosts: host-gateway`.

Primary files:

- `Dockerfile` (main backend), `rules_mcp/Dockerfile`,
  `scryfall_mcp/Dockerfile`
- `docker-compose.yml`, `Caddyfile`, `searxng/settings.yml`
- `scripts/docker_entrypoint.sh`

---

## 8. Local usage

### Initial setup

```bash
./setup.sh
```

If the configured model is an Ollama cloud model (the default, `gemma4:cloud`),
sign in once per machine:

```bash
OLLAMA_HOST=localhost:11435 ollama signin
```

### Start the bot stack

```bash
./run_bot.sh
```

### API checks

```bash
curl http://localhost:8000/health
curl -X POST http://localhost:8000/chat -H "Content-Type: application/json" \
  -d '{"query": "What happens during the untap step?"}'
```

---

## 9. Current limitations

- Multi-turn conversation memory is not implemented yet (`conversation_id` is
  accepted by the API but unused).
- Web UI and Discord bot are explicitly out of scope for this pass — the backend
  is built to support them, but they don't exist yet.
- Tool-calling reliability varies significantly by model. The default,
  `gemma4:cloud`, calls tools reliably in testing; small local models (e.g.
  `qwen3.5:0.8b`) are considerably more prone to skipping tools they should use
  and answering from memory instead.
- SearXNG's Reddit coverage (and, over time, its Google/Bing coverage) is
  best-effort — a self-hosted instance's outbound IP can get rate-limited by
  upstream engines under sustained traffic.
- The `rules-mcp` boot-time ingest guard (skip re-ingest unless the PDF changed or
  the marker file is missing) avoids duplicate embeddings on restart, but there's
  still no incremental/upsert ingestion — a real rules update triggers a full
  rebuild.
