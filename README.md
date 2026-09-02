# MTG Judge Chatbot

An AI-powered Magic: The Gathering rules judge chatbot: a real tool-calling agent
backed by a local semantic rules index, live Scryfall card data, and web search for
contested rulings — with citations required in every answer.

## Architecture

The backend is a **tool-calling agent** (LangChain 1.x `create_agent`), not a fixed
classify-then-branch pipeline. It decides for itself which tools to call, in what
order, and cites the specific rule numbers / rulings / links it used.

- **LLM**: pluggable — an Ollama model (local weights or an [Ollama cloud
  model](https://ollama.com/cloud), which runs on Ollama's infrastructure instead
  of this host), or a hosted model via OpenRouter (any OpenRouter-supported
  model). Selected by `llm_provider.provider` in `project_config.yml` (`local` or
  `hosted`); the default is the Ollama cloud model `gemma4:cloud`.
- **Rules retrieval**: [`rules_mcp/`](rules_mcp/) — a standalone MCP server (own
  README, own Dockerfile) exposing semantic search over the Comprehensive Rules via
  a local ChromaDB index. Self-refreshes from wizards.com on boot.
- **Card data**: [`scryfall-mcp`](https://github.com/bmurdock/scryfall-mcp) —
  15 Scryfall-backed tools (search, pricing, sets, deckbuilding, legality, etc.) built
  directly from upstream GitHub in Docker via [scryfall_mcp/Dockerfile](scryfall_mcp/Dockerfile).
- **Official rulings**: `get_card_rulings` — a small in-process tool hitting
  Scryfall's `/cards/:id/rulings` endpoint directly (the one gap in scryfall-mcp's
  tool set).
- **Web search**: a self-hosted **SearXNG** metasearch instance plus a
  fetch/extract step (`trafilatura`), used only for interactions that are
  ambiguous or contested and not resolved by the rules index or official rulings.
- **API**: FastAPI, with CORS, `X-API-Key` auth, and per-key/IP rate limiting for
  public deployment; ready for a web UI or Discord bot to sit in front of it
  (not included in this pass).
- **Edge**: Caddy reverse proxy (automatic TLS for a real domain).

```text
Client -> Caddy -> FastAPI (app_api/main.py) -> tool-calling agent (llm_agent/agent.py)
                                                    |-- rules-mcp (semantic rules search)
                                                    |-- scryfall-mcp (card data)
                                                    |-- get_card_rulings (official rulings)
                                                    `-- web_search (SearXNG + extract)
```

Every final answer is required (by the agent's system prompt) to end with a
citation block: rule numbers used, official rulings used, and source URLs if web
search was used. If the agent can't ground part of an answer in a tool result, it's
instructed to say so rather than guess.

## Quick start (local, hybrid dev)

```bash
./setup.sh
```

`setup.sh` creates or reuses `.venv`, installs the main backend's deps, starts a
dedicated Ollama instance (see below), and pulls the configured models into it.
Rules ingestion happens automatically inside the `rules-mcp` container on first
boot — no separate host-side parsing step.

The default model, `gemma4:cloud`, needs a one-time sign-in per machine
(`setup.sh` will tell you if this is still needed):

```bash
OLLAMA_HOST=localhost:11435 ollama signin
```

Then run the full stack:

```bash
./run_bot.sh
```

This brings up `rules-mcp`, `scryfall-mcp`, and `searxng` via `docker compose`
(loopback-only ports, see below), waits for them to be healthy, then runs the
FastAPI backend directly on the host for fast local iteration.

### Ollama runtime

`setup.sh` and `run_bot.sh` start a **dedicated Ollama instance** on port `11435`
(`scripts/run_ollama.sh`), separate from any system-wide Ollama service, bound to
`0.0.0.0` rather than loopback so Docker containers can reach it via
`host.docker.internal`. `rules-mcp` needs a working Ollama for embeddings
regardless of `LLM_PROVIDER`; Ollama cloud models (like the default) also route
through this instance, which just proxies the request to Ollama's infrastructure.
This only matters in `local` LLM mode. In `hosted` (OpenRouter) mode, Ollama is
only used for embeddings inside `rules-mcp`.

If your GPU driver hangs on Ollama's automatic offload detection, that's a
driver-level `ollama serve` concern independent of this project — see
[Ollama's troubleshooting docs](https://docs.ollama.com) for disabling GPU
offload (e.g. `OLLAMA_VULKAN=0` for the Vulkan backend) if you hit it.

## Docker (full stack, incl. public-facing reverse proxy)

```bash
docker-compose up --build
```

This starts `mtg-judge`, `rules-mcp`, `scryfall-mcp`, `searxng`, and `caddy`. Only
`caddy` publishes a public port (`80`/`443`); everything else is internal to the
`mtg-network` docker network, though `rules-mcp` (`8100`), `scryfall-mcp` (`3000`),
and `searxng` (`8080`) are also bound to `127.0.0.1` so a host-run backend (the
`run_bot.sh` workflow above) can reach them directly without exposing them
publicly.

For a real domain with automatic TLS, edit `Caddyfile` and replace the `:80` block
with your domain (see the comment in that file). For OpenRouter (hosted LLM) mode,
set `LLM_PROVIDER=hosted` and `OPENROUTER_API_KEY` before starting (see
Configuration below).

Note: inside Docker, `OLLAMA_BASE_URL` must point to the dedicated Ollama instance
reachable from the containers (`http://host.docker.internal:11435` by default) —
only relevant in `local` LLM mode; `rules-mcp` still needs it for embeddings
regardless of `LLM_PROVIDER`.

## Troubleshooting

### `./run_bot.sh` exits with `127`

This is usually a broken virtual environment executable path (often after renaming `venv` to `.venv`).

```bash
rm -rf .venv
python3 -m venv .venv
./.venv/bin/pip install --upgrade pip
./.venv/bin/pip install -r requirements.txt
```

Then retry:

```bash
./run_bot.sh
```

### API starts but requests fail or hang

1. Check API health (reports whether both MCP servers are reachable):

```bash
curl -s http://localhost:8000/health
```

2. Check each backing service directly:

```bash
curl -s http://localhost:11435/api/version   # Ollama
curl -s http://localhost:8100/health         # rules-mcp
curl -s http://localhost:3000/health         # scryfall-mcp
curl -s http://localhost:8080/                # searxng
```

3. If using an Ollama cloud model (`*:cloud`), confirm sign-in:

```bash
OLLAMA_HOST=localhost:11435 ollama signin
```

An unsigned-in instance returns `401 Unauthorized` on the first actual chat
request even though the model pulled successfully (pulling a cloud model tag
only fetches a small manifest, not weights).

### `docker compose` not found

`run_bot.sh` needs Docker to run `rules-mcp`, `scryfall-mcp`, and `searxng`.
Install Docker (with the `compose` plugin, or standalone `docker-compose`).

### Answers are slow or truncated

- Lower generation cost by reducing `llm.num_predict` and/or `llm.num_ctx` in `project_config.yml`.
- Keep `llm.reasoning: false` unless you explicitly want longer reasoning traces
  (some models spend their whole token budget "thinking" and return little to no
  answer if `num_predict` is tight).
- For a local (non-cloud) model, tool-calling reliability varies a lot by model
  size; smaller models may skip tools you'd expect them to use. Prefer `hosted`
  mode or an Ollama cloud model for consistent tool-calling.

### Docker cannot reach Ollama

Networking can differ by machine. If chat fails in Docker but works locally:

1. Test from container shell which endpoint is reachable.
2. Override `OLLAMA_BASE_URL` in compose environment to that reachable host/IP.
3. Confirm the dedicated Ollama instance is bound to `0.0.0.0`, not `127.0.0.1`
   (see `scripts/run_ollama.sh`) — a loopback-only bind is unreachable from a
   container even if it works fine from the host shell.

## API Endpoints

**Health Check** (reports LLM provider and whether rules-mcp/scryfall-mcp are reachable):
```bash
curl http://localhost:8000/health
```

**Chat:**
```bash
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"query": "What happens during the untap step?"}'
```

Put a card in double quotes to steer the agent toward a Scryfall lookup:
```bash
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"query": "What does \"Lightning Bolt\" do?"}'
```

If `server.api_keys` is set, include `-H "X-API-Key: <key>"`. The response's
`sources` field is `{"rules": [...], "rulings": [...], "web_links": [...]}`, built
from the tools the agent actually called.

## Configuration

Primary settings live in `project_config.yml`. Environment variables override YAML values:

| Variable | Default | Purpose |
|---|---|---|
| `OLLAMA_BASE_URL` | `http://localhost:11435` | Dedicated Ollama instance endpoint |
| `LLM_MODEL` | `gemma4:cloud` | Chat model (when `LLM_PROVIDER=local`); an Ollama cloud model tag or a local weights tag |
| `EMBEDDING_MODEL` | `mxbai-embed-large` | Embedding model (used by `rules-mcp`, always local) |
| `LLM_REASONING` | `false` | Disable model "thinking" traces |
| `LLM_NUM_PREDICT` | `2048` | Max answer tokens |
| `LLM_NUM_CTX` | `8192` | Context window |
| `LLM_PROVIDER` | `local` | `local` (Ollama, incl. cloud models) or `hosted` (OpenRouter) |
| `OPENROUTER_API_KEY` | *(none)* | Required when `LLM_PROVIDER=hosted` |
| `OPENROUTER_MODEL` | `openrouter/auto` | Hosted model id |
| `RULES_MCP_URL` | `http://localhost:8100/mcp` | rules-mcp endpoint |
| `SCRYFALL_MCP_URL` | `http://localhost:3000/mcp` | scryfall-mcp endpoint |
| `SEARXNG_URL` | `http://localhost:8080` | SearXNG endpoint for `web_search` |
| `SCRYFALL_USER_AGENT` | `MTG-Judge-Chatbot/1.0 (+https://github.com/mtg-judge)` | Sent to Scryfall by both scryfall-mcp and `get_card_rulings` |
| `CORS_ALLOWED_ORIGINS` | *(empty = disabled)* | Comma-separated origin allowlist |
| `API_KEYS` | *(empty = disabled)* | Comma-separated valid `X-API-Key` values |
| `RATE_LIMIT_PER_MINUTE` | `20` | Per API-key/IP rate limit on `/chat` |

`rules-mcp` has its own env-var-only config (`CHROMA_PERSIST_DIR`, `PDF_PARSER_DIR`,
etc.) — see [rules_mcp/README.md](rules_mcp/README.md).

## Project Structure

```
mtg_local_chatbot/
├── app_api/                  # FastAPI app (CORS, auth, rate limiting, /chat, /health)
├── llm_agent/                # Tool-calling agent, pluggable LLM provider, web_search tool
├── rules_mcp/                # Standalone MCP server: semantic rules search (own README)
├── scryfall_agent/           # get_card_rulings (the one gap in scryfall-mcp's tool set)
├── scryfall_mcp/             # Docker build for bmurdock/scryfall-mcp (cloned directly from GitHub)
├── searxng/settings.yml      # Self-hosted metasearch config for web_search
├── core_config/              # YAML-first config loader
├── project_config.yml        # Canonical project configuration
├── setup.sh                  # One-shot local setup (.venv, deps, Ollama)
├── run_bot.sh                # Full stack launcher — docker compose + host uvicorn
├── requirements.txt          # Main backend's Python dependencies
├── Dockerfile                # Main backend container
├── docker-compose.yml        # Full stack: mtg-judge, rules-mcp, scryfall-mcp, searxng, caddy
├── Caddyfile                 # Reverse proxy / TLS
└── scripts/                  # Ollama launcher and Docker entrypoint
```

## Performance notes

- `rules-mcp`'s first-boot rules ingestion (~1300 chunks) takes roughly 8-10 minutes
  on a mid-range CPU; expect longer on older/slower hardware. This only runs the
  embedding model locally — chat inference with the default `gemma4:cloud` model
  doesn't touch local compute at all.
- A chat query typically involves multiple tool round-trips (rules search,
  possibly Scryfall and/or web search), so response time depends more on how many
  tools the model decides to call than on raw model speed.
- Tool-calling reliability varies significantly by model. The default,
  `gemma4:cloud`, calls tools reliably; small local models are more prone to
  skipping tools they should use or answering from memory instead.
