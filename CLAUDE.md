# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An AI Magic: The Gathering rules judge. A LangChain 1.x tool-calling agent (not a
fixed classify-then-branch pipeline) decides for itself which tools to call — a
semantic rules index, live Scryfall card data, official rulings, or web search —
and is required by its system prompt to end every answer with a citation block
(rule numbers, rulings, source URLs). If it can't ground part of an answer in a
tool result, it's instructed to say so rather than guess.

`Description.md` has the full architecture writeup; `README.md` has setup/usage.
This file is oriented toward things that aren't obvious from reading one file at
a time.

## Commands

```bash
./setup.sh      # venv, deps, dedicated Ollama instance + model pulls, submodule fetch
./run_bot.sh     # docker compose up rules-mcp/scryfall-mcp/searxng, then host uvicorn
```

There is no lint/test tooling in the main backend (`app_api`, `llm_agent`,
`core_config`, `scryfall_agent`) or in `rules_mcp` — verification is functional,
by actually running the stack and hitting `/chat` (see README's API Endpoints
section). The vendored `vendor/scryfall-mcp/` submodule has its own `vitest` suite
(`npm test` inside that directory) but it's third-party code; don't add tests
there.

Full Docker deployment (all five services incl. Caddy):
```bash
git submodule update --init --recursive
docker-compose up --build
```

`rules_mcp/` is a separate, independently runnable service (no imports from the
rest of the repo) — see `rules_mcp/README.md` for running/testing it standalone
via `python -m rules_mcp.server`, or forcing a manual re-ingest via
`python -m rules_mcp.parser` + `python -m rules_mcp.ingestor`.

## Architecture

```text
Client -> Caddy -> FastAPI (app_api/main.py) -> tool-calling agent (llm_agent/agent.py)
                                                    |-- rules-mcp (MCP/HTTP): search_rules
                                                    |-- scryfall-mcp (MCP/HTTP, vendored): 15 tools
                                                    |-- get_card_rulings (in-process @tool)
                                                    `-- web_search (in-process @tool: SearXNG + trafilatura)
