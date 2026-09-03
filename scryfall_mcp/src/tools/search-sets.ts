import { ScryfallClient } from '../services/scryfall-client.js';
import { 
  validateSearchSetsParams,
  validateDateString 
} from '../utils/validators.js';
import { formatSetsAsText } from '../utils/formatters.js';
import { 
  ScryfallAPIError, 
  ValidationError,
  RateLimitError 
} from '../types/mcp-types.js';
import { SET_TYPES } from '../types/scryfall-api.js';

/**
 * MCP Tool for searching Magic: The Gathering sets
 */
export class SearchSetsTool {
  readonly name = 'search_sets';
  readonly description = 'Search for Magic: The Gathering sets with optional filtering by name, type, and release dates';
  
  readonly inputSchema = {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'Set name or code to search for (partial matches supported)'
      },
      type: {
        type: 'string',
        enum: [...SET_TYPES],
        description: 'Filter by set type. Common types: core (yearly core sets), expansion (rotational sets), masters (reprint sets), commander (preconstructed Commander decks), promo (promotional cards), token (tokens and emblems)'
      },
      released_after: {
        type: 'string',
        description: 'ISO date string - only show sets released after this date (YYYY-MM-DD)',
        pattern: '^\\d{4}-\\d{2}-\\d{2}$'
      },
      released_before: {
        type: 'string',
        description: 'ISO date string - only show sets released before this date (YYYY-MM-DD)',
        pattern: '^\\d{4}-\\d{2}-\\d{2}$'
      }
    },
    required: []
  };

  constructor(private readonly scryfallClient: ScryfallClient) {}

  async execute(args: unknown) {
    try {
      // Validate parameters
      const params = validateSearchSetsParams(args);

      // Validate date strings if provided
      if (params.released_after) {
        validateDateString(params.released_after);
      }
      if (params.released_before) {
        validateDateString(params.released_before);
      }

      // Validate date range logic
      if (params.released_after && params.released_before) {
        const afterDate = new Date(params.released_after);
        const beforeDate = new Date(params.released_before);
        
        if (afterDate >= beforeDate) {
          throw new ValidationError('released_after date must be before released_before date');
        }
      }

      // Execute sets search
      const sets = await this.scryfallClient.getSets({
        query: params.query,
        type: params.type,
        released_after: params.released_after,
        released_before: params.released_before
      });

      // Handle no results
      if (sets.length === 0) {
        let message = 'No sets found';
        const filters = [];
        
        if (params.query) filters.push(`name/code: "${params.query}"`);
        if (params.type) filters.push(`type: ${params.type}`);
        if (params.released_after) filters.push(`released after: ${params.released_after}`);
        if (params.released_before) filters.push(`released before: ${params.released_before}`);
        
        if (filters.length > 0) {
          message += ` matching criteria (${filters.join(', ')})`;
        }
        
        message += '. Try broadening your search criteria.';

        return {
          content: [
            {
              type: 'text',
              text: message
            }
          ]
        };
      }

      // Format sets for display
      const responseText = formatSetsAsText(sets);

      // Add search context
      let contextNote = '';
      const appliedFilters = [];
      
      if (params.query) appliedFilters.push(`name/code: "${params.query}"`);
      if (params.type) appliedFilters.push(`type: ${params.type}`);
      if (params.released_after) appliedFilters.push(`released after: ${params.released_after}`);
      if (params.released_before) appliedFilters.push(`released before: ${params.released_before}`);
      
      if (appliedFilters.length > 0) {
        contextNote = `\n\n*Filtered by: ${appliedFilters.join(', ')}*`;
      }

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
          errorMessage = 'No sets found. The Scryfall sets database may be temporarily unavailable.';
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
