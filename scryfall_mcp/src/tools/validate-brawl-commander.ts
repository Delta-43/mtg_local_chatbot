import { ScryfallClient } from '../services/scryfall-client.js';
import { ValidationError, ScryfallAPIError } from '../types/mcp-types.js';
import { validateCardIdentifier } from '../utils/validators.js';
import { formatCard } from '../utils/formatters.js';
import { ScryfallCard } from '../types/scryfall-api.js';
import { normalizeLowercaseString, normalizeTrimmedString } from '../utils/input-normalization.js';

interface ValidateBrawlCommanderInput {
  card_identifier: string;
  format: 'brawl' | 'standardbrawl';
}

/**
 * MCP Tool for validating if a card can be a legal Brawl commander
 */
export class ValidateBrawlCommanderTool {
  readonly name = 'validate_brawl_commander';
  readonly description = 'Validate if a card can be a legal commander in Brawl or Standard Brawl formats';

  readonly inputSchema = {
    type: 'object' as const,
    properties: {
      card_identifier: {
        type: 'string',
        description: 'Card name, set code+collector number, or Scryfall ID to validate'
      },
      format: {
        type: 'string',
        enum: ['brawl', 'standardbrawl'],
        description: 'Brawl format to validate for (brawl = Historic Brawl, standardbrawl = Standard Brawl)'
      }
    },
    required: ['card_identifier', 'format']
  };

  constructor(private readonly scryfallClient: ScryfallClient) {}

  /**
   * Validate parameters
   */
  private validateParams(args: unknown): {
    card_identifier: string;
    format: 'brawl' | 'standardbrawl';
  } {
    if (!args || typeof args !== 'object') {
      throw new ValidationError('Invalid parameters');
    }

    const params = args as ValidateBrawlCommanderInput;
    const normalizedIdentifier = normalizeTrimmedString(params.card_identifier);
    const normalizedFormat = normalizeLowercaseString(params.format);

    if (!normalizedIdentifier || typeof normalizedIdentifier !== 'string') {
      throw new ValidationError('Card identifier is required and must be a string');
    }

    if (!normalizedFormat || typeof normalizedFormat !== 'string') {
      throw new ValidationError('Format is required and must be a string');
    }

    const validFormats = ['brawl', 'standardbrawl'];
    if (!validFormats.includes(normalizedFormat)) {
      throw new ValidationError(`Format must be one of: ${validFormats.join(', ')}`);
    }

    return {
      card_identifier: normalizedIdentifier,
      format: normalizedFormat as 'brawl' | 'standardbrawl'
    };
  }

  async execute(args: unknown) {
    try {
      // Validate parameters
      const params = this.validateParams(args);

      // Validate card identifier format
      validateCardIdentifier(params.card_identifier);

      // Fetch card data
      const card = await this.scryfallClient.getCard({ identifier: params.card_identifier });
      const formattedCard = formatCard(card);

      // Validate commander eligibility
      const validation = this.validateCommander(card, params.format);

      // Format response
      let responseText = `**Brawl Commander Validation: ${formattedCard.name}**\n\n`;
      responseText += `**Format:** ${params.format === 'brawl' ? 'Historic Brawl (100 cards)' : 'Standard Brawl (60 cards)'}\n`;
      responseText += `**Card Type:** ${formattedCard.type_line}\n`;
      responseText += `**Color Identity:** ${formattedCard.color_identity?.join('') || 'Colorless'}\n`;
      responseText += `**Arena Availability:** ${validation.arenaAvailable ? '✅ Available' : '❌ Not Available'}\n`;
      responseText += `**Format Legality:** ${validation.formatLegal ? '✅ Legal' : '❌ Not Legal'}\n`;
      responseText += `**Commander Eligible:** ${validation.commanderEligible ? '✅ Yes' : '❌ No'}\n\n`;

      if (validation.isValid) {
        responseText += `✅ **VALID COMMANDER**\n\n`;
        responseText += `${formattedCard.name} can be used as a commander in ${params.format === 'brawl' ? 'Historic Brawl' : 'Standard Brawl'}.\n\n`;
        responseText += `**Deck Building Constraints:**\n`;
        responseText += `- Deck size: ${params.format === 'brawl' ? '100' : '60'} cards (including commander)\n`;
        responseText += `- Color identity: ${formattedCard.color_identity?.join('') || 'Colorless'} only\n`;
        responseText += `- Card pool: ${params.format === 'brawl' ? 'Historic-legal' : 'Standard-legal'} cards\n`;
        responseText += `- Platform: Arena only\n`;
        responseText += `- Singleton: No duplicates except basic lands\n`;
      } else {
        responseText += `❌ **INVALID COMMANDER**\n\n`;
        responseText += `**Issues Found:**\n`;
        validation.issues.forEach(issue => {
          responseText += `- ${issue}\n`;
        });
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

      // Handle API errors
      if (error instanceof ScryfallAPIError) {
        let errorMessage = `Scryfall API error: ${error.message}`;
        
        if (error.status === 404) {
          const identifier = args && typeof args === 'object' && 'card_identifier' in args
            ? args.card_identifier
            : 'unknown';
          errorMessage = `Card not found: "${typeof identifier === 'string' ? identifier : 'unknown'}". Please check the card name or identifier.`;
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

  /**
   * Validate if a card can be a Brawl commander
   */
  private validateCommander(card: ScryfallCard, format: 'brawl' | 'standardbrawl'): {
    isValid: boolean;
    commanderEligible: boolean;
    formatLegal: boolean;
    arenaAvailable: boolean;
    issues: string[];
  } {
    const issues: string[] = [];
    let commanderEligible = false;
    let formatLegal = false;
    let arenaAvailable = false;

    // Check if card is legendary
    const isLegendary = card.type_line?.toLowerCase().includes('legendary') || false;
    
    // Check if card is a creature or planeswalker
    const isCreature = card.type_line?.toLowerCase().includes('creature') || false;
    const isPlaneswalker = card.type_line?.toLowerCase().includes('planeswalker') || false;
    
    commanderEligible = isLegendary && (isCreature || isPlaneswalker);
    
    if (!isLegendary) {
      issues.push('Card must be legendary');
    }
    if (!isCreature && !isPlaneswalker) {
      issues.push('Card must be a creature or planeswalker');
    }

    // Check format legality
    const legalities = card.legalities || {};
    formatLegal = legalities[format] === 'legal';
    
    if (!formatLegal) {
      issues.push(`Card is not legal in ${format} (status: ${legalities[format] || 'unknown'})`);
    }

    // Check Arena availability
    const games = card.games || [];
    arenaAvailable = games.includes('arena');
    
    if (!arenaAvailable) {
      issues.push('Card is not available in Arena');
    }

    const isValid = commanderEligible && formatLegal && arenaAvailable;

    return {
      isValid,
      commanderEligible,
      formatLegal,
      arenaAvailable,
      issues
    };
  }
}
