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

## Remaining / not started

**Product surfaces** — backend is built to support these but they don't exist yet
- [ ] Web UI
- [ ] Discord bot (or other chat-platform integration)

**Conversation**
- [ ] Multi-turn conversation memory — `conversation_id` is accepted by the
      `/chat` API but currently unused

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
