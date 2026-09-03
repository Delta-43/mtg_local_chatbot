# scryfall-mcp

A local fork of [bmurdock/scryfall-mcp](https://github.com/bmurdock/scryfall-mcp)
(MIT, vendored at commit `fd585a0`), providing 16 Scryfall-backed Model Context
Protocol (MCP) tools for Magic: The Gathering card lookup, pricing, legality,
deckbuilding, and official rulings.

The actual TypeScript source lives here (`src/`), checked into this repo
directly -- not a git submodule, and not built from a live remote clone at
Docker build time. Both of those were tried first and dropped for the same
reason: neither lets you actually modify the server. `UPSTREAM_README.md` is
upstream's own README, kept for attribution; this file documents what's
different here.

## What's been changed from upstream

- **`get_card_rulings`** (`src/tools/get-card-rulings.ts`): a 16th tool, added
  locally, calling the real
  [Scryfall Rulings API](https://scryfall.com/docs/api/rulings). Resolves a
  card the same way `get_card` does (name, set/collector-number, or Scryfall
  ID -- `ScryfallClient.getCard()`), then fetches its `rulings_uri`
  (`ScryfallClient.getCardRulings()`, added to `src/services/scryfall-client.ts`).
  This is the one gap upstream's tool set had; everything else here is
  unmodified upstream code.
- Test coverage in two places: name/description and input-validation checks
  in `tests/tools.test.ts` (mocked, alongside every other tool there), plus
  `tests/get-card-rulings.live.test.ts` -- real HTTP calls against
  `api.scryfall.com`, no mocked client or invented ruling text, for
  everything that actually depends on real ruling data. Needs network access
  and is slower than the rest of the suite; that's an intentional trade-off
  for this one tool, not the house style for the whole suite.

If you pull a newer upstream commit in, diff `src/` against it and re-apply
the tool addition above -- there's no automated sync mechanism.

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

## Local development

```bash
npm install
npx tsc --noEmit                                    # typecheck
npx vitest run                                      # full suite -- needs network for the live rulings test
npx vitest run tests/get-card-rulings.live.test.ts  # just the real-API rulings tests
```
