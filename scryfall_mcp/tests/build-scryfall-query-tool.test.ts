import { describe, expect, it, vi } from "vitest";
import { BuildScryfallQueryTool } from "../src/tools/build-scryfall-query.js";

describe("BuildScryfallQueryTool", () => {
  it("advertises the required nested price budget maximum", () => {
    const tool = new BuildScryfallQueryTool({} as never);

    expect(tool.inputSchema.properties.price_budget.required).toEqual(["max"]);
  });

  it("does not run a live search when test_query is omitted", async () => {
    const searchCards = vi.fn().mockResolvedValue({
      object: "list",
      total_cards: 12,
      has_more: false,
      data: [],
    });

    const tool = new BuildScryfallQueryTool({ searchCards } as never);
    await tool.execute({ natural_query: "blue counterspells under $5 for modern" });

    expect(searchCards).not.toHaveBeenCalled();
  });

  it("runs one live search when test_query is true", async () => {
    const searchCards = vi.fn().mockResolvedValue({
      object: "list",
      total_cards: 12,
      has_more: false,
      data: [],
    });

    const tool = new BuildScryfallQueryTool({ searchCards } as never);
    await tool.execute({
      natural_query: "blue counterspells under $5 for modern",
      test_query: true,
    });

    expect(searchCards).toHaveBeenCalledTimes(1);
  });

  it("applies an explicit price budget to the generated query", async () => {
    const searchCards = vi.fn();
    const tool = new BuildScryfallQueryTool({ searchCards } as never);

    const result = await tool.execute({
      natural_query: "blue creatures",
      price_budget: { max: 7, currency: "usd" },
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("usd<=7");
  });
});
