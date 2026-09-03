import { ScryfallClient } from '../services/scryfall-client.js';
import { validateCardIdentifier } from '../utils/validators.js';
import { formatCard } from '../utils/formatters.js';
import { ScryfallAPIError, ValidationError } from '../types/mcp-types.js';

/**
 * MCP Prompt for comprehensive card analysis
 */
export class AnalyzeCardPrompt {
  readonly name = 'analyze_card';
  readonly description = 'Generate a comprehensive analysis of a Magic: The Gathering card including competitive viability, format positioning, synergies, and deck building suggestions';
  
  readonly arguments = [
    {
      name: 'card_identifier',
      description: 'Card name, set code+collector number, or Scryfall ID',
      required: true
    },
    {
      name: 'format',
      description: 'Magic format to focus analysis on (standard, modern, legacy, vintage, commander)',
      required: false
    },
    {
      name: 'analysis_depth',
      description: 'Depth of analysis (basic, detailed, comprehensive)',
      required: false
    }
  ];

  constructor(private readonly scryfallClient: ScryfallClient) {}

  async generatePrompt(args: Record<string, string>): Promise<string> {
    try {
      const cardIdentifier = args.card_identifier;
      const format = args.format || 'modern';
      const analysisDepth = args.analysis_depth || 'detailed';

      if (!cardIdentifier) {
        throw new ValidationError('card_identifier is required');
      }

      // Validate and fetch card
      validateCardIdentifier(cardIdentifier);
      const card = await this.scryfallClient.getCard({ identifier: cardIdentifier });
      const formattedCard = formatCard(card);

      // Generate comprehensive analysis prompt
      const prompt = `# Magic: The Gathering Card Analysis

Please provide a comprehensive analysis of the following Magic: The Gathering card:

## Card Details
**Name:** ${formattedCard.name}
**Mana Cost:** ${formattedCard.mana_cost || 'N/A'}
**Type:** ${formattedCard.type_line}
**Oracle Text:** ${formattedCard.oracle_text || 'No text'}
${formattedCard.power && formattedCard.toughness ? `**Power/Toughness:** ${formattedCard.power}/${formattedCard.toughness}` : ''}
**Set:** ${formattedCard.set_name}
**Rarity:** ${formattedCard.rarity}

## Evidence Boundaries
- Treat only the card details, legalities, and displayed price supplied by Scryfall as sourced facts.
- Do not invent current metagame position, historical performance, price movement, reprint plans, tournament results, professional opinions, or future format impact.
- When current external evidence is unavailable, say so explicitly and frame strategic conclusions as analysis based on the supplied card text.
- Treat specific comparison or synergy cards as candidates until their Oracle text and legality are verified.

## Analysis Framework

Please analyze this card across the following dimensions:

### 1. Competitive Viability Assessment
- Rate the card's power level in ${format} format (1-10 scale)
- Identify key strengths and weaknesses
- Compare to similar cards in the format
- Assess mana efficiency and tempo impact

### 2. Format Legality and Strategic Positioning
- Current legal formats: ${Object.entries(formattedCard.legalities).map(([fmt, status]) => `${fmt}: ${status}`).join(', ')}
- Likely roles and archetypes in ${format}, clearly labeled as analysis
- Relevant strengths and constraints implied by the card text

### 3. Synergy Analysis
- Cards that synergize well with this card
- Archetype fit and role identification
- Combo potential and interactions
- Anti-synergies and cards that counter it

### 4. Deck Building Considerations
- Optimal deck archetypes for this card
- Manabase requirements and color considerations
- Curve positioning and role in game plan
- Sideboard considerations (if applicable)

### 5. Price and Accessibility
- Current market price: ${formattedCard.prices.usd ? `$${formattedCard.prices.usd}` : 'Not available'}
- Budget considerations based only on the displayed price
- Candidate alternatives, with a reminder that their current price and legality require verification

${analysisDepth === 'comprehensive' ? `
### 6. Advanced Analysis
- Rules interactions and edge cases
- Deeper strategic implications derived from the supplied card text
- Assumptions and uncertainties that could change the analysis

### 7. Casual and Commander Considerations
- Commander format viability
- Casual playgroup appeal
- Fun factor and memorable interactions
- Political implications in multiplayer
` : ''}

${analysisDepth === 'basic' ? `
Focus on providing a concise analysis covering the most important points for competitive play.
` : analysisDepth === 'detailed' ? `
Provide thorough analysis with specific examples and comparisons.
` : `
Provide exhaustive analysis with deep technical insights and comprehensive coverage.
`}

## Additional Context
- Focus primarily on ${format} format
- Include specific card names and examples where relevant
- Provide actionable insights for deck builders and players

Please structure your analysis clearly with headers and bullet points for easy reading.`;

      return prompt;

    } catch (error) {
      if (error instanceof ValidationError) {
        throw new Error(`Validation error: ${error.message}`);
      }

      if (error instanceof ScryfallAPIError) {
        if (error.status === 404) {
          throw new Error(`Card not found: "${args.card_identifier}". Please check the card name or identifier.`);
        }
        throw new Error(`Scryfall API error: ${error.message}`);
      }

      throw new Error(`Failed to generate card analysis prompt: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Gets example usage for this prompt
   */
  getExamples(): Array<{ description: string; arguments: Record<string, string> }> {
    return [
      {
        description: 'Analyze Lightning Bolt for Modern format',
        arguments: {
          card_identifier: 'Lightning Bolt',
          format: 'modern',
          analysis_depth: 'detailed'
        }
      },
      {
        description: 'Comprehensive analysis of a specific card printing',
        arguments: {
          card_identifier: 'dom/123',
          format: 'standard',
          analysis_depth: 'comprehensive'
        }
      },
      {
        description: 'Basic analysis for Commander format',
        arguments: {
          card_identifier: 'Sol Ring',
          format: 'commander',
          analysis_depth: 'basic'
        }
      }
    ];
  }
}
