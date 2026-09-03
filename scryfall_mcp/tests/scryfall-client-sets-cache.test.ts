import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScryfallClient } from "../src/services/scryfall-client.js";
import { CacheService } from "../src/services/cache-service.js";
import { RateLimiter } from "../src/services/rate-limiter.js";
import type { ScryfallSet } from "../src/types/scryfall-api.js";

function createSet(overrides: Partial<ScryfallSet> = {}): ScryfallSet {
  return {
    object: "set",
    id: "set-id",
    code: "tst",
    name: "Test Set",
    set_type: "expansion",
    released_at: "2024-01-01",
    card_count: 200,
    digital: false,
    foil_only: false,
    nonfoil_only: false,
    scryfall_uri: "https://scryfall.com/sets/tst",
    uri: "https://api.scryfall.com/sets/tst",
    icon_svg_uri: "https://svgs.scryfall.io/sets/default.svg",
    search_uri: "https://api.scryfall.com/cards/search?q=e%3Atst",
    ...overrides,
  };
}

function createSetListResponse(data: ScryfallSet[]) {
  return {
    object: "list" as const,
    has_more: false,
    data,
  };
}

describe("ScryfallClient.getSets", () => {
  let cache: CacheService;
  let fetchMock: ReturnType<typeof vi.fn>;
  let client: ScryfallClient;

  beforeEach(() => {
    cache = new CacheService(60_000, 100, 25);
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    client = new ScryfallClient(new RateLimiter(), cache, "test-agent");
  });

  afterEach(() => {
    cache.destroy();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not reuse a cached date-filtered result for a different date window", async () => {
    const sets = [
      createSet({ code: "old", name: "Old Set", released_at: "2020-01-01" }),
      createSet({ id: "set-new", code: "new", name: "New Set", released_at: "2025-01-01" }),
    ];

    fetchMock.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue(createSetListResponse(sets)),
    });

    const recent = await client.getSets({ released_after: "2024-01-01" });
    const older = await client.getSets({ released_before: "2021-01-01" });

    expect(recent.map((set) => set.code)).toEqual(["new"]);
    expect(older.map((set) => set.code)).toEqual(["old"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reuses a cached filtered set view for repeated identical filters", async () => {
    const sets = [
      createSet({ code: "old", name: "Old Set", released_at: "2020-01-01" }),
      createSet({ id: "set-new", code: "new", name: "New Set", released_at: "2025-01-01" }),
    ];

    fetchMock.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue(createSetListResponse(sets)),
    });

    const first = await client.getSets({ released_after: "2024-01-01" });
    const second = await client.getSets({ released_after: "2024-01-01" });

    expect(first).toBe(second);
    expect(second.map((set) => set.code)).toEqual(["new"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
