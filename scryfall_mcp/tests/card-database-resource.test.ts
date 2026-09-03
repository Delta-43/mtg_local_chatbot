import { access } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CardDatabaseResource } from "../src/resources/card-database.js";
import { CacheService } from "../src/services/cache-service.js";
import { mcpLogger } from "../src/services/logger.js";
import { BulkDataInfo, ScryfallCard } from "../src/types/scryfall-api.js";

function createMockCard(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    object: "card",
    id: "card-id",
    oracle_id: "oracle-id",
    name: "Lightning Bolt",
    lang: "en",
    released_at: "2026-04-19",
    uri: "https://api.scryfall.com/cards/card-id",
    scryfall_uri: "https://scryfall.com/card/lea/161/lightning-bolt",
    layout: "normal",
    highres_image: true,
    image_status: "highres_scan",
    mana_cost: "{R}",
    cmc: 1,
    type_line: "Instant",
    oracle_text: "Lightning Bolt deals 3 damage to any target.",
    colors: ["R"],
    color_identity: ["R"],
    keywords: [],
    legalities: {
      standard: "not_legal",
      future: "not_legal",
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
      standardbrawl: "not_legal",
      brawl: "not_legal",
      historicbrawl: "legal",
      alchemy: "not_legal",
      paupercommander: "legal",
      duel: "legal",
      oldschool: "not_legal",
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
    set: "lea",
    set_name: "Limited Edition Alpha",
    set_type: "core",
    set_uri: "https://api.scryfall.com/sets/lea",
    set_search_uri: "https://api.scryfall.com/cards/search?order=set&q=e%3Alea&unique=prints",
    scryfall_set_uri: "https://scryfall.com/sets/lea",
    rulings_uri: "https://api.scryfall.com/cards/card-id/rulings",
    prints_search_uri: "https://api.scryfall.com/cards/search?order=released&q=oracleid%3Aoracle-id&unique=prints",
    collector_number: "161",
    digital: false,
    rarity: "common",
    border_color: "black",
    frame: "1993",
    full_art: false,
    textless: false,
    booster: true,
    story_spotlight: false,
    prices: {
      usd: "1.00",
      eur: "0.80",
      tix: "0.02",
    },
    related_uris: {
      edhrec: "https://edhrec.com/route/?cc=Lightning+Bolt",
    },
    ...overrides,
  };
}

function createBulkInfo(updatedAt: string): BulkDataInfo {
  return {
    object: "bulk_data",
    id: "bulk-id",
    type: "oracle_cards",
    updated_at: updatedAt,
    uri: "https://api.scryfall.com/bulk-data/bulk-id",
    name: "Oracle Cards",
    description: "A JSON file containing one Scryfall card object for each Oracle ID on Scryfall.",
    size: 1024,
    download_uri: "https://data.scryfall.io/oracle-cards/oracle-cards-2026-04-19.json",
    content_type: "application/json",
    content_encoding: "gzip",
  };
}

