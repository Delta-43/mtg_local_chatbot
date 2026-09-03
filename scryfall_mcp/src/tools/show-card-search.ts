import { ScryfallClient } from "../services/scryfall-client.js";
import { ScryfallCard } from "../types/scryfall-api.js";
import { RateLimitError, SearchCardsParams, ScryfallAPIError, ValidationError } from "../types/mcp-types.js";
import { sanitizeQuery } from "../utils/query-sanitizer.js";
import { validateScryfallQuery } from "../utils/validators.js";
import type { ValidationError as QueryValidationError } from "../utils/query-validator.js";

type WidgetCard = {
  id: string;
  name: string;
  manaCost?: string;
  typeLine: string;
  set: string;
  rarity: string;
  imageUrl?: string;
  artist?: string;
  scryfallUrl: string;
};

function imageUrlForCard(card: ScryfallCard): string | undefined {
  return card.image_uris?.normal ?? card.card_faces?.[0]?.image_uris?.normal;
}

function artistForCard(card: ScryfallCard): string | undefined {
  return card.artist ?? card.card_faces?.find(face => face.artist)?.artist;
}

function toWidgetCard(card: ScryfallCard): WidgetCard {
  return {
    id: card.id,
    name: card.name,
    manaCost: card.mana_cost,
    typeLine: card.type_line,
    set: card.set.toUpperCase(),
    rarity: card.rarity,
    imageUrl: imageUrlForCard(card),
    artist: artistForCard(card),
    scryfallUrl: card.scryfall_uri,
  };
}

/**
 * ChatGPT Apps render tool for displaying Scryfall searches in a widget.
 */
export class ShowCardSearchTool {
  readonly name = "show_card_search";
  readonly title = "Show Card Search";
  readonly description =
    "Use this when the user wants an interactive visual grid of Magic: The Gathering cards from a Scryfall search.";

  readonly inputSchema = {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description:
          'Scryfall search query using their syntax (for example, "name:bolt type:instant" or "color:wu type:legendary").',
      },
      limit: {
        type: "integer",
        description: "Number of cards to show in the widget (1-24)",
        minimum: 1,
        maximum: 24,
        default: 8,
      },
    },
    required: ["query"],
  };

  readonly annotations = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  };

  readonly _meta = {
    ui: {
      resourceUri: "ui://widget/card-search.html",
      visibility: ["model", "app"],
    },
    "openai/outputTemplate": "ui://widget/card-search.html",
    "openai/toolInvocation/invoking": "Searching Scryfall",
    "openai/toolInvocation/invoked": "Card search ready",
  };

  constructor(private readonly scryfallClient: ScryfallClient) {}

  async execute(args: unknown) {
    try {
      const params = this.parseParams(args);
      const sanitizedQuery = sanitizeQuery(params.query);
      const validationResult = await validateScryfallQuery(sanitizedQuery);

      if (!validationResult.isValid) {
        return {
          content: [{ type: "text", text: this.formatValidationErrors(validationResult.errors) }],
          isError: true,
        };
      }

      const results = await this.scryfallClient.searchCards({
        query: sanitizedQuery,
        limit: params.limit,
        page: 1,
        unique: "cards",
        direction: "auto",
      });
      const cards = results.data.slice(0, params.limit).map(toWidgetCard);

      return {
        structuredContent: {
          query: sanitizedQuery,
          totalCards: results.total_cards ?? cards.length,
          hasMore: results.has_more,
          cards,
        },
        content: [
          {
            type: "text",
            text:
              cards.length > 0
                ? `Showing ${cards.length} Scryfall card result${cards.length === 1 ? "" : "s"} for "${sanitizedQuery}".`
                : `No Scryfall cards found for "${sanitizedQuery}".`,
          },
        ],
        _meta: {
          source: "scryfall",
          resultCount: cards.length,
        },
      };
    } catch (error) {
      if (error instanceof ValidationError) {
        return {
          content: [{ type: "text", text: `Validation error: ${error.message}` }],
          isError: true,
        };
      }

      if (error instanceof RateLimitError) {
        const retry = error.retryAfter ? ` Retry after ${error.retryAfter}s.` : "";
        return {
          content: [{ type: "text", text: `Rate limit exceeded.${retry} Please wait and try again.` }],
          isError: true,
        };
      }

      if (error instanceof ScryfallAPIError) {
        return {
          content: [{ type: "text", text: `Scryfall API error: ${error.message}` }],
          isError: true,
        };
      }

      throw error;
    }
  }

  private parseParams(args: unknown): Pick<SearchCardsParams, "query" | "limit"> {
    if (!args || typeof args !== "object") {
      throw new ValidationError("Expected an object with a query.");
    }

    const candidate = args as Partial<SearchCardsParams>;
    if (typeof candidate.query !== "string" || !candidate.query.trim()) {
      throw new ValidationError("Query cannot be empty.");
    }

    const limit = candidate.limit ?? 8;
    if (!Number.isInteger(limit) || limit < 1 || limit > 24) {
      throw new ValidationError("Limit must be an integer between 1 and 24.");
    }

    return {
      query: candidate.query,
      limit,
    };
  }

  private formatValidationErrors(errors: QueryValidationError[]): string {
    return [
      "Invalid Scryfall query for the card search widget.",
      ...errors.map((error) => `- ${error.message}`),
    ].join("\n");
  }
}
