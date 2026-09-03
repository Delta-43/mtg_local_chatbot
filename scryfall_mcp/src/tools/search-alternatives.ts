import { ScryfallClient } from '../services/scryfall-client.js';
import { ValidationError, ScryfallAPIError } from '../types/mcp-types.js';
import { formatSearchResultsAsText } from '../utils/formatters.js';
import { ScryfallCard } from '../types/scryfall-api.js';
import { normalizeLowercaseString, normalizeTrimmedString } from '../utils/input-normalization.js';
import { excludeLogicalCardFromQuery, isSameLogicalCard } from '../utils/card-identity.js';

interface SearchAlternativesInput {
  target_card: string;
  direction: string;
  format?: string;
  max_price?: number;
  min_price?: number;
  preserve_function?: boolean;
  limit?: number;
}

/**
 * MCP Tool for finding budget alternatives, upgrades, or functionally similar cards
 */
export class SearchAlternativesTool {
  readonly name = 'search_alternatives';
  readonly description = 'Find budget alternatives, upgrades, or functionally similar cards';

  readonly inputSchema = {
    type: 'object' as const,
    properties: {
      target_card: {
        type: 'string',
        description: 'Card to find alternatives for'
      },
      direction: {
        type: 'string',
        enum: ['cheaper', 'upgrade', 'similar'],
        description: 'Type of alternative to find'
      },
      format: {
        type: 'string',
        enum: ['standard', 'modern', 'legacy', 'vintage', 'commander', 'pioneer'],
        description: 'Format legality requirement'
      },
      max_price: {
        type: 'number',
        minimum: 0,
        description: 'Maximum price constraint'
      },
      min_price: {
        type: 'number',
        minimum: 0,
        description: 'Minimum price constraint'
      },
      preserve_function: {
        type: 'boolean',
        default: true,
        description: 'Maintain similar functionality'
      },
      limit: {
        type: 'number',
        default: 10,
        minimum: 1,
        maximum: 50,
        description: 'Number of alternatives to return'
      }
    },
    required: ['target_card', 'direction']
  };

  constructor(private readonly scryfallClient: ScryfallClient) {}

  private extractPrimaryCardType(typeLine: string): string | null {
    const normalized = typeLine.toLowerCase().split('—')[0];
    const typePriority = ['creature', 'instant', 'sorcery', 'artifact', 'enchantment', 'planeswalker', 'land', 'battle'];
    return typePriority.find(type => normalized.includes(type)) ?? null;
  }

  /**
   * Validate parameters
   */
  private validateParams(args: unknown): {
    target_card: string;
    direction: string;
    format?: string;
    max_price?: number;
    min_price?: number;
    preserve_function: boolean;
    limit: number;
  } {
    if (!args || typeof args !== 'object') {
      throw new ValidationError('Invalid parameters');
    }

    const params = args as SearchAlternativesInput;
    const normalizedTargetCard = normalizeTrimmedString(params.target_card);
    const normalizedDirection = normalizeLowercaseString(params.direction);
    const normalizedFormat = normalizeLowercaseString(params.format);

    if (!normalizedTargetCard || typeof normalizedTargetCard !== 'string') {
      throw new ValidationError('Target card is required and must be a string');
    }

    if (!normalizedDirection || typeof normalizedDirection !== 'string') {
      throw new ValidationError('Direction is required and must be a string');
    }

    const validDirections = ['cheaper', 'upgrade', 'similar'];
    if (!validDirections.includes(normalizedDirection)) {
      throw new ValidationError(`Direction must be one of: ${validDirections.join(', ')}`);
    }

    if (normalizedFormat) {
      const validFormats = ['standard', 'modern', 'legacy', 'vintage', 'commander', 'pioneer'];
      if (typeof normalizedFormat !== 'string' || !validFormats.includes(normalizedFormat)) {
        throw new ValidationError(`Format must be one of: ${validFormats.join(', ')}`);
      }
    }

    if (params.max_price !== undefined) {
      if (typeof params.max_price !== 'number' || params.max_price < 0) {
        throw new ValidationError('Max price must be a non-negative number');
      }
    }

    if (params.min_price !== undefined) {
      if (typeof params.min_price !== 'number' || params.min_price < 0) {
        throw new ValidationError('Min price must be a non-negative number');
      }
    }

    const preserveFunction = params.preserve_function ?? true;
    if (typeof preserveFunction !== 'boolean') {
      throw new ValidationError('Preserve function must be a boolean');
    }

    const limit = params.limit || 10;
    if (typeof limit !== 'number' || limit < 1 || limit > 50) {
      throw new ValidationError('Limit must be a number between 1 and 50');
    }

    return {
      target_card: normalizedTargetCard,
      direction: normalizedDirection,
      format: typeof normalizedFormat === 'string' ? normalizedFormat : undefined,
      max_price: params.max_price,
      min_price: params.min_price,
      preserve_function: preserveFunction,
      limit
    };
  }

