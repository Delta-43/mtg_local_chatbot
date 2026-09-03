import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CacheService } from "../src/services/cache-service.js";
import { ScryfallClient } from "../src/services/scryfall-client.js";
import type { ScryfallCard, ScryfallSearchResponse } from "../src/types/scryfall-api.js";

function createCard(index: number): ScryfallCard {
  return {
    object: "card",
    id: `card-${index}`,
    oracle_id: `oracle-${index}`,
    name: `Card ${index}`,
    lang: "en",
    released_at: "2026-04-22",
    uri: `https://api.scryfall.com/cards/card-${index}`,
    scryfall_uri: `https://scryfall.com/card/tst/${index}/card-${index}`,
    layout: "normal",
    highres_image: true,
    image_status: "highres_scan",
    cmc: 1,
    type_line: "Creature — Test",
    colors: ["U"],
    color_identity: ["U"],
    keywords: [],
    legalities: {
      standard: "legal",
      future: "legal",
      historic: "legal",
      timeless: "legal",
      gladiator: "legal",
      pioneer: "legal",
      explorer: "legal",
      modern: "legal",
      legacy: "legal",
      pauper: "legal",
      vintage: "legal",
      penny: "legal",
      commander: "legal",
      oathbreaker: "legal",
      standardbrawl: "legal",
      brawl: "legal",
      historicbrawl: "legal",
      alchemy: "legal",
      paupercommander: "legal",
      duel: "legal",
      oldschool: "legal",
      premodern: "legal",
      predh: "legal",
    },
    games: ["paper"],
    reserved: false,
    foil: true,
    nonfoil: true,
    finishes: ["foil", "nonfoil"],
    oversized: false,
    promo: false,
    reprint: false,
    variation: false,
    set_id: "set-id",
    set: "tst",
    set_name: "Test Set",
    set_type: "expansion",
    set_uri: "https://api.scryfall.com/sets/tst",
    set_search_uri: "https://api.scryfall.com/cards/search?order=set&q=e%3Atst&unique=prints",
    scryfall_set_uri: "https://scryfall.com/sets/tst",
    rulings_uri: `https://api.scryfall.com/cards/card-${index}/rulings`,
    prints_search_uri: `https://api.scryfall.com/cards/search?order=released&q=oracleid%3Aoracle-${index}&unique=prints`,
    collector_number: `${index}`,
    digital: false,
    rarity: "common",
    border_color: "black",
    frame: "1993",
    full_art: false,
    textless: false,
    booster: true,
    story_spotlight: false,
    prices: {},
    related_uris: {},
  };
}

function createSearchResponse(start: number, count: number, totalCards = 220): ScryfallSearchResponse {
  return {
    object: "list",
    total_cards: totalCards,
    has_more: start + count < totalCards,
    data: Array.from({ length: count }, (_, index) => createCard(start + index)),
  };
}

function createFetchResponse(payload: ScryfallSearchResponse) {
  return {
    status: 200,
    ok: true,
    headers: new Headers(),
    json: vi.fn().mockResolvedValue(payload),
    clone: vi.fn().mockReturnValue({
      text: vi.fn().mockResolvedValue(JSON.stringify(payload)),
    }),
  };
}

