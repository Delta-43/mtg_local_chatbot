import { describe, expect, it, vi } from "vitest";
import { RateLimiter } from "../src/services/rate-limiter.js";

describe("RateLimiter 429 handling", () => {
  it("records retry-after as the next request window without sleeping immediately", async () => {
    vi.useFakeTimers();
    try {
      const limiter = new RateLimiter(100, 3, 2, 1_000);
      const baseTime = Date.now();
      const startedAt: number[] = [];

      const first = limiter.execute(async () => {
        startedAt.push(Date.now() - baseTime);
        limiter.recordError(429);
        limiter.handleRateLimitResponse("1");
        return "rate-limited";
      });

      const second = limiter.execute(async () => {
        startedAt.push(Date.now() - baseTime);
        return "next";
      });

      await vi.advanceTimersByTimeAsync(0);
      await expect(first).resolves.toBe("rate-limited");
      expect(startedAt).toEqual([0]);

      await vi.advanceTimersByTimeAsync(999);
      expect(startedAt).toEqual([0]);

      await vi.advanceTimersByTimeAsync(1);
      await expect(second).resolves.toBe("next");
      expect(startedAt).toEqual([0, 1_000]);

      expect(limiter.isCircuitOpen()).toBe(false);
      expect(limiter.getStatus().consecutiveErrors).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses configured backoff once when a 429 has no retry-after header", async () => {
    vi.useFakeTimers();
    try {
      const limiter = new RateLimiter(100, 3, 2, 1_000);
      const baseTime = Date.now();
      const startedAt: number[] = [];

      const first = limiter.execute(async () => {
        startedAt.push(Date.now() - baseTime);
        limiter.recordError(429);
        limiter.handleRateLimitResponse();
        return "rate-limited";
      });

      const second = limiter.execute(async () => {
        startedAt.push(Date.now() - baseTime);
        return "next";
      });

      await vi.advanceTimersByTimeAsync(0);
      await expect(first).resolves.toBe("rate-limited");

      await vi.advanceTimersByTimeAsync(199);
      expect(startedAt).toEqual([0]);

      await vi.advanceTimersByTimeAsync(1);
      await expect(second).resolves.toBe("next");
      expect(startedAt).toEqual([0, 200]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears pending 429 throttle state on reset", async () => {
    vi.useFakeTimers();
    try {
      const limiter = new RateLimiter(100, 3, 2, 1_000);
      const baseTime = Date.now();
      const startedAt: number[] = [];

      limiter.recordError(429);
      limiter.handleRateLimitResponse("5");
      limiter.reset();

      const afterReset = limiter.execute(async () => {
        startedAt.push(Date.now() - baseTime);
        return "after-reset";
      });

      await vi.advanceTimersByTimeAsync(0);
      await expect(afterReset).resolves.toBe("after-reset");
      expect(startedAt).toEqual([0]);
    } finally {
      vi.useRealTimers();
    }
  });
});
