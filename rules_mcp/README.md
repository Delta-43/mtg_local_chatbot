# mtg-rules-mcp

A standalone Model Context Protocol (MCP) server that exposes **semantic search over
the Magic: The Gathering Comprehensive Rules**, backed by a local ChromaDB vector
index kept current from the official rules PDF on wizards.com.

Unlike the several existing Scryfall-card-focused MCP servers in the MTG/MCP
ecosystem, this project is scoped specifically to rules text — it's meant to be
composed alongside a card-data MCP server (e.g.
[bmurdock/scryfall-mcp](https://github.com/bmurdock/scryfall-mcp)) rather than
duplicate that surface.

This package is deliberately self-contained (no imports from outside `rules_mcp/`)
so it can be lifted into its own repository unchanged.

## What it exposes

### Tools

- `search_rules(query, section?, k?)` — semantic search over the Comprehensive
  Rules. Returns matching rule chunks tagged with their `rule_id` for citation.
  `section` optionally restricts results to a chapter/section number (e.g. `"704"`).
- `get_rule_by_id(rule_id)` — exact lookup by rule number (e.g. `"702.19"`),
  not semantic search. Used to independently verify a specific rule number
  actually exists before citing it (see the main repo's `CLAUDE.md` for why
  this exists and why `search_rules` isn't reliable for that job).

## Transport

Runs over MCP **Streamable HTTP**:

```bash
python -m rules_mcp.server
```

Configure with environment variables (see `settings.py`):

| Variable | Default | Purpose |
|---|---|---|
| `HTTP_HOST` | `0.0.0.0` | Bind address |
| `HTTP_PORT` | `8100` | Bind port |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama endpoint for embeddings (when `EMBEDDING_PROVIDER=local`) |
| `EMBEDDING_MODEL` | `mxbai-embed-large` | Local embedding model |
| `EMBEDDING_PROVIDER` | `local` | `local` (Ollama) or `hosted` (OpenRouter) — see "Embedding provider" below |
| `OPENROUTER_EMBEDDING_API_KEY` | *(none)* | Required when `EMBEDDING_PROVIDER=hosted` — a separate key from the main backend's `OPENROUTER_API_KEY` on purpose |
| `OPENROUTER_EMBEDDING_MODEL` | `baai/bge-m3` | Hosted embedding model id |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | Hosted embedding API base URL |
| `CHROMA_PERSIST_DIR` | `./data/chroma` | Vector store path |
| `CHROMA_COLLECTION_NAME` | `mtg_rules` | Chroma collection name |
| `PDF_PARSER_DIR` | `./data/pdf_parser` | Rules PDF/JSON path |
| `REFRESH_ON_BOOT` | `true` | Check for a newer rules PDF and re-ingest on startup |
| `INGEST_CONCURRENCY` | CPU count, capped at 8 | Concurrent embedding batches during ingestion — see "Ingestion concurrency" below |

## Running standalone

```bash
python3 -m venv .venv
./.venv/bin/pip install -r requirements.txt
OLLAMA_BASE_URL=http://localhost:11434 ./.venv/bin/python -m rules_mcp.server
```

Or via Docker (this directory is a self-contained build context):

```bash
docker build -t mtg-rules-mcp .
docker run -p 8100:8100 -e OLLAMA_BASE_URL=http://host.docker.internal:11434 mtg-rules-mcp
```

## Verifying with the MCP Inspector

```bash
npx @modelcontextprotocol/inspector
```

Connect to `http://localhost:8100/mcp` (Streamable HTTP) and call `search_rules`
with a real rules question to confirm `rule_id`-tagged citations come back.

## Manual ingestion

The server re-ingests automatically on boot when the rules PDF changed or the
Chroma index is empty (see `REFRESH_ON_BOOT`). Ingestion is incremental: each
rule's content hash is tracked in a `.ingest_manifest.json` file next to the
Chroma persist dir, so a Comprehensive Rules update only re-embeds the rules
whose text actually changed, not the whole ~1300-chunk collection.

To force a full rebuild manually (wipes and re-embeds everything):

```bash
python -m rules_mcp.parser     # download/parse the latest Comprehensive Rules
python -m rules_mcp.ingestor   # re-embed and rebuild the Chroma index
```

Run this once after upgrading an existing deployment to a version with
incremental ingestion — a persist dir from before has no manifest, so its
first incremental ingest would otherwise add new-scheme chunks without
deleting the old ones.

## Embedding provider

Embedding runs locally via Ollama by default (`EMBEDDING_PROVIDER=local`),
matching the rest of this project's local-first stance. Set
`EMBEDDING_PROVIDER=hosted` (with `OPENROUTER_API_KEY`) to embed via
OpenRouter's OpenAI-compatible `/embeddings` endpoint instead — useful on
slower or low-core-count hardware where local embedding is genuinely
compute-bound (raising `INGEST_CONCURRENCY` alone doesn't help there; see
below). `baai/bge-m3` (the default hosted model) happens to produce the
same 1024-dimension vectors as `mxbai-embed-large`, but **dimension
matching is not the same as vector-space compatibility** — two different
embedding models don't place semantically similar text at comparable
coordinates, even at the same dimension. `ingest()` tracks which
provider+model produced the current collection (`.embedding_signature`
next to the Chroma persist dir) and automatically forces a full re-embed,
not an incremental diff, whenever that changes — switching providers never
silently mixes two incompatible vector spaces in one collection. Verified:
ingesting fresh under `hosted`, then re-ingesting under `local` on the same
collection, correctly triggers "Embedding provider changed ... forcing a
full re-embed" and produces a clean, fully re-embedded collection; a
same-provider re-run afterward is still a true no-op.

## Ingestion concurrency

`INGEST_CONCURRENCY` (default: CPU count, capped at 8) controls how many
embedding batches `ingest()` sends concurrently. Whether this actually
speeds anything up depends on where the real bottleneck is — measured on a
4-core, CPU-only, no-GPU host, it made **no measurable difference**,
because the bottleneck there was raw CPU compute for the embedding model
itself, not request queueing (raising `OLLAMA_NUM_PARALLEL` on the Ollama
side didn't help either, for the same reason). It should genuinely help on
hardware where queueing/latency is the limiting factor instead — more
cores, or hosted embeddings (see above), which moves the compute off the
ingesting host entirely rather than trying to parallelize a
already-saturated local CPU.