describe("ScryfallClient search pagination", () => {
  let cache: CacheService;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    cache = new CacheService(60_000, 100, 25);
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cache.destroy();
    vi.unstubAllGlobals();
  });

  it("maps logical page 2 with a small limit onto the first Scryfall API page", async () => {
    fetchMock.mockResolvedValue({
      ...createFetchResponse(createSearchResponse(0, 175)),
    });

    const client = new ScryfallClient(
      {
        execute: vi.fn(async (operation: () => Promise<unknown>) => operation()),
        waitForClearance: vi.fn().mockResolvedValue(undefined),
        recordSuccess: vi.fn(),
        recordError: vi.fn(),
        handleRateLimitResponse: vi.fn(),
        isCircuitOpen: vi.fn().mockReturnValue(false),
      } as never,
      cache
    );

    const result = await client.searchCards({ query: "type:creature", limit: 20, page: 2 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0].toString()).not.toContain("page=2");
    expect(result.data).toHaveLength(20);
    expect(result.data[0].name).toBe("Card 20");
    expect(result.data[19].name).toBe("Card 39");
    expect(result.has_more).toBe(true);
  });

  it("fetches adjacent Scryfall pages when a logical page spans the API page boundary", async () => {
    fetchMock
      .mockResolvedValueOnce(createFetchResponse(createSearchResponse(0, 175)))
      .mockResolvedValueOnce(createFetchResponse(createSearchResponse(175, 45)));

    const client = new ScryfallClient(
      {
        execute: vi.fn(async (operation: () => Promise<unknown>) => operation()),
        waitForClearance: vi.fn().mockResolvedValue(undefined),
        recordSuccess: vi.fn(),
        recordError: vi.fn(),
        handleRateLimitResponse: vi.fn(),
        isCircuitOpen: vi.fn().mockReturnValue(false),
      } as never,
      cache
    );

    const result = await client.searchCards({ query: "type:creature", limit: 20, page: 9 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0].toString()).toContain("page=2");
    expect(result.data).toHaveLength(20);
    expect(result.data[0].name).toBe("Card 160");
    expect(result.data[19].name).toBe("Card 179");
    expect(result.has_more).toBe(true);
  });

  it("deduplicates warnings collected across fetched API pages", async () => {
    fetchMock
      .mockResolvedValueOnce(
        createFetchResponse({
          ...createSearchResponse(0, 175),
          warnings: ["shared warning", "first page warning"],
        })
      )
      .mockResolvedValueOnce(
        createFetchResponse({
          ...createSearchResponse(175, 45),
          warnings: ["shared warning", "second page warning"],
        })
      );

    const client = new ScryfallClient(
      {
        execute: vi.fn(async (operation: () => Promise<unknown>) => operation()),
        waitForClearance: vi.fn().mockResolvedValue(undefined),
        recordSuccess: vi.fn(),
        recordError: vi.fn(),
        handleRateLimitResponse: vi.fn(),
        isCircuitOpen: vi.fn().mockReturnValue(false),
      } as never,
      cache
    );

    const result = await client.searchCards({ query: "type:creature", limit: 20, page: 9 });

    expect(result.warnings).toEqual([
      "shared warning",
      "first page warning",
      "second page warning",
    ]);
  });

  it("does not reuse cached search results across different sort orders", async () => {
    fetchMock
      .mockResolvedValueOnce(createFetchResponse(createSearchResponse(0, 1, 2)))
      .mockResolvedValueOnce(createFetchResponse(createSearchResponse(100, 1, 2)));

    const client = new ScryfallClient(
      {
        execute: vi.fn(async (operation: () => Promise<unknown>) => operation()),
        waitForClearance: vi.fn().mockResolvedValue(undefined),
        recordSuccess: vi.fn(),
        recordError: vi.fn(),
        handleRateLimitResponse: vi.fn(),
        isCircuitOpen: vi.fn().mockReturnValue(false),
      } as never,
      cache
    );

    const byName = await client.searchCards({ query: "type:creature", limit: 1, order: "name" });
    const byReleased = await client.searchCards({ query: "type:creature", limit: 1, order: "released" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0].toString()).toContain("order=name");
    expect(fetchMock.mock.calls[1][0].toString()).toContain("order=released");
    expect(byName.data[0].name).toBe("Card 0");
    expect(byReleased.data[0].name).toBe("Card 100");
  });

  it("does not reuse cached search results across include_extras changes", async () => {
    fetchMock
      .mockResolvedValueOnce(createFetchResponse(createSearchResponse(0, 1, 2)))
      .mockResolvedValueOnce(createFetchResponse(createSearchResponse(200, 1, 2)));

    const client = new ScryfallClient(
      {
        execute: vi.fn(async (operation: () => Promise<unknown>) => operation()),
        waitForClearance: vi.fn().mockResolvedValue(undefined),
        recordSuccess: vi.fn(),
        recordError: vi.fn(),
        handleRateLimitResponse: vi.fn(),
        isCircuitOpen: vi.fn().mockReturnValue(false),
      } as never,
      cache
    );

    const withoutExtras = await client.searchCards({ query: "type:creature", limit: 1 });
    const withExtras = await client.searchCards({ query: "type:creature", limit: 1, include_extras: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0].toString()).not.toContain("include_extras=true");
    expect(fetchMock.mock.calls[1][0].toString()).toContain("include_extras=true");
    expect(withoutExtras.data[0].name).toBe("Card 0");
    expect(withExtras.data[0].name).toBe("Card 200");
  });

  it("uses the final price-filtered query as the search cache identity", async () => {
    fetchMock.mockResolvedValue(createFetchResponse(createSearchResponse(0, 1, 2)));

    const client = new ScryfallClient(
      {
        execute: vi.fn(async (operation: () => Promise<unknown>) => operation()),
        waitForClearance: vi.fn().mockResolvedValue(undefined),
        recordSuccess: vi.fn(),
        recordError: vi.fn(),
        handleRateLimitResponse: vi.fn(),
        isCircuitOpen: vi.fn().mockReturnValue(false),
      } as never,
      cache
    );

    await client.searchCards({
      query: "type:creature",
      limit: 1,
      price_range: { max: 5, currency: "usd" },
    });
    await client.searchCards({ query: "type:creature usd<=5", limit: 1 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0].toString()).toContain("type%3Acreature+usd%3C%3D5");
  });

  it("coalesces concurrent identical searches into one upstream request", async () => {
    let resolveFetch: ((value: unknown) => void) | undefined;
    fetchMock.mockImplementation(() => new Promise((resolve) => {
      resolveFetch = resolve;
    }));

    const client = new ScryfallClient(
      {
        execute: vi.fn(async (operation: () => Promise<unknown>) => operation()),
        waitForClearance: vi.fn().mockResolvedValue(undefined),
        recordSuccess: vi.fn(),
        recordError: vi.fn(),
        handleRateLimitResponse: vi.fn(),
        isCircuitOpen: vi.fn().mockReturnValue(false),
      } as never,
      cache
    );

    const first = client.searchCards({ query: "type:creature", limit: 20 });
    const second = client.searchCards({ query: "type:creature", limit: 20 });
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch?.(createFetchResponse(createSearchResponse(0, 20)));

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toEqual(secondResult);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
