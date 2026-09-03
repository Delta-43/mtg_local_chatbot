import { ScryfallClient } from '../services/scryfall-client.js';
import { RateLimitError, ValidationError, ScryfallAPIError } from '../types/mcp-types.js';
import { MagicFormat, ScryfallCard } from '../types/scryfall-api.js';
import { normalizeLowercaseString, normalizeTrimmedString } from '../utils/input-normalization.js';
import {
  buildBaseQuery,
  buildSynergyQueries,
  getFallbackQueries,
  normalizeColorIdentity
} from './find-synergistic-cards/query-builder.js';
import {
  filterAndDeduplicateResults,
  formatResultsWithSynergyExplanations,
  prioritizeResultsByLayer
} from './find-synergistic-cards/result-formatter.js';
import {
  FindSynergisticCardsInput,
  SynergyCard,
  SynergyLayer
} from './find-synergistic-cards/types.js';

const MAX_PRIMARY_QUERY_CANDIDATES = 15;
const MAX_FALLBACK_QUERY_CANDIDATES = 6;

interface ValidatedSynergyParams {
  focus_card: string;
  synergy_type?: string;
  format?: MagicFormat;
  exclude_colors?: string;
  max_cmc?: number;
  include_lands: boolean;
  limit: number;
  arena_only: boolean;
  color_identity?: string;
}

/**
 * MCP Tool for finding cards that synergize with a specific card, theme, or archetype
 */
export class FindSynergisticCardsTool {
  readonly name = 'find_synergistic_cards';
  readonly description = 'Find cards that synergize with a specific card, theme, or archetype';

  readonly inputSchema = {
    type: 'object' as const,
    properties: {
      focus_card: {
        type: 'string',
        description: 'Card name or theme to build around'
      },
      synergy_type: {
        type: 'string',
        enum: ['tribal', 'combo', 'archetype', 'keyword', 'theme', 'mechanic'],
        description: 'Type of synergy to discover'
      },
      format: {
        type: 'string',
        enum: ['standard', 'modern', 'legacy', 'vintage', 'commander', 'pioneer', 'brawl', 'standardbrawl'],
        description: 'Format legality requirement'
      },
      exclude_colors: {
        type: 'string',
        description: 'Colors to exclude from results (e.g., "rb" to exclude red and black)'
      },
      max_cmc: {
        type: 'number',
        minimum: 0,
        description: 'Maximum mana value'
      },
      include_lands: {
        type: 'boolean',
        default: true,
        description: 'Include synergistic lands'
      },
      limit: {
        type: 'number',
        default: 15,
        minimum: 1,
        maximum: 50,
        description: 'Number of synergistic cards to return'
      },
      arena_only: {
        type: 'boolean',
        default: false,
        description: 'Only return cards available in Arena'
      },
      color_identity: {
        type: 'string',
        description: 'Restrict results to this color identity (for example "UR", "Izzet", or "blue red")'
      }
    },
    required: ['focus_card']
  };

  constructor(private readonly scryfallClient: ScryfallClient) {}

