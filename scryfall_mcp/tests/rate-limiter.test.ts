import { describe, expect, it, vi, afterEach } from "vitest";
import { RateLimiter } from "../src/services/rate-limiter.js";
import { RateLimitError } from "../src/types/mcp-types.js";

describe("RateLimiter", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows one recovery probe after the circuit cooldown", async () => {
    vi.useFakeTimers();
    const limiter = new RateLimiter(100, 3, 2, 1_000);

    limiter.recordError(500);
    limiter.recordError(500);
    limiter.recordError(500);

    expect(limiter.isCircuitOpen()).toBe(true);

    await vi.advanceTimersByTimeAsync(999);
    expect(limiter.isCircuitOpen()).toBe(true);

    await vi.advanceTimersByTimeAsync(1);
    expect(limiter.isCircuitOpen()).toBe(false);

    limiter.recordSuccess();
    expect(limiter.getStatus().consecutiveErrors).toBe(0);
  });

  it("does not start the next queued operation until the prior one completes", async () => {
    const limiter = new RateLimiter(0, 3, 2, 100);
    const started: string[] = [];
    let releaseFirst: (() => void) | undefined;

    const first = limiter.execute(async () => {
      started.push("first");
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      return "done";
    });

    const second = limiter.execute(async () => {
      started.push("second");
      return "done";
    });

    await Promise.resolve();

    expect(started).toEqual(["first"]);

    releaseFirst?.();

    await expect(first).resolves.toBe("done");
    await expect(second).resolves.toBe("done");
    expect(started).toEqual(["first", "second"]);
  });

  it("applies updated backoff from a prior queued failure before starting the next request", async () => {
    vi.useFakeTimers();

    const limiter = new RateLimiter(10, 3, 2, 100);
    const baseTime = Date.now();
    const startedAt: number[] = [];

    const first = limiter.execute(async () => {
      startedAt.push(Date.now() - baseTime);
      limiter.recordError(429);
      return "failed";
    });

    const second = limiter.execute(async () => {
      startedAt.push(Date.now() - baseTime);
      return "ok";
    });

    await vi.advanceTimersByTimeAsync(0);
    await expect(first).resolves.toBe("failed");
    expect(startedAt).toEqual([0]);

    await vi.advanceTimersByTimeAsync(19);
    expect(startedAt).toEqual([0]);

    await vi.advanceTimersByTimeAsync(1);
    await expect(second).resolves.toBe("ok");
    expect(startedAt).toEqual([0, 20]);
  });

  it("rejects queued and sleeping operations when reset is called, then resumes safely", async () => {
    vi.useFakeTimers();

    const limiter = new RateLimiter(100, 3, 2, 1000);
    const postResetStarted: string[] = [];
    let releasePostResetFirst: (() => void) | undefined;

    const first = limiter.execute(async () => "first");
    const sleeping = limiter.execute(async () => "should-not-run");
    const queued = limiter.execute(async () => "should-not-run");

    await vi.advanceTimersByTimeAsync(0);
    await expect(first).resolves.toBe("first");

    limiter.reset();

    await expect(sleeping).rejects.toBeInstanceOf(RateLimitError);
    await expect(queued).rejects.toBeInstanceOf(RateLimitError);

    const postResetFirst = limiter.execute(async () => {
      postResetStarted.push("first");
      await new Promise<void>((resolve) => {
        releasePostResetFirst = resolve;
      });
      return "post-reset-first";
    });

    const postResetSecond = limiter.execute(async () => {
      postResetStarted.push("second");
      return "post-reset-second";
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(postResetStarted).toEqual(["first"]);

    releasePostResetFirst?.();
    await vi.advanceTimersByTimeAsync(100);

    await expect(postResetFirst).resolves.toBe("post-reset-first");
    await expect(postResetSecond).resolves.toBe("post-reset-second");
    expect(postResetStarted).toEqual(["first", "second"]);
  });
});