```

Four independent tool sources get merged into one agent in `llm_agent/agent.py`'s
`build_agent()`: `rules-mcp` and `scryfall-mcp` are loaded over MCP via
`langchain-mcp-adapters`' `MultiServerMCPClient`; `get_card_rulings` and
`web_search` are plain in-process `@tool`s. This mixed sourcing matters when
touching `_extract_sources()`: MCP tool messages carry `content` as a list of
content blocks (`[{"type": "text", "text": "..."}]`), not a plain string like the
in-process tools — `_content_to_text()` exists specifically to unwrap that before
the citation regexes run, since stringifying the list runs the regex against a
Python `repr()` instead of the actual text.

**Card data is delegated, not reimplemented.** `vendor/scryfall-mcp` is a git
submodule of an actively-maintained third-party MCP server (15 tools: search,
pricing, sets, deckbuilding, legality, etc.), built via a sibling
`vendor/scryfall-mcp.Dockerfile` this repo maintains (upstream ships none).
`scryfall_agent/scryfall_tools.py` is deliberately thin — just `get_card_rulings`,
the one gap in the vendored server's tool set (hits `/cards/named` then
`/cards/:id/rulings` directly). If upstream's `package-lock.json` drifts from
`package.json` again (it has before — `npm ci` fails, `npm install` doesn't), that's
an upstream lockfile issue; the Dockerfile already uses `npm install` for this
reason.

**`rules_mcp/` is a self-contained, extractable project**, not a module of this
repo — it has its own `settings.py` (env-var-only, no YAML) and doesn't import
`core_config`. A few non-obvious things inside it:
- `ingestor.py`'s `recreate=True` path clears the persist directory's *contents*,
  never the directory itself — it's a Docker bind mount, and `rmtree`-ing a mount
  point raises "Device or resource busy".
- The boot-time "already ingested, skip re-embedding" check (`server.py`) is a
  plain file-existence check against an `.ingest_complete` marker file, not a
  Chroma query. chromadb caches system state per persist-directory path within a
  process; opening a throwaway `Chroma` client just to read a document count
  leaves the *next* client (the one `ingest()` itself opens, after a
  `recreate=True` wipe) stuck against stale state, failing writes with
  `"attempt to write a readonly database"`. Don't reach for `Chroma(...)` here —
  use the marker file.
- `ingest()` is incremental, not a full re-embed on every Comprehensive Rules
  update: each top-level rule gets a deterministic chunk id
  (`f"{rule_id}::{i}"`) and a content hash recorded in a
  `.ingest_manifest.json` file next to the Chroma persist dir. A later
  `ingest()` diffs against that manifest and only deletes+re-adds chunks for
  rules whose hash actually changed (plus deletes chunks for rules removed
  entirely) — unchanged rules aren't touched. **Migration gotcha**: a
  persist dir from before this existed has no manifest, so the first
  post-upgrade `ingest()` treats every rule as "new" and re-adds it under the
  new deterministic ids *without* deleting the old random-UUID-keyed chunks
  from before — the collection would silently double. Run one manual
  `python -m rules_mcp.ingestor` (its `recreate=True` default) after
  upgrading an existing deployment to establish a clean manifest baseline;
  server.py's own boot-time `_bootstrap()` never passes `recreate=True`
  itself, so this won't happen automatically on a container restart.

**Config is YAML-first with env-var overrides**, resolved once at import time by
`core_config/settings.py` (`_resolve()` checks the env var, then the YAML path,
then a hardcoded fallback). There's no intermediate export-to-shell step — the
Docker entrypoint just asks `Config` for `HOST`/`PORT` and execs uvicorn directly.
`rules_mcp/settings.py` is a separate, parallel settings module by design (see
above).

**LLM provider is pluggable**: `llm_provider.build_chat_model()` returns either
`ChatOllama` (`LLM_PROVIDER=local`) or `ChatOpenAI` pointed at OpenRouter
(`LLM_PROVIDER=hosted`). The default model, `gemma4:cloud`, is an **Ollama cloud
model** — inference runs on Ollama's infrastructure, but the client still talks to
a local Ollama instance, which just proxies the request. This requires a one-time
`ollama signin` per machine (see README) before the first real chat request, or
you get a `401 Unauthorized` that only surfaces at inference time — pulling the
model tag itself succeeds either way, since that only fetches a small manifest.
`rules-mcp`'s embeddings are always local regardless of `LLM_PROVIDER`.

**Ollama runs as a dedicated instance on its own port (`11435`, not the usual
`11434`)**, started by `scripts/run_ollama.sh` and bound to `0.0.0.0`. Both
choices are load-bearing, not arbitrary:
- Its own port lets it coexist with any system-wide Ollama already running
  instead of fighting it for the port.
- `0.0.0.0`, not `127.0.0.1`: `rules-mcp` and `mtg-judge` reach it from inside
  Docker via `host.docker.internal`, which resolves to the host's bridge-gateway
  address, not loopback — a loopback-bound service is unreachable from a
  container even though it works fine from the host shell. (On a host with a
  restrictive firewall, e.g. `ufw`, the bridge subnet also needs an explicit
  allow rule for this port — the container-to-host hop looks like external
  traffic to the firewall.)

GPU vs. CPU is *not* a project-level concern anymore — hardware detection is left
to Ollama's own defaults. If a GPU driver misbehaves (e.g. hangs on Vulkan
offload), that's addressed via Ollama's own env vars (`OLLAMA_VULKAN=0` etc.),
not project-specific scripting. This used to be a bigger axis of complexity
(separate CPU/GPU launcher scripts) before the default model moved to a cloud
model that doesn't need local GPU/CPU inference for chat at all.