  /**
   * Validate parameters
   */
  private validateParams(args: unknown): ValidatedSynergyParams {
    if (!args || typeof args !== 'object') {
      throw new ValidationError('Invalid parameters');
    }

    const params = args as FindSynergisticCardsInput;
    const normalizedFocusCard = normalizeTrimmedString(params.focus_card);
    const normalizedSynergyType = normalizeLowercaseString(params.synergy_type);
    const normalizedFormat = normalizeLowercaseString(params.format);
    const normalizedExcludeColors = normalizeLowercaseString(params.exclude_colors);
    const normalizedColorIdentity = normalizeColorIdentity(params.color_identity);

    if (!normalizedFocusCard || typeof normalizedFocusCard !== 'string') {
      throw new ValidationError('Focus card is required and must be a string');
    }

    if (normalizedSynergyType) {
      const validTypes = ['tribal', 'combo', 'archetype', 'keyword', 'theme', 'mechanic'];
      if (typeof normalizedSynergyType !== 'string' || !validTypes.includes(normalizedSynergyType)) {
        throw new ValidationError(`Synergy type must be one of: ${validTypes.join(', ')}`);
      }
    }

    if (normalizedFormat) {
      const validFormats = ['standard', 'modern', 'legacy', 'vintage', 'commander', 'pioneer', 'brawl', 'standardbrawl'];
      if (typeof normalizedFormat !== 'string' || !validFormats.includes(normalizedFormat)) {
        throw new ValidationError(`Format must be one of: ${validFormats.join(', ')}`);
      }
    }

    if (normalizedExcludeColors && typeof normalizedExcludeColors !== 'string') {
      throw new ValidationError('Exclude colors must be a string');
    }

    if (params.color_identity !== undefined && !normalizedColorIdentity) {
      throw new ValidationError('Color identity must include one or more Magic colors');
    }

    if (params.max_cmc !== undefined) {
      if (typeof params.max_cmc !== 'number' || params.max_cmc < 0) {
        throw new ValidationError('Max CMC must be a non-negative number');
      }
    }

    const includeLands = params.include_lands ?? true;
    if (typeof includeLands !== 'boolean') {
      throw new ValidationError('Include lands must be a boolean');
    }

    const limit = params.limit || 15;
    if (typeof limit !== 'number' || limit < 1 || limit > 50) {
      throw new ValidationError('Limit must be a number between 1 and 50');
    }

    const arenaOnly = params.arena_only ?? false;
    if (typeof arenaOnly !== 'boolean') {
      throw new ValidationError('Arena only must be a boolean');
    }

    return {
      focus_card: normalizedFocusCard,
      synergy_type: typeof normalizedSynergyType === 'string' ? normalizedSynergyType : undefined,
      format: typeof normalizedFormat === 'string' ? normalizedFormat as MagicFormat : undefined,
      exclude_colors: typeof normalizedExcludeColors === 'string' ? normalizedExcludeColors : undefined,
      max_cmc: params.max_cmc,
      include_lands: includeLands,
      limit,
      arena_only: arenaOnly,
      color_identity: normalizedColorIdentity
    };
  }

