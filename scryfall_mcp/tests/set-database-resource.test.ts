import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SetDatabaseResource } from "../src/resources/set-database.js";
import { CacheService } from "../src/services/cache-service.js";
import { ScryfallClient } from "../src/services/scryfall-client.js";
import type { ScryfallSet } from "../src/types/scryfall-api.js";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

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

describe("SetDatabaseResource", () => {
  let cache: CacheService;

  beforeEach(() => {
    cache = new CacheService(60_000, 100, 25);
  });

  afterEach(() => {
    cache.destroy();
    vi.restoreAllMocks();
  });

  it("filters sets without routing through getData serialization", async () => {
    const sets = [
      createSet(),
      createSet({ id: "set-2", code: "dig", name: "Digital Set", digital: true, set_type: "alchemy" }),
    ];
    const resource = new SetDatabaseResource(
      {
        getSets: vi.fn().mockImplementation(async (filters?: { digital?: boolean }) =>
          filters?.digital === undefined ? sets : sets.filter((set) => set.digital === filters.digital)
        ),
      } as never,
      cache
    );

    vi.spyOn(resource, "getData").mockRejectedValue(new Error("getData should not be called"));

    const result = await resource.getFilteredSets({ digital: true });
    const parsed = JSON.parse(result);

    expect(parsed.total_sets).toBe(1);
    expect(parsed.data[0].name).toBe("Digital Set");
  });

  it("shares string-based release filtering with the client path", async () => {
    const sets = [
      createSet({ id: "set-old", code: "old", name: "Old Set", released_at: "2020-01-01" }),
      createSet({ id: "set-new", code: "new", name: "New Set", released_at: "2025-01-01" }),
    ];
    const resource = new SetDatabaseResource(
      {
        getSets: vi.fn().mockImplementation(async (filters?: { released_after?: string }) =>
          !filters?.released_after
            ? sets
            : sets.filter((set) => Boolean(set.released_at && set.released_at >= filters.released_after!))
        ),
      } as never,
      cache
    );

    const result = await resource.getFilteredSets({ released_after: "2024-01-01" });
    const parsed = JSON.parse(result);

    expect(parsed.total_sets).toBe(1);
    expect(parsed.data.map((set: ScryfallSet) => set.code)).toEqual(["new"]);
  });

  it("isolates serialized resource filter cache from client filtered set cache", async () => {
    const sets = [
      createSet({ id: "set-old", code: "old", name: "Old Set", released_at: "2020-01-01" }),
      createSet({ id: "set-new", code: "new", name: "New Set", released_at: "2025-01-01" }),
    ];
    const getSets = vi.fn().mockResolvedValue(sets);
    const resource = new SetDatabaseResource({ getSets } as never, cache);

    const first = await resource.getFilteredSets({ released_after: "2024-01-01" });
    const second = await resource.getFilteredSets({ released_after: "2024-01-01" });

    expect(first).toBe(second);
    expect(getSets).toHaveBeenCalledTimes(1);
    expect(
      cache.get<ScryfallSet[]>(CacheService.createSetFilterKey({ released_after: "2024-01-01" }))
    ).toBeNull();
  });

  it("filters from a client-shaped shared set cache entry", async () => {
    const sets = [
      createSet({ id: "set-old", code: "old", name: "Old Set", released_at: "2020-01-01" }),
      createSet({ id: "set-new", code: "new", name: "New Set", released_at: "2025-01-01" }),
    ];
    const getSets = vi.fn().mockRejectedValue(new Error("shared cache should satisfy resource read"));
    cache.setWithType(CacheService.createSetKey(), { data: sets }, "set_data");
    const resource = new SetDatabaseResource({ getSets } as never, cache);

    const result = await resource.getFilteredSets({ released_after: "2024-01-01" });
    const parsed = JSON.parse(result);

    expect(parsed.total_sets).toBe(1);
    expect(parsed.data.map((set: ScryfallSet) => set.code)).toEqual(["new"]);
    expect(getSets).not.toHaveBeenCalled();
  });

  it("caches serialized filtered set payloads by filter signature", async () => {
    let serializeCount = 0;
    const resource = new SetDatabaseResource(
      {
        getSets: vi.fn().mockResolvedValue([
          createSet({
            id: "set-digital",
            code: "dig",
            name: "Digital Set",
            digital: true,
            toJSON() {
              serializeCount++;
              return this;
            },
          }),
        ]),
      } as never,
      cache
    );

    const first = await resource.getFilteredSets({ digital: true });
    const second = await resource.getFilteredSets({ digital: true });

    expect(first).toBe(second);
    expect(serializeCount).toBe(1);
  });

  it("collects set types from cached set models without parsing the serialized payload", async () => {
    const resource = new SetDatabaseResource(
      {
        getSets: vi.fn().mockResolvedValue([
          createSet(),
          createSet({ id: "set-2", code: "cmd", set_type: "commander" }),
          createSet({ id: "set-3", code: "alc", set_type: "alchemy" }),
        ]),
      } as never,
      cache
    );

    vi.spyOn(resource, "getData").mockRejectedValue(new Error("getData should not be called"));

    await expect(resource.getSetTypes()).resolves.toEqual(["alchemy", "commander", "expansion"]);
  });

  it("caches the serialized payload and returns the prebuilt snapshot on warm reads", async () => {
    const getSets = vi.fn().mockResolvedValue([
      createSet(),
      createSet({ id: "set-2", code: "cmd", set_type: "commander" }),
    ]);

    const resource = new SetDatabaseResource(
      {
        getSets,
      } as never,
      cache
    );

    const first = await resource.getData();
    const second = await resource.getData();

    expect(getSets).toHaveBeenCalledTimes(1);
    expect(typeof second).toBe("string");
    expect(first).toBe(second);
    expect(JSON.parse(second).total_sets).toBe(2);
    expect(JSON.parse(second).source).toBeUndefined();
  });

  it("serves a stale snapshot when a scheduled refresh fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
    const staleSets = [createSet({ id: "stale-id", code: "old", name: "Stale Set" })];
    const freshSets = [createSet({ id: "fresh-id", code: "new", name: "Fresh Set" })];
    const getSets = vi.fn()
      .mockResolvedValueOnce(staleSets)
      .mockRejectedValueOnce(new Error("upstream unavailable"))
      .mockResolvedValueOnce(freshSets);
    const resource = new SetDatabaseResource({ getSets } as never, cache);

    try {
      const stalePayload = await resource.getData();
      vi.advanceTimersByTime(8 * 24 * 60 * 60 * 1000);

      await expect(resource.getData()).resolves.toBe(stalePayload);
      expect(getSets).toHaveBeenCalledTimes(2);
      expect(cache.get(CacheService.createSetKey("serialized"))).toBe(stalePayload);

      vi.advanceTimersByTime(5 * 60 * 1000);
      const refreshedPayload = await resource.getData();
      expect(getSets).toHaveBeenCalledTimes(3);
      expect(JSON.parse(refreshedPayload).data[0].name).toBe("Fresh Set");
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves the current snapshot when force refresh fails", async () => {
    const sets = [createSet({ id: "current-id", code: "cur", name: "Current Set" })];
    const getSets = vi.fn()
      .mockResolvedValueOnce(sets)
      .mockRejectedValueOnce(new Error("forced refresh failed"));
    const resource = new SetDatabaseResource({ getSets } as never, cache);
    const currentPayload = await resource.getData();

    await expect(resource.forceRefresh()).rejects.toThrow("forced refresh failed");
    expect(cache.get(CacheService.createSetKey("serialized"))).toBe(currentPayload);
    expect(cache.get(CacheService.createSetKey())).not.toBeNull();
  });

  it("serves stale set models to filtered reads after refresh failure", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
    const sets = [createSet({ id: "stale-id", code: "old", name: "Stale Set" })];
    const getSets = vi.fn()
      .mockResolvedValueOnce(sets)
      .mockRejectedValueOnce(new Error("upstream unavailable"));
    const resource = new SetDatabaseResource({ getSets } as never, cache);

    try {
      await resource.getData();
      vi.advanceTimersByTime(8 * 24 * 60 * 60 * 1000);

      const filtered = JSON.parse(await resource.getFilteredSets({ query: "stale" }));
      expect(filtered.data.map((set: ScryfallSet) => set.name)).toEqual(["Stale Set"]);
      expect(getSets).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("serializes force refresh behind an in-flight refresh", async () => {
    const first = createDeferred<ScryfallSet[]>();
    const second = createDeferred<ScryfallSet[]>();
    const getSets = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const resource = new SetDatabaseResource({ getSets } as never, cache);
    const scheduledRefresh = resource.getData();

    await vi.waitFor(() => expect(getSets).toHaveBeenCalledTimes(1));
    const forcedRefresh = resource.forceRefresh();

    try {
      await Promise.resolve();
      expect(getSets).toHaveBeenCalledTimes(1);

      first.resolve([createSet({ id: "older-id", code: "old", name: "Older Set" })]);
      await scheduledRefresh;
      await vi.waitFor(() => expect(getSets).toHaveBeenCalledTimes(2));

      second.resolve([createSet({ id: "newer-id", code: "new", name: "Newer Set" })]);
      await forcedRefresh;

      const finalPayload = JSON.parse(await resource.getData());
      expect(finalPayload.data[0].name).toBe("Newer Set");
    } finally {
      first.resolve([]);
      second.resolve([]);
      await Promise.allSettled([scheduledRefresh, forcedRefresh]);
    }
  });

  it("warms the shared raw set cache in the client-compatible shape", async () => {
    const sets = [
      createSet(),
      createSet({ id: "set-2", code: "cmd", set_type: "commander" }),
    ];
    const resource = new SetDatabaseResource(
      {
        getSets: vi.fn().mockResolvedValue(sets),
      } as never,
      cache
    );
    const fetchMock = vi.fn().mockRejectedValue(new Error("shared cache should satisfy client reads"));
    vi.stubGlobal("fetch", fetchMock);
    const client = new ScryfallClient(
      {
        execute: vi.fn(async (operation: () => Promise<unknown>) => operation()),
        recordSuccess: vi.fn(),
        recordError: vi.fn(),
        handleRateLimitResponse: vi.fn(),
        isCircuitOpen: vi.fn().mockReturnValue(false),
      } as never,
      cache,
      "test-agent"
    );

    await resource.getData();
    const clientSets = await client.getSets();

    expect(clientSets).toEqual(sets);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("keeps icon_svg_uri without downloading and embedding icon payloads", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const resource = new SetDatabaseResource(
      {
        getSets: vi.fn().mockResolvedValue([
          createSet({ icon_svg_uri: "https://svgs.scryfall.io/sets/tst.svg" }),
        ]),
      } as never,
      cache
    );

    const payload = JSON.parse(await resource.getData());

    expect(fetchMock).not.toHaveBeenCalled();
    expect(payload.data[0].icon_svg_uri).toBe("https://svgs.scryfall.io/sets/tst.svg");
    expect(payload.data[0].icon_base64).toBeUndefined();
    vi.unstubAllGlobals();
  });
});
