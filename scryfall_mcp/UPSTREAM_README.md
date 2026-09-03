# Scryfall MCP Server

Scryfall-backed MCP server for Magic: The Gathering search, rules lookup, pricing, set discovery, and deckbuilding workflows.

The project currently supports:

- `stdio` as the primary transport for local MCP clients
- local-first Streamable HTTP via `src/http.ts`
- 15 MCP tools, 3 resources, and 2 prompts

## What It Exposes

### Tools

- `search_cards`: Run Scryfall card searches with paging, sorting, and optional price filtering.
- `get_card`: Fetch one card by name, set/collector number, or Scryfall ID.
- `get_card_prices`: Return price data with optional format context and alternatives.
- `random_card`: Get a random card with optional filters.
- `search_sets`: Search and filter Magic sets.
- `query_rules`: Search the local comprehensive rules file with context.
- `build_scryfall_query`: Convert natural language into an explainable Scryfall query.
- `search_format_staples`: Find staples and role players for a format.
- `search_alternatives`: Find cheaper, upgraded, or similar cards.
- `find_synergistic_cards`: Find synergy pieces for a card, theme, or archetype.
- `batch_card_analysis`: Analyze multiple cards for legality, prices, synergy, or composition.
- `validate_brawl_commander`: Check Brawl and Standard Brawl commander legality.
- `analyze_deck_composition`: Evaluate deck lists for curve, colors, and structural issues.
- `suggest_mana_base`: Recommend land counts and fixing packages from color requirements.
- `show_card_search`: Render a ChatGPT Apps widget for visual Scryfall card search results.

### Resources

- `card-database://bulk`: Cached Oracle bulk snapshot.
- `set-database://all`: Cached set list snapshot.
- `ui://widget/card-search.html`: ChatGPT Apps widget template for `show_card_search`.

### Prompts

- `analyze_card`
- `build_deck`

## Transports

### STDIO

Recommended for Claude Desktop, Codex, MCP Inspector, and most local MCP clients.

```bash
npm run dev
```

```bash
npm start
```

### Streamable HTTP

Available as a separate entrypoint for local or explicitly controlled environments.

```bash
npm run dev:http
```

```bash
npm run start:http
```

For local MCP testing:

```bash
npm run dev:http:local
npm run smoke:http
```

The smoke test checks `/health`, performs MCP `initialize`, sends `notifications/initialized`, and verifies `tools/list`.
It also makes representative `validate_brawl_commander` and `search_cards` tool calls so the local HTTP endpoint is checked beyond discovery.

Current HTTP behavior:

- binds to `127.0.0.1` by default
- serves `POST|GET|DELETE` on `/mcp`
- serves `GET /health`
- rejects non-loopback `Origin` headers by default unless `HTTP_ALLOWED_ORIGINS` is set

The HTTP entrypoint is useful today, but it is still documented conservatively. It is not presented here as a public-hosting story.

### ChatGPT App Development

The HTTP MCP endpoint can be connected to ChatGPT Developer Mode as a local app prototype. Start the server on loopback:

```bash
npm run dev:http:local
```

Expose that local endpoint with an HTTPS tunnel:

```bash
ngrok http 3000
```

Then connect the tunneled `https://.../mcp` URL in ChatGPT Developer Mode. Refresh the app after changing tool descriptors, widget resources, or metadata so ChatGPT reloads the current MCP surface.

The current ChatGPT-facing widget is `show_card_search`, which returns concise `structuredContent` for the model and renders `ui://widget/card-search.html` in ChatGPT. The widget is read-only against Scryfall, uses Scryfall image URLs, and keeps its CSP resource allowlist limited to `https://cards.scryfall.io`.

## Setup

### Prerequisites

- Node.js `^20.19.0`, `^22.13.0`, or `>=24.0.0`
- npm

### Install

```bash
git clone https://github.com/bmurdock/scryfall-mcp.git
cd scryfall-mcp
npm install
cp .env.example .env
```

The documented `npm run dev*`, `npm start`, and `npm run inspector` commands preload `.env`. Explicit process environment variables take precedence over values in that file. MCP clients that launch `dist/index.js` directly should provide overrides through their own `env` configuration.

### Validate

```bash
npm run lint
npm run type-check
npm test
npm run test:coverage
```

### Build

```bash
npm run build
```

## Common Commands

```bash
npm run dev
npm run dev:http
npm start
npm run start:http
npm test
npm run test:watch
npm run test:ui
npm run test:coverage
npm run lint
npm run lint:fix
npm run type-check
npm run inspector
```

## Configuration

See [.env.example](./.env.example) for the canonical values. The main variables in active use are:

- `SCRYFALL_USER_AGENT`
- `RATE_LIMIT_MS`
- `RATE_LIMIT_QUEUE_MAX`
- `SCRYFALL_TIMEOUT_MS`
- `CACHE_MAX_SIZE`
- `CACHE_MAX_MEMORY_MB`
- `LOG_LEVEL`
- `NODE_ENV`
- `HEALTHCHECK_DEEP`
- `HTTP_HOST`
- `HTTP_PORT`
- `HTTP_MCP_PATH`
- `HTTP_HEALTH_PATH`
- `HTTP_MAX_BODY_BYTES`
- `HTTP_SESSION_IDLE_MS`
- `HTTP_SESSION_CLEANUP_INTERVAL_MS`
- `HTTP_ALLOWED_ORIGINS`

Operational notes:

- Scryfall API calls are globally serialized by the shared rate limiter. Batch tools may schedule multiple local lookups, but upstream Scryfall request completion remains one-at-a-time by design.
- The default pacing is 100 ms for general API endpoints and at least 500 ms for Scryfall's 2/sec card endpoints: `/cards/search`, `/cards/named`, `/cards/random`, and `/cards/collection`.
- HTTP 429 responses are not retried automatically. The server records Scryfall's throttle window and delays the next request start so callers can decide whether to retry.
- `CACHE_MAX_MEMORY_MB` controls whether large in-memory snapshots, including `card-database://bulk`, can be retained. Bulk resource rebuilds stream to a temp file first; oversized snapshots remain on disk for warm reads instead of being retained in the cache. Each MCP resource response still materializes the complete serialized bulk payload required by the resource protocol, so callers should allow memory proportional to that response size.
- Set snapshots are refreshed weekly. A stale snapshot may be retained for up to four weeks, subject to cache capacity, and served when a scheduled refresh fails; failed scheduled refreshes are retried after five minutes.
- Card detail output includes Scryfall source links and artist attribution when available. Consumers that render Scryfall image URLs should preserve copyright, artist, and source context and should not crop, distort, recolor, watermark, or imply ownership of card images.
- Deck-list analysis resolves card names exactly first, then falls back to fuzzy lookup for exact misses and reports any fuzzy resolutions in the response.
- Deck-scale tools may return partial analysis or an explicit retry-after message when Scryfall throttles the underlying card lookups.
- Streamable HTTP sessions expire after `HTTP_SESSION_IDLE_MS` and are checked by `HTTP_SESSION_CLEANUP_INTERVAL_MS`.

Example local HTTP startup:

```bash
HTTP_HOST=127.0.0.1 HTTP_PORT=3000 npm run start:http
```

## Example Tool Calls

### `build_scryfall_query`

```json
{
  "natural_query": "blue counterspells under $20 for modern",
  "optimize_for": "precision"
}
```

### `search_cards`

```json
{
  "query": "c:r t:instant mv=1",
  "limit": 10,
  "order": "name"
}
```

### `search_sets`

```json
{
  "type": "expansion",
  "released_after": "2020-01-01"
}
```

### `find_synergistic_cards`

```json
{
  "focus_card": "Obeka, Splitter of Seconds",
  "synergy_type": "theme",
  "format": "commander",
  "color_identity": "UBR",
  "limit": 12
}
```

For commander-like workflows, pass `color_identity` when the focus is a theme rather than a resolvable card. When the focus resolves to a card, the tool infers that card's color identity and filters final results by requested legality, Arena availability, and color identity.

### `analyze_deck_composition`

```json
{
  "deck_list": "4 Lightning Bolt\n4 Monastery Swiftspear\n20 Mountain",
  "format": "modern",
  "strategy": "aggro"
}
```

## Claude Desktop Integration

Add the built stdio entrypoint to your Claude Desktop configuration.

macOS path: `~/Library/Application Support/Claude/claude_desktop_config.json`

Windows path: `%APPDATA%/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "scryfall": {
      "command": "node",
      "args": ["/absolute/path/to/scryfall-mcp/dist/index.js"]
    }
  }
}
```

## Operational Notes

- Rate limiting is enforced in-process with a 100 ms default minimum interval between general Scryfall API requests and a 500 ms minimum for Scryfall's 2/sec card endpoints.
- Search responses, card details, prices, sets, and bulk snapshots are cached with bounded in-memory limits.
- The bulk card resource streams rebuilds through disk and stores a pre-serialized snapshot to keep repeated reads cheap. Cache retention is bounded, but producing a bulk resource response still requires the full serialized response text in process memory.
- Set filtering is derived from one canonical cached `/sets` dataset to avoid incorrect filtered cache reuse.
- Health checks are available through `ScryfallMCPServer.healthCheck()` and the HTTP `/health` endpoint.
- If an MCP connector reports a JSON-RPC/SSE deserialization error, compare it against the raw HTTP smoke path:

```bash
npm run dev:http:local
npm run smoke:http
```

If the smoke command succeeds, capture the connector error text and the smoke output together; that separates local endpoint framing from connector-specific parsing.

## Documentation Map

Current source-of-truth docs:

- [PURPOSE.md](./PURPOSE.md)
- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [SECURITY.md](./SECURITY.md)
- [SCRYFALL_COMPLIANCE.md](./SCRYFALL_COMPLIANCE.md)

## License

MIT