  async execute(args: unknown) {
    try {
      // Validate parameters
      const params = this.validateParams(args);

      // Try to get the focus card to analyze its properties
      let focusCard = null;
      try {
        focusCard = await this.scryfallClient.getCard({ identifier: params.focus_card });
      } catch (error) {
        // If card not found, treat focus_card as a theme/keyword
        if (!(error instanceof ScryfallAPIError && error.status === 404)) {
          throw error;
        }
      }

      // Build synergy search queries
      const queries = this.prioritizeQueries(
        buildSynergyQueries(focusCard, params),
        MAX_PRIMARY_QUERY_CANDIDATES
      );

      // Execute searches with multi-layered strategy
      const primarySearch = await this.searchQueries(
        queries,
        params.limit,
        index => this.getPrimaryLayer(index)
      );
      const allResults = [...primarySearch.results];
      let failedSearches = primarySearch.failedSearches;

      // If no results and theme-based, try broader searches
      if (allResults.length === 0 && !focusCard) {
        const fallbackBaseQuery = buildBaseQuery(params);
        const fallbackQueries = this.prioritizeQueries(
          getFallbackQueries(params.focus_card, fallbackBaseQuery),
          MAX_FALLBACK_QUERY_CANDIDATES
        );
        const fallbackSearch = await this.searchQueries(
          fallbackQueries,
          params.limit,
          () => 'thematic',
          1
        );
        allResults.push(...fallbackSearch.results);
        failedSearches += fallbackSearch.failedSearches;
      }

      // Remove duplicates and filter results with layered prioritization
      const uniqueResults = filterAndDeduplicateResults(allResults, focusCard, params.focus_card);
      const resultConstraints = this.getResultConstraints(params, focusCard);
      const constrainedResults = uniqueResults.filter(card => this.matchesResultConstraints(card, resultConstraints));
      const filteredResultCount = uniqueResults.length - constrainedResults.length;

      // Prioritize results by synergy layer (semantic > exact > thematic)
      const prioritizedResults = prioritizeResultsByLayer(constrainedResults);

      // Limit results
      const finalResults = prioritizedResults.slice(0, params.limit);

      // Format response
      let responseText = `**Synergistic cards for "${params.focus_card}"**`;
      if (params.synergy_type) {
        responseText += ` (${params.synergy_type} synergy)`;
      }
      responseText += ':\n\n';

      if (finalResults.length === 0) {
        responseText += `No synergistic cards found for "${params.focus_card}"`;
        if (params.format) {
          responseText += ` in ${params.format}`;
        }
        responseText += '. Try adjusting your search criteria or synergy type.';
      } else {
        const mockSearchResponse = {
          object: 'list' as const,
          total_cards: finalResults.length,
          has_more: false,
          data: finalResults
        };
        responseText += formatResultsWithSynergyExplanations(mockSearchResponse, focusCard, params.focus_card);
      }

      if (failedSearches > 0) {
        responseText += `\n\n⚠️ Some Scryfall searches failed (${failedSearches}). Results shown are partial.`;
      }

      if (filteredResultCount > 0) {
        responseText += `\n\nFiltered ${filteredResultCount} cards that did not match legality, Arena, or color-identity constraints.`;
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

      if (error instanceof RateLimitError) {
        const retry = error.retryAfter ? ` Retry after ${error.retryAfter}s.` : '';
        return {
          content: [
            {
              type: 'text',
              text: `Rate limit exceeded.${retry} Please wait and try again.`
            }
          ],
          isError: true
        };
      }

      if (error instanceof ScryfallAPIError && (error.status === 429 || error.status >= 500)) {
        return {
          content: [
            {
              type: 'text',
              text: `Scryfall API error: ${error.message}`
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

  private prioritizeQueries(queries: string[], maxQueries: number): string[] {
    return Array.from(new Set(queries.map(query => query.trim()).filter(Boolean))).slice(0, maxQueries);
  }

  private getPrimaryLayer(index: number): SynergyLayer {
    if (index < 10) {
      return 'semantic';
    }

    if (index < 20) {
      return 'exact';
    }

    return 'thematic';
  }

  private async searchQueries(
    queries: string[],
    targetUniqueResults: number,
    getLayer: (index: number) => SynergyLayer,
    stopAfterUniqueResults = targetUniqueResults
  ): Promise<{ results: SynergyCard[]; failedSearches: number }> {
    const allResults: SynergyCard[] = [];
    const uniqueResultIds = new Set<string>();
    let failedSearches = 0;

    for (const [index, query] of queries.entries()) {
      if (uniqueResultIds.size >= stopAfterUniqueResults) {
        break;
      }

      try {
        const perQueryLimit = this.getPerQueryLimit(
          index,
          targetUniqueResults,
          uniqueResultIds.size
        );
        const results = await this.scryfallClient.searchCards({
          query,
          limit: perQueryLimit,
          order: 'edhrec'
        });

        const layer = getLayer(index);
        for (const card of results.data) {
          if (uniqueResultIds.has(card.id)) {
            continue;
          }

          uniqueResultIds.add(card.id);
          allResults.push({
            ...card,
            _synergy_layer: layer,
            _synergy_query: query
          });
        }
      } catch (error) {
        if (
          error instanceof RateLimitError ||
          (error instanceof ScryfallAPIError && (error.status === 429 || error.status >= 500))
        ) {
          throw error;
        }
        failedSearches += 1;
        continue;
      }
    }

    return {
      results: allResults,
      failedSearches
    };
  }

  private getPerQueryLimit(
    queryIndex: number,
    targetUniqueResults: number,
    currentUniqueResults: number
  ): number {
    if (queryIndex === 0) {
      return Math.min(targetUniqueResults + 5, 20);
    }

    const remaining = Math.max(0, targetUniqueResults - currentUniqueResults);
    return Math.min(Math.max(5, remaining + 4), targetUniqueResults + 5);
  }

  private getResultConstraints(
    params: ValidatedSynergyParams,
    focusCard: ScryfallCard | null
  ): {
    format?: MagicFormat;
    arenaOnly: boolean;
    colorIdentity?: string;
  } {
    return {
      format: params.format,
      arenaOnly: params.arena_only,
      colorIdentity: params.color_identity ?? normalizeColorIdentity((focusCard?.color_identity || []).join('')),
    };
  }

  private matchesResultConstraints(
    card: SynergyCard,
    constraints: { format?: MagicFormat; arenaOnly: boolean; colorIdentity?: string }
  ): boolean {
    if (constraints.format && card.legalities?.[constraints.format] !== 'legal') {
      return false;
    }

    if (constraints.arenaOnly && !card.games?.includes('arena')) {
      return false;
    }

    if (constraints.colorIdentity) {
      const allowed = new Set(constraints.colorIdentity.split(''));
      const cardIdentity = normalizeColorIdentity((card.color_identity || []).join('')) ?? '';
      for (const color of cardIdentity) {
        if (!allowed.has(color)) {
          return false;
        }
      }
    }

    return true;
  }
}