  async execute(args: unknown) {
    try {
      // Validate parameters
      const params = this.validateParams(args);

      // First, get the target card to analyze its properties
      let targetCard;
      try {
        targetCard = await this.scryfallClient.getCard({ identifier: params.target_card });
      } catch (error) {
        if (error instanceof ScryfallAPIError && error.status === 404) {
          return {
            content: [
              {
                type: 'text',
                text: `Target card not found: "${params.target_card}". Please check the card name.`
              }
            ],
            isError: true
          };
        }
        throw error;
      }

      // Build search query for alternatives
      const query = excludeLogicalCardFromQuery(
        this.buildAlternativesQuery(targetCard, params),
        targetCard
      );

      // Execute search
      const results = await this.scryfallClient.searchCards({
        query,
        limit: params.limit,
        order: this.getOrderForDirection(params.direction),
        unique: 'cards'
      });

      // Filter out the original card from results
      const alternatives = results.data.filter(card => !isSameLogicalCard(card, targetCard));
      const filteredResults = {
        ...results,
        data: alternatives
      };

      // Format results
      let responseText = `**Alternatives for ${targetCard.name}** (${params.direction}):\n\n`;
      
      if (filteredResults.data.length === 0) {
        responseText += `No ${params.direction} alternatives found for "${targetCard.name}"`;
        if (params.format) {
          responseText += ` in ${params.format}`;
        }
        responseText += '. Try adjusting your search criteria.';
      } else {
        responseText += formatSearchResultsAsText(filteredResults);
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
      // Handle validation errors
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

  /**
   * Build search query for finding alternatives
   */
  private buildAlternativesQuery(targetCard: ScryfallCard, params: {
    direction: string;
    format?: string;
    max_price?: number;
    min_price?: number;
    preserve_function: boolean;
  }): string {
    let query = '';

    // Add format constraint
    if (params.format) {
      query += `f:${params.format} `;
    }

    // Add functional similarity constraints if requested
    if (params.preserve_function) {
      // Match primary type
      const primaryType = this.extractPrimaryCardType(targetCard.type_line);
      if (primaryType) {
        query += `t:${primaryType} `;
      }

      // Match mana value (within 1)
      const cmc = targetCard.cmc || 0;
      if (cmc > 0) {
        query += `(cmc:${cmc} OR cmc:${Math.max(0, cmc - 1)} OR cmc:${cmc + 1}) `;
      }
    }

    // Add price constraints based on direction
    const targetPrice = parseFloat(targetCard.prices.usd || '0');
    
    if (params.direction === 'cheaper' && targetPrice > 0) {
      const maxPrice = params.max_price || targetPrice * 0.8; // 20% cheaper by default
      query += `usd<=${maxPrice} `;
    } else if (params.direction === 'upgrade' && targetPrice > 0) {
      const minPrice = params.min_price || targetPrice * 1.2; // 20% more expensive by default
      query += `usd>=${minPrice} `;
    }

    // Add explicit price constraints
    if (params.max_price !== undefined) {
      query += `usd<=${params.max_price} `;
    }
    if (params.min_price !== undefined) {
      query += `usd>=${params.min_price} `;
    }

    return query.trim();
  }

  /**
   * Get sort order based on direction
   */
  private getOrderForDirection(direction: string): string {
    switch (direction) {
      case 'cheaper':
        return 'usd'; // Sort by price ascending (cheapest first)
      case 'upgrade':
        return 'edhrec'; // Sort by popularity for upgrades
      case 'similar':
        return 'name'; // Alphabetical for similar cards
      default:
        return 'name';
    }
  }
}