describe("CardDatabaseResource", () => {
  let cache: CacheService;
  let resource: CardDatabaseResource;
  let getBulkDataInfo: ReturnType<typeof vi.fn>;
  let streamBulkData: ReturnType<typeof vi.fn>;
  let mockBulkInfo: BulkDataInfo;
  let mockCards: ScryfallCard[];

  beforeEach(() => {
    cache = new CacheService(60_000, 100, 250);
    mockBulkInfo = createBulkInfo("2026-04-19T00:00:00Z");
    mockCards = [createMockCard(), createMockCard({ id: "card-id-2", oracle_id: "oracle-id-2", name: "Counterspell" })];
    getBulkDataInfo = vi.fn().mockResolvedValue([mockBulkInfo]);
    streamBulkData = vi.fn().mockImplementation(async function* () {
      yield* mockCards;
    });

    resource = new CardDatabaseResource(
      {
        getBulkDataInfo,
        streamBulkData,
      } as never,
      cache
    );
  });

  afterEach(async () => {
    await resource.destroy();
    cache.destroy();
  });

  it("builds one serialized snapshot on cold read and caches the final string", async () => {
    const result = await resource.getData();

    expect(getBulkDataInfo).toHaveBeenCalledTimes(1);
    expect(streamBulkData).toHaveBeenCalledTimes(1);
    expect(typeof result).toBe("string");

    const parsed = JSON.parse(result);
    expect(parsed.type).toBe("oracle_cards");
    expect(parsed.updated_at).toBe(mockBulkInfo.updated_at);
    expect(parsed.total_cards).toBe(mockCards.length);
    expect(parsed.data).toHaveLength(mockCards.length);

    const payloadKey = CacheService.createBulkKey("cards:serialized");
    expect(cache.get<string>(payloadKey)).toEqual(result);
  });

  it("returns the cached string directly on warm reads without wrapping it again", async () => {
    const first = await resource.getData();
    const second = await resource.getData();

    expect(streamBulkData).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);

    const secondParsed = JSON.parse(second);
    expect(secondParsed.total_cards).toBe(mockCards.length);
    expect(Array.isArray(secondParsed.data)).toBe(true);
  });

  it("refreshes when oracle_cards.updated_at changes", async () => {
    const original = await resource.getData();
    expect(JSON.parse(original).updated_at).toBe("2026-04-19T00:00:00Z");

    const refreshedBulkInfo = createBulkInfo("2026-04-20T00:00:00Z");
    getBulkDataInfo.mockResolvedValue([refreshedBulkInfo]);
    streamBulkData.mockImplementationOnce(async function* () {
      yield* mockCards;
    });
    (resource as unknown as { lastUpdateCheck: number }).lastUpdateCheck = 0;

    const refreshed = await resource.getData();

    expect(streamBulkData).toHaveBeenCalledTimes(2);
    expect(JSON.parse(refreshed).updated_at).toBe("2026-04-20T00:00:00Z");
  });

  it("serves stale cache when refresh fails after newer metadata is detected", async () => {
    const originalPayload = await resource.getData();

    getBulkDataInfo.mockResolvedValue([createBulkInfo("2026-04-20T00:00:00Z")]);
    streamBulkData.mockImplementationOnce(async function* () {
      throw new Error("download failed");
    });
    (resource as unknown as { lastUpdateCheck: number }).lastUpdateCheck = 0;

    await expect(resource.getData()).resolves.toEqual(originalPayload);
    expect(streamBulkData).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent cold reads into one rebuild", async () => {
    let resolveStreamStart: (() => void) | undefined;
    streamBulkData.mockImplementationOnce(async function* () {
      await new Promise<void>((resolve) => {
        resolveStreamStart = resolve;
      });
      yield* mockCards;
    });

    const firstPromise = resource.getData();
    const secondPromise = resource.getData();

    await vi.waitFor(() => {
      expect(streamBulkData).toHaveBeenCalledTimes(1);
    });

    resolveStreamStart?.();

    const [first, second] = await Promise.all([firstPromise, secondPromise]);

    expect(first).toEqual(second);
    expect(streamBulkData).toHaveBeenCalledTimes(1);
  });

  it("serializes filtered streamed cards into the final payload shape", async () => {
    const payload = await resource.getData();
    const parsed = JSON.parse(payload);

    expect(parsed.updated_at).toBe(mockBulkInfo.updated_at);
    expect(parsed.total_cards).toBe(mockCards.length);
    expect(parsed.data[0].name).toBe("Lightning Bolt");
  });

  it("reports builder diagnostics after rebuilding and caching the serialized snapshot", async () => {
    await resource.getData();

    const diagnostics = (
      resource as unknown as {
        getLastBuildDiagnostics: () => {
          totalCards: number;
          retainedChunks: number;
          payloadBytes: number;
          cached: boolean;
          oversizeReason?: string;
        };
      }
    ).getLastBuildDiagnostics();

    expect(diagnostics.totalCards).toBe(mockCards.length);
    expect(diagnostics.retainedChunks).toBeLessThanOrEqual(mockCards.length);
    expect(diagnostics.payloadBytes).toBeGreaterThan(0);
    expect(diagnostics.cached).toBe(true);
    expect(diagnostics.oversizeReason).toBeUndefined();
  });

  it("reports oversized snapshots that cannot be retained in the in-memory cache", async () => {
    cache.destroy();
    cache = new CacheService(60_000, 100, 0.0001);
    resource = new CardDatabaseResource(
      {
        getBulkDataInfo,
        streamBulkData,
      } as never,
      cache
    );
    const warnSpy = vi.spyOn(mcpLogger, "warn").mockImplementation(() => undefined);

    const payload = await resource.getData();

    expect(JSON.parse(payload).total_cards).toBe(mockCards.length);
    expect(cache.get<string>(CacheService.createBulkKey("cards:serialized"))).toBeNull();

    const diagnostics = (
      resource as unknown as {
        getLastBuildDiagnostics: () => {
          totalCards: number;
          retainedChunks: number;
          payloadBytes: number;
          cached: boolean;
          oversizeReason?: string;
        };
      }
    ).getLastBuildDiagnostics();

    expect(diagnostics.totalCards).toBe(mockCards.length);
    expect(diagnostics.retainedChunks).toBe(0);
    expect(diagnostics.payloadBytes).toBeGreaterThan(cache.getStats().maxMemoryBytes);
    expect(diagnostics.cached).toBe(false);
    expect(diagnostics.oversizeReason).toContain("exceeds cache memory limit");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "bulk_snapshot_cache",
        payloadBytes: diagnostics.payloadBytes,
      }),
      "Bulk snapshot exceeds in-memory cache limit"
    );

    warnSpy.mockRestore();
  });

  it("serves oversized snapshots from disk on warm reads without rebuilding", async () => {
    cache.destroy();
    cache = new CacheService(60_000, 100, 0.0001);
    resource = new CardDatabaseResource(
      {
        getBulkDataInfo,
        streamBulkData,
      } as never,
      cache
    );

    const first = await resource.getData();
    const second = await resource.getData();

    expect(second).toEqual(first);
    expect(streamBulkData).toHaveBeenCalledTimes(1);
    expect(cache.get<string>(CacheService.createBulkKey("cards:serialized"))).toBeNull();
  });

  it("removes oversized disk snapshots when destroyed", async () => {
    cache.destroy();
    cache = new CacheService(60_000, 100, 0.0001);
    resource = new CardDatabaseResource(
      {
        getBulkDataInfo,
        streamBulkData,
      } as never,
      cache
    );

    await resource.getData();

    const snapshot = (resource as unknown as { diskSnapshot?: { path: string } }).diskSnapshot;
    expect(snapshot?.path).toBeTruthy();
    await expect(access(snapshot!.path)).resolves.toBeUndefined();

    await resource.destroy();

    await expect(access(snapshot!.path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("exposes bulk cache retention diagnostics in resource metadata", async () => {
    await resource.getData();

    const metadata = resource.getMetadata() as {
      last_build: {
        totalCards: number;
        payloadBytes: number;
        cached: boolean;
      };
      cache_ttl_remaining: number | null;
    };

    expect(metadata.last_build.totalCards).toBe(mockCards.length);
    expect(metadata.last_build.payloadBytes).toBeGreaterThan(0);
    expect(metadata.last_build.cached).toBe(true);
    expect(metadata.cache_ttl_remaining).toBeGreaterThan(0);
  });

  it("forceRefresh clears the cached snapshot and rebuilds it", async () => {
    await resource.getData();

    await resource.forceRefresh();

    expect(streamBulkData).toHaveBeenCalledTimes(2);
    expect(getBulkDataInfo).toHaveBeenCalledTimes(2);
  });
});
