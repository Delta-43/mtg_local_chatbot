import { describe, expect, it, vi } from "vitest";
import { FindSynergisticCardsTool } from "../src/tools/find-synergistic-cards.js";
import { buildSynergyQueries } from "../src/tools/find-synergistic-cards/query-builder.js";
import { formatResultsWithSynergyExplanations } from "../src/tools/find-synergistic-cards/result-formatter.js";
import { RateLimitError, ScryfallAPIError } from "../src/types/mcp-types.js";
import type { SynergyCard } from "../src/tools/find-synergistic-cards/types.js";
import type { ScryfallCard } from "../src/types/scryfall-api.js";

function createCard(
  id: string,
  layer?: SynergyCard["_synergy_layer"],
  overrides: Partial<SynergyCard> = {}
): SynergyCard {
  return {
    object: "card",
    id,
    oracle_id: `${id}-oracle`,
    name: `Card ${id.toUpperCase()}`,
    lang: "en",
    released_at: "2024-01-01",
    uri: `https://api.scryfall.com/cards/${id}`,
    scryfall_uri: `https://scryfall.com/card/tst/${id}`,
    layout: "normal",
    highres_image: false,
    image_status: "missing",
    cmc: 2,
    type_line: "Artifact",
    colors: [],
    color_identity: [],
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
    foil: false,
    nonfoil: true,
    finishes: ["nonfoil"],
    oversized: false,
    promo: false,
    reprint: false,
    variation: false,
    set_id: "set-id",
    set: "tst",
    set_name: "Test Set",
    set_type: "expansion",
    set_uri: "https://api.scryfall.com/sets/tst",
    set_search_uri: "https://api.scryfall.com/cards/search?q=e%3Atst",
    scryfall_set_uri: "https://scryfall.com/sets/tst",
    rulings_uri: `https://api.scryfall.com/cards/${id}/rulings`,
    prints_search_uri: `https://api.scryfall.com/cards/search?order=released&q=oracleid%3A${id}-oracle&unique=prints`,
    collector_number: id,
    digital: false,
    rarity: "rare",
    border_color: "black",
    frame: "2015",
    full_art: false,
    textless: false,
    booster: true,
    story_spotlight: false,
    prices: {},
    _synergy_layer: layer,
    ...overrides,
  };
}

function makeCard(overrides: Partial<ScryfallCard>): ScryfallCard {
  return {
    ...createCard("focus"),
    related_uris: {},
    ...overrides,
  };
}

describe("buildSynergyQueries", () => {
  it("builds Sanar-style fallback queries from oracle text and creature types", () => {
    const params = {
      focus_card: "Sanar, Unfinished Genius",
      synergy_type: "theme",
      format: "brawl",
      include_lands: true,
      limit: 20,
      arena_only: true,
    };
    const queries = buildSynergyQueries(makeCard({
      name: "Sanar, Unfinished Genius // Wild Idea",
      type_line: "Legendary Creature — Goblin Sorcerer",
      oracle_text: "Sanar enters prepared.\n{T}: Create a Treasure token. Activate only if you've cast an instant or sorcery spell this turn.",
      color_identity: ["U", "R"],
    }), params);

    expect(queries).toContain('legal:brawl game:arena ci<=ur o:"instant or sorcery"');
    expect(queries).toContain('legal:brawl game:arena ci<=ur o:Treasure');
    expect(queries).toContain('legal:brawl game:arena ci<=ur t:goblin');
    expect(queries).toContain('legal:brawl game:arena ci<=ur t:wizard');
    expect(queries.every(query => query.includes('ci<=ur'))).toBe(true);
  });

  it("applies explicit color identity constraints to theme-only synergy queries", () => {
    const params = {
      focus_card: "instant sorcery treasure",
      synergy_type: "theme",
      format: "brawl",
      include_lands: false,
      limit: 20,
      arena_only: true,
      color_identity: "UR",
    };

    const queries = buildSynergyQueries(null, params);

    expect(queries.length).toBeGreaterThan(0);
    expect(queries.every(query => query.startsWith('legal:brawl -t:land game:arena ci<=ur '))).toBe(true);
  });
});

