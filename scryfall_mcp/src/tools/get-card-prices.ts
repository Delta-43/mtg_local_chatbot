import { ScryfallClient } from '../services/scryfall-client.js';
import { validateGetCardPricesParams } from '../utils/validators.js';
import { formatCardPrices } from '../utils/formatters.js';
import { 
  ScryfallAPIError, 
  ValidationError,
  RateLimitError 
} from '../types/mcp-types.js';
import { MagicFormat, Prices, ScryfallCard } from '../types/scryfall-api.js';
import { excludeLogicalCardFromQuery, isSameLogicalCard } from '../utils/card-identity.js';

const getPriceForCurrency = (prices: Prices, currency: string): string | undefined =>
  prices[currency as keyof Prices];

const extractPrimaryCardType = (typeLine: string): string | null => {
  const normalized = typeLine.toLowerCase().split('—')[0];
  const typePriority = ['creature', 'instant', 'sorcery', 'artifact', 'enchantment', 'planeswalker', 'land', 'battle'];
  return typePriority.find(type => normalized.includes(type)) ?? null;
};

/**
 * MCP Tool for retrieving card price information
 */
export class GetCardPricesTool {
  readonly name = 'get_card_prices';
  readonly description = 'Get current price information for a Magic: The Gathering card by name, set/number, or Scryfall ID';

  readonly inputSchema = {
    type: 'object' as const,
    properties: {
      card_identifier: {
        type: 'string',
        description: 'Card name, set/number, or Scryfall ID'
      },
      currency: {
        type: 'string',
        enum: ['usd', 'eur', 'tix'],
        description: 'Currency type for prices',
        default: 'usd'
      },
      format_context: {
        type: 'string',
        enum: ['standard', 'modern', 'legacy', 'vintage', 'commander', 'pioneer'],
        description: 'Show price relevance for specific format'
      },
      include_alternatives: {
        type: 'boolean',
        description: 'Include budget alternatives and upgrades',
        default: false
      },
      include_history: {
        type: 'boolean',
        description: 'Include price trend data (not implemented in Scryfall API)',
        default: false
      }
    },
    required: ['card_identifier']
  };

  constructor(private readonly scryfallClient: ScryfallClient) {}

  /**
   * Get budget alternatives and upgrades for a card
   */
  private async getAlternatives(card: ScryfallCard, currency: string, format?: MagicFormat): Promise<string> {
    try {
      const currentPrice = parseFloat(getPriceForCurrency(card.prices, currency) || '0');
      if (currentPrice === 0) {
        return '\n\n**Alternatives:** Price data not available for comparison.';
      }

      // Search for similar cards with different price ranges
      const primaryType = extractPrimaryCardType(card.type_line || '');
      const typeClause = primaryType ? `t:${primaryType}` : '';
      const cheaperQuery = `${typeClause} cmc:${card.cmc} ${currency}<${currentPrice}`.trim();
      const expensiveQuery = `${typeClause} cmc:${card.cmc} ${currency}>${currentPrice}`.trim();

      let alternatives = '\n\n**Alternatives:**';

      // Get cheaper alternatives
      try {
        const cheaperResults = await this.scryfallClient.searchCards({
          query: excludeLogicalCardFromQuery(
            cheaperQuery + (format ? ` f:${format}` : ''),
            card
          ),
          limit: 3,
          unique: 'cards'
        });

        const cheaperAlternatives = cheaperResults.data.filter(alt => !isSameLogicalCard(alt, card)).slice(0, 3);
        if (cheaperAlternatives.length > 0) {
          alternatives += '\n\n*Budget Options:*';
          for (const alt of cheaperAlternatives) {
            const price = getPriceForCurrency(alt.prices, currency) || 'N/A';
            alternatives += `\n- ${alt.name}: ${currency.toUpperCase()} ${price}`;
          }
        }
      } catch (error) {
        // Ignore search errors for alternatives
      }

      // Get more expensive alternatives (upgrades)
      try {
        const expensiveResults = await this.scryfallClient.searchCards({
          query: excludeLogicalCardFromQuery(
            expensiveQuery + (format ? ` f:${format}` : ''),
            card
          ),
          limit: 3,
          unique: 'cards'
        });

        const upgradeAlternatives = expensiveResults.data.filter(alt => !isSameLogicalCard(alt, card)).slice(0, 3);
        if (upgradeAlternatives.length > 0) {
          alternatives += '\n\n*Upgrade Options:*';
          for (const alt of upgradeAlternatives) {
            const price = getPriceForCurrency(alt.prices, currency) || 'N/A';
            alternatives += `\n- ${alt.name}: ${currency.toUpperCase()} ${price}`;
          }
        }
      } catch (error) {
        // Ignore search errors for alternatives
      }

      return alternatives;
    } catch (error) {
      return '\n\n**Alternatives:** Unable to find alternatives at this time.';
    }
  }

  async execute(args: unknown) {
    try {
      // Validate parameters
      const params = validateGetCardPricesParams(args);

      // First, resolve the card identifier to get the card
      let card;
      try {
        card = await this.scryfallClient.getCard({ identifier: params.card_identifier });
      } catch (error) {
        if (error instanceof ScryfallAPIError && error.status === 404) {
          return {
            content: [
              {
                type: 'text',
                text: `Card not found: "${params.card_identifier}". Please check the card name, set code, or ID.`
              }
            ],
            isError: true
          };
        }
        throw error;
      }

      // Format price information
      let responseText = formatCardPrices(card, params.currency);

      // Add format context if specified
      if (params.format_context) {
        const legality = card.legalities[params.format_context];
        responseText += `\n\n**${params.format_context.toUpperCase()} Legality:** ${legality || 'Unknown'}`;

        if (legality === 'legal') {
          responseText += ` - This card is legal in ${params.format_context}`;
        } else if (legality === 'banned') {
          responseText += ` - This card is banned in ${params.format_context}`;
        } else if (legality === 'restricted') {
          responseText += ` - This card is restricted in ${params.format_context}`;
        }
      }

      // Add alternatives if requested
      if (params.include_alternatives) {
        responseText += await this.getAlternatives(card, params.currency, params.format_context);
      }

      if (params.include_history) {
        responseText += '\n\nNote: Price history is not available through the Scryfall API.';
      }

      return {
        content: [
          {
            type: 'text',
            text: responseText
          }
        ]
      };

    } catch (error) {
      // Handle different error types
      if (error instanceof ValidationError) {
        return {
          content: [
            {
              type: 'text',
              text: `Validation error: ${error.message}`
            }
          ],
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
          const identifier = args && typeof args === 'object' && 'card_identifier' in args
            ? args.card_identifier
            : 'unknown';
          errorMessage = `Card not found: "${typeof identifier === 'string' ? identifier : 'unknown'}". Check the card name, set code, or ID.`;
        } else if (error.status === 422) {
          errorMessage = `Invalid card identifier format. Use card name, "SET/NUMBER", or Scryfall UUID.`;
        } else if (error.status === 429) {
          errorMessage = 'Rate limit exceeded. Please wait a moment and try again.';
        }

        return {
          content: [
            {
              type: 'text',
              text: errorMessage
            }
          ],
          isError: true
        };
      }

      // Generic error handling
      return {
        content: [
          {
            type: 'text',
            text: `Unexpected error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`
          }
        ],
        isError: true
      };
    }
  }
}
