import { ScryfallClient } from '../services/scryfall-client.js';
import { 
  validateGetCardParams, 
  validateCardIdentifier 
} from '../utils/validators.js';
import { sanitizeCardIdentifier } from '../utils/query-sanitizer.js';
import { formatCardDetails } from '../utils/formatters.js';
import { 
  ScryfallAPIError, 
  ValidationError,
  GetCardParams,
  RateLimitError
} from '../types/mcp-types.js';
import { generateRequestId } from '../types/mcp-errors.js';

/**
 * MCP Tool for retrieving a single Magic: The Gathering card
 */
export class GetCardTool {
  readonly name = 'get_card';
  readonly description = 'Get detailed information about a specific Magic: The Gathering card by name, set code+number, or Scryfall ID';
  
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
      },
      lang: {
        type: 'string',
        description: '2-letter language code (default: en)',
        pattern: '^[a-z]{2}$',
        default: 'en'
      },
      face: {
        type: 'string',
        enum: ['front', 'back'],
        description: 'Which face to show for double-faced cards'
      },
      include_image: {
        type: 'boolean',
        description: 'Include image URL in response',
        default: true
      }
    },
    required: ['identifier']
  };

  constructor(private readonly scryfallClient: ScryfallClient) {}

  async execute(args: unknown) {
    try {
      // Validate parameters
      const params = validateGetCardParams(args);
      
      // Sanitize and validate card identifier
      const sanitizedIdentifier = sanitizeCardIdentifier(params.identifier);
      validateCardIdentifier(sanitizedIdentifier);

      // Execute card lookup
      const card = await this.scryfallClient.getCard({
        identifier: sanitizedIdentifier,
        set: params.set,
        lang: params.lang,
        face: params.face
      });

      if (params.face === 'back' && !card.card_faces?.[1]) {
        return {
          content: [
            {
              type: 'text',
              text: `Back face is not available for "${card.name}".`
            }
          ],
          isError: true
        };
      }

      // Format detailed card information
      const responseText = formatCardDetails(card, params.include_image, params.face);

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
          errorMessage = `Card not found: "${(args as GetCardParams)?.identifier ?? 'unknown'}". Check the card name, set code, or ID.`;
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

      // Generic error handling with enhanced context
      const errorDetails = this.formatGenericError(error, args as GetCardParams);
      return {
        content: [
          {
            type: 'text',
            text: errorDetails
          }
        ],
        isError: true
      };
    }
  }

  /**
   * Format generic errors with enhanced context and debugging information
   */
  private formatGenericError(error: unknown, params?: GetCardParams): string {
    let message = "**Unexpected Error Occurred**\n\n";
    
    // Basic error information
    if (error instanceof Error) {
      message += `**Error Type:** ${error.constructor.name}\n`;
      message += `**Message:** ${error.message}\n`;
      
      // Include stack trace in development
      if (process.env.NODE_ENV === 'development' && error.stack) {
        const stackLines = error.stack.split('\n').slice(0, 5);
        message += `**Stack Trace:** \n\`\`\`\n${stackLines.join('\n')}\n\`\`\`\n`;
      }
    } else {
      message += `**Error:** ${String(error)}\n`;
    }
    
    // Request context
    if (params) {
      message += `\n**Request Context:**\n`;
      message += `• Identifier: "${params.identifier}"\n`;
      if (params.set) message += `• Set: ${params.set}\n`;
      if (params.lang) message += `• Language: ${params.lang}\n`;
      if (params.face) message += `• Face: ${params.face}\n`;
      message += `• Include Image: ${params.include_image}\n`;
    }
    
    // Debugging suggestions
    message += `\n**Troubleshooting Steps:**\n`;
    message += `1. Verify the card identifier is correct\n`;
    message += `2. Check if the card exists in the specified set\n`;
    message += `3. Try using the card's full name or Scryfall ID\n`;
    message += `4. Verify network connectivity\n`;
    
    // Error correlation ID
    const correlationId = generateRequestId();
    message += `\n**Error ID:** ${correlationId}\n`;
    message += `*Please include this ID when reporting the issue.*`;
    
    return message;
  }
}
