import { describe, expect, it } from "vitest";
import { AnalyzeCardPrompt } from "../src/prompts/analyze-card.js";
import { BuildDeckPrompt } from "../src/prompts/build-deck.js";

const card = {
  name: "Test Commander",
  mana_cost: "{2}{U}",
  type_line: "Legendary Creature — Wizard",
  oracle_text: "When this enters, draw a card.",
  set_name: "Test Set",
  set: "tst",
  collector_number: "1",
  rarity: "rare",
  prices: { usd: "1.00" },
  legalities: { commander: "legal", modern: "legal" },
  color_identity: ["U"],
  games: ["paper"],
};

const client = {
  getCard: async () => card,
};

describe("MCP prompts", () => {
  it("normalizes format casing for singleton deck structure", async () => {
    const prompt = await new BuildDeckPrompt(client as never).generatePrompt({
      card_identifier: "Test Commander",
      format: "Commander",
    });

    expect(prompt).toContain("100-card decklist");
    expect(prompt).toContain("99 cards + commander");
    expect(prompt).not.toContain("- Sideboard (15 cards)");
    expect(prompt).toContain("Commander-Specific Considerations");
  });

  it("keeps card analysis inside the supplied evidence boundary", async () => {
    const prompt = await new AnalyzeCardPrompt(client as never).generatePrompt({
      card_identifier: "Test Commander",
      format: "modern",
      analysis_depth: "comprehensive",
    });

    expect(prompt).toContain("Evidence Boundaries");
    expect(prompt).not.toContain("Historical performance and trends");
    expect(prompt).not.toContain("Price trend analysis");
    expect(prompt).not.toContain("Tournament results and statistics");
    expect(prompt).not.toContain("Professional player opinions");
    expect(prompt).not.toContain("Future format impact predictions");
  });

  it("requires verification instead of unsupported current deck claims", async () => {
    const prompt = await new BuildDeckPrompt(client as never).generatePrompt({
      card_identifier: "Test Commander",
      format: "modern",
      competitive_level: "tournament",
    });

    expect(prompt).toContain("Evidence Boundaries");
    expect(prompt).toContain("verify each recommended card");
    expect(prompt).not.toContain("Total estimated deck cost");
    expect(prompt).not.toContain("Consider current meta game and popular decks");
    expect(prompt).not.toContain("Current tier placement expectations");
  });
});
