import { ScryfallClient } from '../services/scryfall-client.js';
import { validateCardIdentifier } from '../utils/validators.js';
import { formatCard } from '../utils/formatters.js';
import { ScryfallAPIError, ValidationError } from '../types/mcp-types.js';

/**
 * MCP Prompt for deck building around a specific card
 */
export class BuildDeckPrompt {
  readonly name = 'build_deck';
  readonly description = 'Generate a deck building guide centered around a specific Magic: The Gathering card, including strategy, supporting cards, manabase, and sideboard suggestions';
  
  readonly arguments = [
    {
      name: 'card_identifier',
      description: 'Card name, set code+collector number, or Scryfall ID to build around',
      required: true
    },
    {
      name: 'format',
      description: 'Magic format for the deck (standard, modern, legacy, vintage, commander, pioneer, brawl, standardbrawl)',
      required: true
    },
    {
      name: 'budget',
      description: 'Budget constraint (budget, mid-range, high-end, no-limit)',
      required: false
    },
    {
      name: 'playstyle',
      description: 'Preferred playstyle (aggro, midrange, control, combo, ramp)',
      required: false
    },
    {
      name: 'competitive_level',
      description: 'Target competitive level (casual, fnm, competitive, tournament)',
      required: false
    }
  ];

  constructor(private readonly scryfallClient: ScryfallClient) {}

