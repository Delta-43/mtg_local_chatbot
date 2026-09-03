# Scryfall API Compliance Guide

This document describes the compliance-related behavior that exists in the current implementation. It is intentionally narrower than a legal policy document.

## What The Server Does Today

### Request Headers

- Sends `Accept: application/json` on JSON API requests.
- Sends a configurable `User-Agent` header on Scryfall requests.
- Uses HTTPS for Scryfall API traffic.

The default `User-Agent` is `ScryfallMCPServer/<APP_VERSION>`, derived from `src/version.ts`. Set `SCRYFALL_USER_AGENT` to override it; `.env.example` documents that override. Scryfall asks API clients to send an accurate user agent for the actual usage context, preferably including an application or script name, version, and contact or repository information.

### Rate Limiting

- Defaults to a 100 ms minimum interval between Scryfall requests.
- Enforces a 500 ms minimum interval for Scryfall's documented 2/sec endpoints: `/cards/search`, `/cards/named`, `/cards/random`, and `/cards/collection`.
- Records `429` responses, honors `Retry-After` when present, and delays later requests through the shared limiter.
- Tracks repeated failures and uses a circuit-breaker path to avoid hammering an unhealthy upstream.
- Treats direct bulk file downloads from Scryfall file origins separately from ordinary API traffic.

### Caching

Current cache durations in code:

- card search: 30 minutes
- card details: 24 hours
- card prices: 6 hours
- set-model data and normal refresh cadence: 1 week
- serialized set snapshot fallback: retained for up to 4 weeks, subject to cache capacity
- bulk data: 24 hours

Important implementation notes:

- bulk card data is discovered through the bulk endpoint, streamed from the direct download URI, and cached as a serialized snapshot
- set filtering is derived from one canonical cached `/sets` dataset
- when a scheduled set refresh fails, the server serves an available stale snapshot and retries the refresh after 5 minutes
- in-process cache retention is bounded; a complete bulk MCP resource response still occupies memory while it is returned
- oversized bulk snapshots are streamed through disk and retained on disk for warm reads when the serialized payload is too large for the configured in-memory cache

### Bulk Data

- Uses Scryfall bulk data for the card database resource.
- Treats bulk downloads separately from ordinary card-search traffic.
- Does not treat bulk prices as a storefront-grade source of truth; Scryfall documents bulk prices as stale after 24 hours.

### Images And Attribution

- Card detail responses include Scryfall source links and artist attribution when Scryfall provides them.
- The server returns Scryfall image URLs rather than transforming, watermarking, recoloring, or embedding modified image payloads.
- Consumers that render card images should preserve copyright, artist, and source context and avoid cropping, clipping, stretching, skewing, recoloring, watermarking, or implying non-Wizards ownership of card imagery.

## Developer Guidance

Do:

- keep using `ScryfallClient` instead of ad hoc fetch code
- preserve the configured `User-Agent`
- keep rate limiting and caching in place when adding new Scryfall-backed features
- prefer bulk data when the use case needs a large card corpus
- use fresh card API lookups, not bulk data, when a workflow needs current prices

Do not:

- bypass the shared rate limiter
- add duplicate network calls when existing code already fetched equivalent metadata
- treat filtered cache entries as reusable unless every result-affecting dimension is represented
- remove attribution or source links from card/image-facing output

## Useful Runtime Checks

The current public server helpers are:

```ts
const status = server.getStatus();
const health = await server.healthCheck();
```

`getStatus()` exposes cache, rate limiter, tool, resource, prompt, and monitoring state. `healthCheck()` performs the current health probe flow.

## Scope

This guide is about implementation behavior in this repository. It is not legal advice, and it does not replace Scryfall's own terms or documentation.

Primary external references:

- [Scryfall API Documentation](https://scryfall.com/docs/api)
- [Scryfall Bulk Data](https://scryfall.com/docs/api/bulk-data)
- [Scryfall Cards API](https://scryfall.com/docs/api/cards)
- [Scryfall Images](https://scryfall.com/docs/api/images)
- [Scryfall Terms](https://scryfall.com/docs/terms)
- [Scryfall FAQs](https://scryfall.com/docs/faqs)
- [Scryfall Privacy Policy](https://scryfall.com/docs/privacy)
