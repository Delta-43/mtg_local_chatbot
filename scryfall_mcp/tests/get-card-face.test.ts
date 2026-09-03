import { describe, expect, it, vi } from "vitest";
import { GetCardTool } from "../src/tools/get-card.js";
import type { ScryfallCard } from "../src/types/scryfall-api.js";

function createDoubleFacedCard(): ScryfallCard {
  return {
    object: "card",
    id: "card-1",
    oracle_id: "oracle-1",
    name: "Front Name // Back Name",
    lang: "en",
    released_at: "2026-04-22",
    uri: "https://api.scryfall.com/cards/card-1",
    scryfall_uri: "https://scryfall.com/card/tst/1/front-name-back-name",
    layout: "transform",
    highres_image: true,
    image_status: "highres_scan",
    cmc: 2,
    type_line: "Creature // Enchantment",
    colors: ["U"],
    color_identity: ["U"],
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
      pauper: "not_legal",
      vintage: "legal",
      penny: "not_legal",
      commander: "legal",
      oathbreaker: "legal",
      standardbrawl: "legal",
      brawl: "legal",
      historicbrawl: "legal",
      alchemy: "legal",
      paupercommander: "not_legal",
      duel: "legal",
      oldschool: "not_legal",
      premodern: "not_legal",
      predh: "not_legal",
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
    set: "abcd",
    set_name: "Four Letter Set",
    set_type: "expansion",
    set_uri: "https://api.scryfall.com/sets/abcd",
    set_search_uri: "https://api.scryfall.com/cards/search?order=set&q=e%3Aabcd&unique=prints",
    scryfall_set_uri: "https://scryfall.com/sets/abcd",
    rulings_uri: "https://api.scryfall.com/cards/card-1/rulings",
    prints_search_uri: "https://api.scryfall.com/cards/search?order=released&q=oracleid%3Aoracle-1&unique=prints",
    collector_number: "1",
    digital: false,
    rarity: "rare",
    artist: "Test Artist",
    border_color: "black",
    frame: "2015",
    full_art: false,
    textless: false,
    booster: true,
    story_spotlight: false,
    prices: {},
    related_uris: {},
    card_faces: [
      {
        object: "card_face",
        name: "Front Name",
        mana_cost: "{1}{U}",
        type_line: "Creature - Wizard",
        oracle_text: "Front face text.",
        colors: ["U"],
        power: "2",
        toughness: "2",
        image_uris: {
          small: "https://cards.scryfall.io/small/front.jpg",
          normal: "https://cards.scryfall.io/normal/front.jpg",
          large: "https://cards.scryfall.io/large/front.jpg",
          png: "https://cards.scryfall.io/png/front.png",
          art_crop: "https://cards.scryfall.io/art_crop/front.jpg",
          border_crop: "https://cards.scryfall.io/border_crop/front.jpg",
        },
      },
      {
        object: "card_face",
        name: "Back Name",
        mana_cost: "",
        type_line: "Enchantment",
        oracle_text: "Back face text.",
        colors: ["U"],
        image_uris: {
          small: "https://cards.scryfall.io/small/back.jpg",
          normal: "https://cards.scryfall.io/normal/back.jpg",
          large: "https://cards.scryfall.io/large/back.jpg",
          png: "https://cards.scryfall.io/png/back.png",
          art_crop: "https://cards.scryfall.io/art_crop/back.jpg",
          border_crop: "https://cards.scryfall.io/border_crop/back.jpg",
        },
      },
    ],
  };
}

describe("GetCardTool face handling", () => {
  it("accepts four-character set codes advertised by the tool schema", async () => {
    const getCard = vi.fn().mockResolvedValue(createDoubleFacedCard());
    const tool = new GetCardTool({ getCard } as never);

    const result = await tool.execute({
      identifier: "Front Name",
      set: "abcd",
      include_image: false,
    });

    expect(result.isError).toBeUndefined();
    expect(getCard).toHaveBeenCalledWith(expect.objectContaining({ set: "abcd" }));
  });

  it("formats only the requested back face when face is back", async () => {
    const tool = new GetCardTool({
      getCard: vi.fn().mockResolvedValue(createDoubleFacedCard()),
    } as never);

    const result = await tool.execute({
      identifier: "Front Name",
      face: "back",
      include_image: true,
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("# Back Name");
    expect(result.content[0].text).toContain("Back face text.");
    expect(result.content[0].text).toContain("https://cards.scryfall.io/normal/back.jpg");
    expect(result.content[0].text).toContain("**Artist:** Test Artist");
    expect(result.content[0].text).toContain("**Source:** Scryfall (https://scryfall.com/card/tst/1/front-name-back-name)");
    expect(result.content[0].text).not.toContain("Front face text.");
  });

  it("returns an error instead of front-face data when the requested back face is unavailable", async () => {
    const singleFacedCard = {
      ...createDoubleFacedCard(),
      name: "Single Face",
      card_faces: undefined,
      oracle_text: "Single-face text.",
      image_uris: {
        small: "https://cards.scryfall.io/small/single.jpg",
        normal: "https://cards.scryfall.io/normal/single.jpg",
        large: "https://cards.scryfall.io/large/single.jpg",
        png: "https://cards.scryfall.io/png/single.png",
        art_crop: "https://cards.scryfall.io/art_crop/single.jpg",
        border_crop: "https://cards.scryfall.io/border_crop/single.jpg",
      },
    } satisfies ScryfallCard;
    const tool = new GetCardTool({
      getCard: vi.fn().mockResolvedValue(singleFacedCard),
    } as never);

    const result = await tool.execute({
      identifier: "Single Face",
      face: "back",
      include_image: true,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Back face is not available for "Single Face"');
    expect(result.content[0].text).not.toContain("Single-face text.");
    expect(result.content[0].text).not.toContain("https://cards.scryfall.io/normal/single.jpg");
  });
});
