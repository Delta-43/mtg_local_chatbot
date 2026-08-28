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
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama endpoint for embeddings |
| `EMBEDDING_MODEL` | `mxbai-embed-large` | Embedding model |
| `CHROMA_PERSIST_DIR` | `./data/chroma` | Vector store path |
| `CHROMA_COLLECTION_NAME` | `mtg_rules` | Chroma collection name |
| `PDF_PARSER_DIR` | `./data/pdf_parser` | Rules PDF/JSON path |
| `REFRESH_ON_BOOT` | `true` | Check for a newer rules PDF and re-ingest on startup |

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
