import { ScryfallClient } from '../services/scryfall-client.js';
import {
  validateGetCardParams,
  validateCardIdentifier
} from '../utils/validators.js';
import { sanitizeCardIdentifier } from '../utils/query-sanitizer.js';
import { formatCardRulings } from '../utils/formatters.js';
import {
  ScryfallAPIError,
  ValidationError,
  GetCardParams,
  RateLimitError
} from '../types/mcp-types.js';

/**
 * MCP Tool for retrieving a Magic: The Gathering card's official rulings
 * (https://scryfall.com/docs/api/rulings) -- the one gap in the rest of this
 * tool set, which otherwise only exposes card data, not ruling text.
 */
export class GetCardRulingsTool {
  readonly name = 'get_card_rulings';
  readonly description = 'Get official Wizards of the Coast / Scryfall rulings for a specific Magic: The Gathering card by name, set code+number, or Scryfall ID. Rulings clarify specific card interactions that are not fully covered by the Comprehensive Rules text alone.';

  readonly inputSchema = {
    type: 'object' as const,
    properties: {
      identifier: {
        type: 'string',
        description: 'Card name, set code+collector number (e.g., "dom/123"), or Scryfall UUID'
      },
      set: {
        type: 'string',
        description: '3-letter set code for disambiguation when using card name',
        pattern: '^[a-zA-Z0-9]{3,4}$'
      }
    },
    required: ['identifier']
  };

  constructor(private readonly scryfallClient: ScryfallClient) {}

  async execute(args: unknown) {
    try {
      // Same identifier resolution as GetCardTool -- reuses its params schema
      // since rulings lookup takes the same identifier/set shape.
      const params = validateGetCardParams(args);

      const sanitizedIdentifier = sanitizeCardIdentifier(params.identifier);
      validateCardIdentifier(sanitizedIdentifier);

      const { card, rulings } = await this.scryfallClient.getCardRulings({
        identifier: sanitizedIdentifier,
        set: params.set
      });

      return {
        content: [
          {
            type: 'text',
            text: formatCardRulings(card, rulings)
          }
        ]
      };
    } catch (error) {
      if (error instanceof ValidationError) {
        return {
          content: [{ type: 'text', text: `Validation error: ${error.message}` }],
          isError: true
        };
      }

      if (error instanceof RateLimitError) {
        const retry = error.retryAfter ? ` Retry after ${error.retryAfter}s.` : '';
        return {
          content: [{ type: 'text', text: `Rate limit exceeded.${retry} Please wait and try again.` }],
          isError: true
        };
      }

      if (error instanceof ScryfallAPIError) {
        let errorMessage = `Scryfall API error: ${error.message}`;

        if (error.status === 404) {
          errorMessage = `Card not found: "${(args as GetCardParams)?.identifier ?? 'unknown'}". Check the card name, set code, or ID.`;
        } else if (error.status === 422) {
          errorMessage = `Invalid card identifier format. Use card name, "SET/NUMBER", or Scryfall UUID.`;
        } else if (error.status === 429) {
          errorMessage = 'Rate limit exceeded. Please wait a moment and try again.';
        }

        return {
          content: [{ type: 'text', text: errorMessage }],
          isError: true
        };
      }

      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Unexpected error fetching rulings: ${message}` }],
        isError: true
      };
    }
  }
}