  async generatePrompt(args: Record<string, string>): Promise<string> {
    try {
      const cardIdentifier = args.card_identifier;
      const format = args.format?.trim().toLowerCase();
      const budget = args.budget || 'mid-range';
      const playstyle = args.playstyle || 'flexible';
      const competitiveLevel = args.competitive_level || 'fnm';

      if (!cardIdentifier) {
        throw new ValidationError('card_identifier is required');
      }
      if (!format) {
        throw new ValidationError('format is required');
      }

      // Validate and fetch card
      validateCardIdentifier(cardIdentifier);
      const card = await this.scryfallClient.getCard({ identifier: cardIdentifier });
      const formattedCard = formatCard(card);

      // Check format legality
      const formatLegality = formattedCard.legalities[format.toLowerCase()];
      if (formatLegality !== 'legal' && formatLegality !== 'restricted') {
        throw new ValidationError(`Card "${formattedCard.name}" is not legal in ${format} format (status: ${formatLegality})`);
      }

      // Generate deck building prompt
      const prompt = `# Deck Building Guide: ${formattedCard.name} in ${format.toUpperCase()}

Build a competitive ${format} deck centered around the following card:

## Focus Card
**Name:** ${formattedCard.name}
**Mana Cost:** ${formattedCard.mana_cost || 'N/A'}
**Type:** ${formattedCard.type_line}
**Oracle Text:** ${formattedCard.oracle_text || 'No text'}
${formattedCard.power && formattedCard.toughness ? `**Power/Toughness:** ${formattedCard.power}/${formattedCard.toughness}` : ''}
**Rarity:** ${formattedCard.rarity}
**Current Price:** ${formattedCard.prices.usd ? `$${formattedCard.prices.usd}` : 'Not available'}

## Deck Building Parameters
- **Format:** ${format.toUpperCase()}
- **Budget:** ${budget}
- **Playstyle:** ${playstyle}
- **Competitive Level:** ${competitiveLevel}
- **Format Legality:** ${formatLegality}

## Evidence Boundaries
- Treat only the focus-card details, legality, and displayed price above as Scryfall-backed facts.
- Before presenting a final decklist, verify each recommended card's current Oracle text and ${format} legality with Scryfall-backed tools. If verification is unavailable, label that card as an unverified candidate.
- Do not claim current metagame share, matchup results, tournament tiers, or total deck price without additional current evidence.
- Clearly label strategic evaluations and matchup discussion as analysis rather than sourced fact.

## Deck Building Framework

Please create a comprehensive deck building guide covering:

### 1. Core Strategy Identification
- Primary win condition and game plan
- Role of the focus card in the strategy
- Backup win conditions
- Key synergies to exploit

### 2. Supporting Card Recommendations
- **Core Synergy Cards:** Cards that directly synergize with ${formattedCard.name}
- **Enablers:** Cards that help cast or activate the focus card
- **Protection:** Cards that protect the focus card or strategy
- **Tutors/Card Selection:** Ways to find the focus card consistently

### 3. Deck Structure and Curve
- Recommended mana curve distribution
- Number of copies of the focus card (and reasoning)
- Card type distribution (creatures, spells, etc.)
- Key ratios and deck building principles

### 4. Manabase Construction
- Color requirements and mana base needs
- Recommended land count
- Specific land recommendations
- Mana curve considerations

### 5. Complete Decklist Suggestion
Provide a sample ${['commander', 'brawl'].includes(format) ? '100' : format === 'standardbrawl' ? '60' : '60'}-card decklist including:
- Mainboard (${['commander', 'brawl'].includes(format) ? '99 cards + commander' : format === 'standardbrawl' ? '59 cards + commander' : '60 cards'})
${!['commander', 'brawl', 'standardbrawl'].includes(format) ? '- Sideboard (15 cards)' : ''}
- Specific card quantities and reasoning

### 6. Sideboard Strategy ${['commander', 'brawl', 'standardbrawl'].includes(format) ? '(N/A for Singleton Formats)' : ''}
${!['commander', 'brawl', 'standardbrawl'].includes(format) ? `
- Key matchups to sideboard against
- Sideboard card recommendations
- Sideboarding guide for common matchups
` : ''}

### 7. Budget Considerations
- Explain how the stated budget changes card-selection priorities
${budget === 'budget' ? '- Budget alternatives for expensive cards' : ''}
${budget === 'high-end' || budget === 'no-limit' ? '- Premium upgrades and optimizations' : ''}
- Upgrade path recommendations

### 8. Gameplay Guide
- Mulligan decisions
- Early game priorities
- Key decision points
- Common play patterns

### 9. Matchup Analysis
- Likely strategic strengths against broad archetypes, labeled as analysis
- Likely strategic weaknesses and possible adjustments, labeled as analysis
- Do not present current matchup percentages or metagame position without supporting data

### 10. Alternative Builds
- Different approaches to building around this card
- Archetype variations
- Hybrid strategies

## Additional Requirements
- Verify each recommended card is legal in ${format}, or explicitly mark it unverified
- Provide specific card names, not just categories
- Include reasoning for each major deck building decision
- Consider both best-case and realistic scenarios

${competitiveLevel === 'tournament' ? `
## Tournament Considerations
- Explain tournament-relevant consistency and resilience considerations
- Mark any tournament-specific or metagame-specific claim as unverified unless supporting data is available
` : ''}

${format === 'commander' ? `
## Commander-Specific Considerations
- Political implications and threat assessment
- Multiplayer dynamics
- Casual vs competitive builds
- Social contract considerations
` : ''}

${['brawl', 'standardbrawl'].includes(format) ? `
## Brawl-Specific Considerations
- Arena meta and digital considerations
- Singleton deck construction constraints
- Commander color identity restrictions
- ${format === 'brawl' ? 'Historic card pool (100 cards)' : 'Standard card pool (60 cards)'}
- Arena-only card availability requirement
- Best-of-one gameplay optimization
` : ''}

Please structure the guide with clear sections and provide actionable advice for deck builders at the ${competitiveLevel} level.`;

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

      throw new Error(`Failed to generate deck building prompt: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Gets example usage for this prompt
   */
  getExamples(): Array<{ description: string; arguments: Record<string, string> }> {
    return [
      {
        description: 'Build a budget Modern deck around Lightning Bolt',
        arguments: {
          card_identifier: 'Lightning Bolt',
          format: 'modern',
          budget: 'budget',
          playstyle: 'aggro',
          competitive_level: 'fnm'
        }
      },
      {
        description: 'Tournament-level Standard deck around a specific card',
        arguments: {
          card_identifier: 'Teferi, Hero of Dominaria',
          format: 'standard',
          budget: 'high-end',
          playstyle: 'control',
          competitive_level: 'tournament'
        }
      },
      {
        description: 'Commander deck building guide',
        arguments: {
          card_identifier: 'Atraxa, Praetors\' Voice',
          format: 'commander',
          budget: 'mid-range',
          playstyle: 'midrange',
          competitive_level: 'casual'
        }
      }
    ];
  }
}
