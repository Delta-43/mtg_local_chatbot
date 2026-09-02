# scryfall-mcp

Dockerized wrapper for [bmurdock/scryfall-mcp](https://github.com/bmurdock/scryfall-mcp), providing 15 Scryfall-backed Model Context Protocol (MCP) tools for Magic: The Gathering card lookup, pricing, legality, and deckbuilding.

The container builds directly from the upstream GitHub repository rather than using a local vendor submodule.

## Build and Run

Built and managed automatically via Docker Compose:

```bash
docker compose up -d --build scryfall-mcp
```

Or standalone:

```bash
docker build -t mtg-scryfall-mcp .
docker run -p 3000:3000 mtg-scryfall-mcp
```
