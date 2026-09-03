import { ScryfallClient } from '../services/scryfall-client.js';
import { validateRandomCardParams } from '../utils/validators.js';
import { formatCardDetails } from '../utils/formatters.js';
import { 
  ScryfallAPIError, 
  ValidationError,
  RateLimitError 
} from '../types/mcp-types.js';
import { RandomCardParams } from '../types/mcp-types.js';

/**
 * MCP Tool for getting a random Magic: The Gathering card
 */
export class RandomCardTool {
  readonly name = 'random_card';
  readonly description = 'Get a random Magic: The Gathering card, optionally filtered by format or search criteria';
  
  readonly inputSchema = {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'Optional Scryfall search query to filter random selection (e.g., "c:red", "type:creature")'
      },
      format: {
        type: 'string',
        enum: ['standard', 'modern', 'legacy', 'vintage', 'commander', 'pioneer'],
        description: 'Magic format to filter by legality'
      },
      archetype: {
        type: 'string',
        enum: ['aggro', 'control', 'combo', 'midrange', 'ramp', 'tribal'],
        description: 'Deck archetype preference'
      },
      price_range: {
        type: 'object',
        properties: {
          min: {
            type: 'number',
            minimum: 0,
            description: 'Minimum price'
          },
          max: {
            type: 'number',
            minimum: 0,
            description: 'Maximum price'
          },
          currency: {
            type: 'string',
            enum: ['usd', 'eur', 'tix'],
            default: 'usd',
            description: 'Currency for price filtering'
          }
        },
        description: 'Price constraints for random selection'
      },
      exclude_reprints: {
        type: 'boolean',
        default: false,
        description: 'Exclude heavily reprinted cards'
      },
      similar_to: {
        type: 'string',
        description: 'Find cards similar to this card'
      },
      rarity_preference: {
        type: 'string',
        enum: ['common', 'uncommon', 'rare', 'mythic'],
        description: 'Preferred rarity level'
      }
    },
    required: []
  };

  constructor(private readonly scryfallClient: ScryfallClient) {}

  /**
   * Build enhanced query with all filtering parameters
   */
  private buildEnhancedQuery(params: RandomCardParams): string {
    const queryParts: string[] = [];

    // Add base query if provided
    if (params.query) {
      queryParts.push(params.query);
    }

    // Add format filter
    if (params.format) {
      queryParts.push(`legal:${params.format}`);
    }

    // Add archetype-specific filters
    if (params.archetype) {
      queryParts.push(this.getArchetypeFilter(params.archetype));
    }

    // Add price range filter
    if (params.price_range) {
      const currency = params.price_range.currency || 'usd';
      if (params.price_range.min !== undefined) {
        queryParts.push(`${currency}>=${params.price_range.min}`);
      }
      if (params.price_range.max !== undefined) {
        queryParts.push(`${currency}<=${params.price_range.max}`);
      }
    }

    // Add rarity preference
    if (params.rarity_preference) {
      queryParts.push(`r:${params.rarity_preference}`);
    }

    // Add reprint exclusion (prefer first printings)
    if (params.exclude_reprints) {
      queryParts.push('is:firstprint');
    }

    // Add similarity filter
    if (params.similar_to) {
      // This is a simplified similarity - in practice, you'd want to analyze the target card
      queryParts.push(`"${params.similar_to}"`);
    }

    return queryParts.join(' ');
  }

  /**
   * Get archetype-specific search filters
   */
  private getArchetypeFilter(archetype: string): string {
    switch (archetype) {
      case 'aggro':
        return '(t:creature pow>=2) OR (o:"haste" OR o:"first strike")';
      case 'control':
        return '(o:counter OR o:destroy OR o:exile OR o:"draw cards")';
      case 'combo':
        return '(o:"infinite" OR o:"win the game" OR o:"each opponent")';
      case 'midrange':
        return '(t:creature cmc>=3 cmc<=5) OR (t:planeswalker)';
      case 'ramp':
        return '(o:"add mana" OR o:"search for a land" OR t:land)';
      case 'tribal':
        return '(o:"choose a creature type" OR o:"creatures you control")';
      default:
        return '';
    }
  }

  async execute(args: unknown) {
    try {
      // Validate parameters
      const params = validateRandomCardParams(args);

      // Build enhanced query with all filters
      const query = this.buildEnhancedQuery(params);

      // Execute random card lookup
      const card = await this.scryfallClient.getRandomCard(query || undefined);

      // Format detailed card information
      const responseText = formatCardDetails(card, true);

      // Add context about the randomization
      let contextNote = '\n\n---\n*This is a randomly selected card';

      const filters = [];
      if (params.format) filters.push(`legal in ${params.format}`);
      if (params.archetype) filters.push(`${params.archetype} archetype`);
      if (params.rarity_preference) filters.push(`${params.rarity_preference} rarity`);
      if (params.price_range) {
        const currency = params.price_range.currency || 'usd';
        let priceDesc = `${currency.toUpperCase()} price`;
        if (params.price_range.min && params.price_range.max) {
          priceDesc += ` between ${params.price_range.min}-${params.price_range.max}`;
        } else if (params.price_range.min) {
          priceDesc += ` above ${params.price_range.min}`;
        } else if (params.price_range.max) {
          priceDesc += ` below ${params.price_range.max}`;
        }
        filters.push(priceDesc);
      }
      if (params.exclude_reprints) filters.push('first printing only');
      if (params.similar_to) filters.push(`similar to "${params.similar_to}"`);
      if (params.query) filters.push(`matching "${params.query}"`);

      if (filters.length > 0) {
        contextNote += ` with filters: ${filters.join(', ')}`;
      }
      contextNote += '.*';

      return {
        content: [
          {
            type: 'text',
            text: responseText + contextNote
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
          const query = args && typeof args === 'object' && 'query' in args ? args.query : undefined;
          const format = args && typeof args === 'object' && 'format' in args ? args.format : undefined;
          
          if (typeof query === 'string' || typeof format === 'string') {
            errorMessage = `No cards found matching the specified criteria`;
            if (typeof format === 'string') errorMessage += ` (format: ${format})`;
            if (typeof query === 'string') errorMessage += ` (query: "${query}")`;
            errorMessage += '. Try broadening your search criteria.';
          } else {
            errorMessage = 'Unable to find a random card. This is unusual - please try again.';
          }
        } else if (error.status === 422) {
          errorMessage = `Invalid search criteria. Check your query syntax and format specification.`;
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
