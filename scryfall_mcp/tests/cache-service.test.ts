import { afterEach, describe, expect, it, vi } from "vitest";
import { CacheService } from "../src/services/cache-service.js";

describe("CacheService", () => {
  const caches: CacheService[] = [];

  afterEach(() => {
    caches.forEach((cache) => cache.destroy());
    caches.length = 0;
  });

  it("decrements memory usage when an expired entry is removed via get", async () => {
    const cache = new CacheService(60_000, 100, 10);
    caches.push(cache);

    cache.set("expired-key", { payload: "x".repeat(100_000) }, 5);
    const beforeExpiry = cache.getStats();

    expect(beforeExpiry.size).toBe(1);
    expect(beforeExpiry.memoryUsage).toBeGreaterThan(0);

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(cache.get("expired-key")).toBeNull();

    const afterExpiry = cache.getStats();
    expect(afterExpiry.size).toBe(0);
    expect(afterExpiry.memoryUsage).toBe(0);
  });

  it("reuses the stored entry size instead of reserializing cached objects on delete", () => {
    const cache = new CacheService(60_000, 100, 10);
    caches.push(cache);

    let serializeCount = 0;
    const payload = {
      value: "cached",
      toJSON() {
        serializeCount++;
        return { value: "cached" };
      },
    };

    cache.set("json-key", payload, 60_000);
    expect(serializeCount).toBe(0);

    cache.delete("json-key");
    expect(serializeCount).toBe(0);
    expect(cache.getStats().memoryUsage).toBe(0);
  });

  it("updates access ordering so gets preserve recently used entries during eviction", () => {
    const cache = new CacheService(60_000, 2, 10);
    caches.push(cache);

    cache.set("a", { value: "alpha" }, 60_000);
    cache.set("b", { value: "beta" }, 60_000);

    expect(cache.get("a")).toEqual({ value: "alpha" });

    cache.set("c", { value: "gamma" }, 60_000);

    expect(cache.get("a")).toEqual({ value: "alpha" });
    expect(cache.get("b")).toBeNull();
    expect(cache.get("c")).toEqual({ value: "gamma" });
  });

  it("updates recency by moving accessed entries to the back of map iteration order", () => {
    const cache = new CacheService(60_000, 2, 10);
    caches.push(cache);

    cache.set("a", { value: "alpha" }, 60_000);
    cache.set("b", { value: "beta" }, 60_000);
    cache.get("a");

    const keys = Array.from(
      (cache as unknown as { cache: Map<string, unknown> }).cache.keys()
    );
    expect(keys).toEqual(["b", "a"]);

    cache.set("c", { value: "gamma" }, 60_000);
    expect(cache.get("a")).toEqual({ value: "alpha" });
    expect(cache.get("b")).toBeNull();
  });

  it("accepts an explicit size hint so large cached objects do not require JSON serialization", () => {
    const cache = new CacheService(60_000, 100, 10);
    caches.push(cache);

    let serializeCount = 0;
    const payload = {
      toJSON() {
        serializeCount++;
        return { value: "large" };
      },
    };

    cache.set("hinted", payload, 60_000, { sizeBytes: 256 });

    expect(serializeCount).toBe(0);
    expect(cache.getStats().memoryUsage).toBeGreaterThan(0);
  });

  it("evicts least-recently-used entries from map order", () => {
    const cache = new CacheService(60_000, 10, 1);
    caches.push(cache);

    cache.set("a", "a".repeat(150_000), 60_000);
    cache.set("b", "b".repeat(150_000), 60_000);
    cache.set("c", "c".repeat(150_000), 60_000);
    expect(cache.get("c")).toBe("c".repeat(150_000));

    cache.set("large", "large".repeat(60_000), 60_000);

    expect(cache.get("large")).toBe("large".repeat(60_000));
    expect(cache.get("c")).toBe("c".repeat(150_000));
    expect(cache.get("a")).toBeNull();
  });

  it("estimates object size without invoking toJSON when no size hint is provided", () => {
    const cache = new CacheService(60_000, 100, 10);
    caches.push(cache);

    let serializeCount = 0;
    const payload = {
      nested: { value: "cached" },
      toJSON() {
        serializeCount++;
        return { nested: { value: "cached" } };
      },
    };

    cache.set("json-key", payload, 60_000);

    expect(serializeCount).toBe(0);
    expect(cache.getStats().memoryUsage).toBeGreaterThan(0);
  });

  it("does not cache entries larger than maxMemoryBytes and leaves memory accounting unchanged", () => {
    const cache = new CacheService(60_000, 100, 1);
    caches.push(cache);

    cache.set("small", "s".repeat(100_000), 60_000);
    const beforeOversized = cache.getStats();
    expect(cache.get("small")).toBe("s".repeat(100_000));

    cache.set("oversized", "o".repeat(700_000), 60_000);

    const afterOversized = cache.getStats();
    expect(cache.get("oversized")).toBeNull();
    expect(afterOversized.size).toBe(beforeOversized.size);
    expect(afterOversized.memoryUsage).toBe(beforeOversized.memoryUsage);
  });
});
