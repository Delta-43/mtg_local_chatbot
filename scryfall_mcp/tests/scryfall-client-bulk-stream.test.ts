import { afterEach, describe, expect, it, vi } from "vitest";
import { iterateArrayStream } from "../src/services/bulk-json-stream.js";
import { ScryfallClient } from "../src/services/scryfall-client.js";

function chunkedBody(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

describe("iterateArrayStream", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("yields top-level array items from a chunked JSON body", async () => {
    const values: Array<{ id: string }> = [];

    for await (const value of iterateArrayStream<{ id: string }>(
      chunkedBody(['[{"id":"a"},', '{"id":"b"}', "]"])
    )) {
      values.push(value);
    }

    expect(values).toEqual([{ id: "a" }, { id: "b" }]);
  });

  it("does not count downstream processing time against the bulk stream idle timeout", async () => {
    vi.useFakeTimers();
    const previousTimeout = process.env.SCRYFALL_TIMEOUT_MS;
    process.env.SCRYFALL_TIMEOUT_MS = "1000";
    let requestSignal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((_url, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined;
      return Promise.resolve({
        status: 200,
        body: chunkedBody(['[{"id":"a"},{"id":"b"}]']),
      });
    }));

    const client = new ScryfallClient();
    const cards = client.streamBulkData("https://data.scryfall.io/oracle-cards.json");

    try {
      await expect(cards.next()).resolves.toMatchObject({ value: { id: "a" }, done: false });
      await vi.advanceTimersByTimeAsync(2_001);
      expect(requestSignal?.aborted).toBe(false);
      await expect(cards.next()).resolves.toMatchObject({ value: { id: "b" }, done: false });
    } finally {
      await cards.return(undefined);
      client.destroy();
      if (previousTimeout === undefined) {
        delete process.env.SCRYFALL_TIMEOUT_MS;
      } else {
        process.env.SCRYFALL_TIMEOUT_MS = previousTimeout;
      }
    }
  });
});