describe("FindSynergisticCardsTool", () => {
  it("deduplicates and caps query candidates before execution", () => {
    const tool = new FindSynergisticCardsTool({} as never);
    const prioritizeQueries = (tool as unknown as {
      prioritizeQueries: (queries: string[], maxQueries: number) => string[];
    }).prioritizeQueries.bind(tool);

    expect(prioritizeQueries([" q:a ", "q:a", "q:b", "q:c"], 2)).toEqual(["q:a", "q:b"]);
  });

  it("uses a larger first-query budget because synergy searches are serialized", () => {
    const tool = new FindSynergisticCardsTool({} as never);

    expect(
      (tool as unknown as {
        getPerQueryLimit: (
          queryIndex: number,
          targetUniqueResults: number,
          currentUniqueResults: number
        ) => number;
      }).getPerQueryLimit(0, 15, 0)
    ).toBe(20);
  });

  it("shrinks later query budgets to the remaining unique-result need", () => {
    const tool = new FindSynergisticCardsTool({} as never);

    expect(
      (tool as unknown as {
        getPerQueryLimit: (
          queryIndex: number,
          targetUniqueResults: number,
          currentUniqueResults: number
        ) => number;
      }).getPerQueryLimit(2, 15, 11)
    ).toBe(8);
  });

  it("stops searching once the first query already returns enough unique results", async () => {
    const searchCards = vi.fn().mockResolvedValueOnce({
      object: "list",
      total_cards: 2,
      has_more: false,
      data: [createCard("a"), createCard("b")],
    });

    const tool = new FindSynergisticCardsTool({
      getCard: vi.fn().mockRejectedValue(new ScryfallAPIError("not found", 404, "not_found")),
      searchCards,
    } as never);

    await tool.execute({ focus_card: "artifact token theme", limit: 2 });

    expect(searchCards).toHaveBeenCalledTimes(1);
  });

  it("adds a partial-failure note when some search queries fail", async () => {
    const searchCards = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary outage"))
      .mockResolvedValue({
        object: "list",
        total_cards: 1,
        has_more: false,
        data: [createCard("ok-card")],
      });

    const tool = new FindSynergisticCardsTool({
      getCard: vi.fn().mockRejectedValue(new ScryfallAPIError("not found", 404, "not_found")),
      searchCards,
    } as never);

    const result = await tool.execute({ focus_card: "artifact token theme", limit: 2 });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Some Scryfall searches failed");
  });

  it("fails fast on rate-limit errors instead of treating them as partial synergy misses", async () => {
    const searchCards = vi.fn().mockRejectedValue(new RateLimitError("Rate limit exceeded", 7));

    const tool = new FindSynergisticCardsTool({
      getCard: vi.fn().mockRejectedValue(new ScryfallAPIError("not found", 404, "not_found")),
      searchCards,
    } as never);

    const result = await tool.execute({ focus_card: "artifact token theme", limit: 2 });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Rate limit exceeded");
    expect(result.content[0].text).toContain("Retry after 7s");
  });

  it("does not emit duplicate cards when multiple queries return the same card id", async () => {
    const duplicateCard = createCard("same-id");
    const searchCards = vi
      .fn()
      .mockResolvedValueOnce({
        object: "list",
        total_cards: 1,
        has_more: false,
        data: [duplicateCard],
      })
      .mockResolvedValueOnce({
        object: "list",
        total_cards: 1,
        has_more: false,
        data: [duplicateCard],
      })
      .mockResolvedValue({
        object: "list",
        total_cards: 0,
        has_more: false,
        data: [],
      });

    const tool = new FindSynergisticCardsTool({
      getCard: vi.fn().mockRejectedValue(new ScryfallAPIError("not found", 404, "not_found")),
      searchCards,
    } as never);

    const result = await tool.execute({ focus_card: "artifact token theme", limit: 3 });
    const duplicateMentions = (result.content[0].text.match(/Card SAME-ID/g) || []).length;
    expect(result.isError).toBeUndefined();
    expect(duplicateMentions).toBe(1);
  });

  it("filters off-color, non-Arena, and format-illegal synergy results before formatting", async () => {
    const allowed = createCard("allowed", "semantic", {
      name: "Allowed Izzet Card",
      color_identity: ["U", "R"],
      games: ["arena"],
    });
    const offColor = createCard("off-color", "semantic", {
      name: "Off Color Card",
      color_identity: ["B"],
      games: ["arena"],
    });
    const nonArena = createCard("non-arena", "semantic", {
      name: "Non Arena Card",
      color_identity: ["U"],
      games: ["paper"],
    });
    const illegal = createCard("illegal", "semantic", {
      name: "Illegal Card",
      color_identity: ["R"],
      games: ["arena"],
      legalities: {
        ...createCard("legality-source").legalities,
        brawl: "not_legal",
      },
    });
    const searchCards = vi.fn().mockResolvedValueOnce({
      object: "list",
      total_cards: 4,
      has_more: false,
      data: [allowed, offColor, nonArena, illegal],
    });

    const tool = new FindSynergisticCardsTool({
      getCard: vi.fn().mockRejectedValue(new ScryfallAPIError("not found", 404, "not_found")),
      searchCards,
    } as never);

    const result = await tool.execute({
      focus_card: "instant sorcery treasure",
      format: "brawl",
      arena_only: true,
      color_identity: "UR",
      limit: 5,
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Allowed Izzet Card");
    expect(result.content[0].text).not.toContain("Off Color Card");
    expect(result.content[0].text).not.toContain("Non Arena Card");
    expect(result.content[0].text).not.toContain("Illegal Card");
    expect(result.content[0].text).toContain(
      "Filtered 3 cards that did not match legality, Arena, or color-identity constraints."
    );
  });
});

describe("formatResultsWithSynergyExplanations", () => {
  it("groups layered results without repeated filtering changing visible output", () => {
    const output = formatResultsWithSynergyExplanations(
      {
        object: "list",
        total_cards: 3,
        has_more: false,
        data: [
          createCard("semantic", "semantic"),
          createCard("exact", "exact"),
          createCard("theme", "thematic"),
        ],
      },
      null,
      "artifact token theme"
    );

    expect(output).toContain("Strategic Synergies");
    expect(output).toContain("Mechanical Synergies");
    expect(output).toContain("Thematic Support");
    expect(output).toContain("Card SEMANTIC");
    expect(output).toContain("Card EXACT");
    expect(output).toContain("Card THEME");
  });
});
