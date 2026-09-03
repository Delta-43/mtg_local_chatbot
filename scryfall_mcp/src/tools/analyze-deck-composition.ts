import { ScryfallClient } from '../services/scryfall-client.js';
import { RateLimitError, ValidationError } from '../types/mcp-types.js';
import { Color, Rarity, ScryfallCard } from '../types/scryfall-api.js';
import { normalizeLowercaseString } from '../utils/input-normalization.js';
import {
  FetchCardsMapResult,
  fetchCardMapWithDiagnostics,
} from './batch-card-analysis/fetcher.js';

interface AnalyzeDeckCompositionInput {
  deck_list: string;
  format?: string;
  strategy?: string;
}

interface DeckAnalysisParams {
  deck_list: string;
  format?: string;
  strategy: string;
}

export interface DeckCardEntry {
  name: string;
  quantity: number;
}

interface PriceEntry {
  name: string;
  price: number;
  quantity: number;
}

interface DeckCompositionAnalysis {
  requestedCards: number;
  totalCards: number;
  manaCurve: Record<number, number>;
  typeBreakdown: Record<string, number>;
  colorBreakdown: Partial<Record<Color, number>>;
  rarityBreakdown: Partial<Record<Rarity, number>>;
  averageCMC: number;
  expensiveCards: PriceEntry[];
  keyCards: string[];
}

interface DeckFetchWarnings {
  rateLimitError?: RateLimitError;
  analyzedCardNames: number;
  totalCardNames: number;
  fuzzyResolutions: FetchCardsMapResult['fuzzyResolutions'];
  unresolvedEntries: DeckCardEntry[];
  recommendationsOmitted: boolean;
}

function getExpectedLandCount(format: string | undefined, totalCards: number): number {
  if (format === 'commander') {
    return 37;
  }

  if (format === 'brawl' && totalCards >= 90) {
    return 38;
  }

  return 24;
}

export function parseDeckListEntries(deckList: string): DeckCardEntry[] {
  const quantities = new Map<string, number>();

  for (const rawLine of deckList.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line === 'Commander' || line === 'Deck') {
      continue;
    }

    const match = line.match(/^(?:(\d+)x?\s+)?(.+?)(?:\s+\([A-Z0-9]+\)\s+[A-Za-z0-9]+)?$/i);
    if (!match) {
      continue;
    }

    const quantity = match[1] ? parseInt(match[1], 10) : 1;
    const cardName = match[2].trim();
    if (!cardName) {
      continue;
    }

    quantities.set(cardName, (quantities.get(cardName) || 0) + quantity);
  }

  return Array.from(quantities.entries()).map(([name, quantity]) => ({ name, quantity }));
}

/**
 * MCP Tool for analyzing deck composition, mana curve, and balance
 */
export class AnalyzeDeckCompositionTool {
  readonly name = 'analyze_deck_composition';
  readonly description = 'Analyze deck composition, mana curve, card types, and provide balance recommendations';

  readonly inputSchema = {
    type: 'object' as const,
    properties: {
      deck_list: {
        type: 'string',
        description: 'Deck list with one card per line, optionally prefixed by a quantity (Arena headers and set suffixes are accepted)'
      },
      format: {
        type: 'string',
        enum: ['standard', 'modern', 'legacy', 'vintage', 'commander', 'pioneer', 'brawl', 'standardbrawl'],
        description: 'Format to analyze for (affects recommendations)'
      },
      strategy: {
        type: 'string',
        enum: ['aggro', 'midrange', 'control', 'combo', 'ramp', 'tribal', 'unknown'],
        default: 'unknown',
        description: 'Deck strategy archetype'
      }
    },
    required: ['deck_list']
  };

  constructor(private readonly scryfallClient: ScryfallClient) {}

  /**
   * Validate parameters
   */
  private validateParams(args: unknown): DeckAnalysisParams {
    if (!args || typeof args !== 'object') {
      throw new ValidationError('Invalid parameters');
    }

    const params = args as AnalyzeDeckCompositionInput;
    const normalizedFormat = normalizeLowercaseString(params.format);
    const normalizedStrategy = normalizeLowercaseString(params.strategy);

    if (!params.deck_list || typeof params.deck_list !== 'string') {
      throw new ValidationError('Deck list is required and must be a string');
    }

    if (normalizedFormat) {
      const validFormats = ['standard', 'modern', 'legacy', 'vintage', 'commander', 'pioneer', 'brawl', 'standardbrawl'];
      if (typeof normalizedFormat !== 'string' || !validFormats.includes(normalizedFormat)) {
        throw new ValidationError(`Format must be one of: ${validFormats.join(', ')}`);
      }
    }

    const strategy = (typeof normalizedStrategy === 'string' ? normalizedStrategy : undefined) || 'unknown';
    const validStrategies = ['aggro', 'midrange', 'control', 'combo', 'ramp', 'tribal', 'unknown'];
    if (!validStrategies.includes(strategy)) {
      throw new ValidationError(`Strategy must be one of: ${validStrategies.join(', ')}`);
    }

    return {
      deck_list: params.deck_list.trim(),
      format: typeof normalizedFormat === 'string' ? normalizedFormat : undefined,
      strategy
    };
  }

  async execute(args: unknown) {
    try {
      const params = this.validateParams(args);
      
      // Parse deck list
      const deckEntries = this.parseDeckList(params.deck_list);
      
      if (deckEntries.length === 0) {
        return {
          content: [{
            type: 'text',
            text: 'No valid card names found in deck list. Please provide one card per line, optionally prefixed by a quantity.'
          }],
          isError: true
        };
      }

      // Fetch card data
      const fetchResult = await this.fetchCardData(deckEntries);
      const cardData = fetchResult.cards;

      if (fetchResult.fatalError) {
        throw fetchResult.fatalError;
      }

      if (fetchResult.rateLimitError && cardData.size === 0) {
        return {
          content: [{
            type: 'text',
            text: this.formatRateLimitFailure(fetchResult.rateLimitError)
          }],
          isError: true
        };
      }
      
      if (cardData.size === 0) {
        return {
          content: [{
            type: 'text',
            text: 'Unable to fetch data for any cards in the deck list. Please check card names and try again.'
          }],
          isError: true
        };
      }

      // Analyze composition
      const analysis = this.analyzeComposition(deckEntries, cardData);
      
      // Generate recommendations
      const recommendationsOmitted = analysis.totalCards !== analysis.requestedCards;
      const recommendations = recommendationsOmitted
        ? []
        : this.generateRecommendations(analysis, params);
      
      // Format response
      const responseText = this.formatAnalysisResponse(analysis, recommendations, params, {
        rateLimitError: fetchResult.rateLimitError,
        analyzedCardNames: cardData.size,
        totalCardNames: deckEntries.length,
        fuzzyResolutions: fetchResult.fuzzyResolutions,
        unresolvedEntries: deckEntries.filter(entry => fetchResult.notFound.includes(entry.name)),
        recommendationsOmitted,
      });
      
      return {
        content: [{
          type: 'text',
          text: responseText
        }]
      };

    } catch (error) {
      if (error instanceof ValidationError) {
        return {
          content: [{
            type: 'text',
            text: `Validation error: ${error.message}`
          }],
          isError: true
        };
      }

      return {
        content: [{
          type: 'text',
          text: `Unexpected error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`
        }],
        isError: true
      };
    }
  }

  /**
   * Parse deck list into individual card names
   */
  private parseDeckList(deckList: string): DeckCardEntry[] {
    return parseDeckListEntries(deckList);
  }

  /**
   * Fetch card data for all cards in the deck
   */
  private async fetchCardData(deckEntries: DeckCardEntry[]): Promise<FetchCardsMapResult> {
    return fetchCardMapWithDiagnostics(
      this.scryfallClient,
      deckEntries.map(({ name }) => name),
      { skipNotFound: true, match: 'exact', fallbackToFuzzy: true }
    );
  }

  private formatRateLimitFailure(error: RateLimitError): string {
    const retry = error.retryAfter ? ` Retry after ${error.retryAfter}s.` : '';
    return `Rate limit exceeded.${retry} No deck analysis was produced.`;
  }

  /**
   * Analyze deck composition
   */
  private analyzeComposition(deckEntries: DeckCardEntry[], cardData: Map<string, ScryfallCard>): DeckCompositionAnalysis {
    const analysis: DeckCompositionAnalysis = {
      requestedCards: deckEntries.reduce((sum, entry) => sum + entry.quantity, 0),
      totalCards: 0,
      manaCurve: {},
      typeBreakdown: {},
      colorBreakdown: {},
      rarityBreakdown: {},
      averageCMC: 0,
      expensiveCards: [],
      keyCards: []
    };

    let totalCMC = 0;
    
    // Analyze each card
    for (const entry of deckEntries) {
      const card = cardData.get(entry.name);
      if (!card) continue;

      const quantity = entry.quantity;
      analysis.totalCards += quantity;
      const cmc = card.cmc || 0;
      const types = card.type_line?.toLowerCase() || '';
      const colors = card.color_identity || [];
      const rarity = card.rarity || 'common';
      const price = parseFloat(card.prices?.usd || '0');
      
      // Mana curve
      analysis.manaCurve[cmc] = (analysis.manaCurve[cmc] || 0) + quantity;
      totalCMC += cmc * quantity;
      
      // Type breakdown
      if (types.includes('creature')) {
        analysis.typeBreakdown.creatures = (analysis.typeBreakdown.creatures || 0) + quantity;
      } else if (types.includes('instant')) {
        analysis.typeBreakdown.instants = (analysis.typeBreakdown.instants || 0) + quantity;
      } else if (types.includes('sorcery')) {
        analysis.typeBreakdown.sorceries = (analysis.typeBreakdown.sorceries || 0) + quantity;
      } else if (types.includes('artifact')) {
        analysis.typeBreakdown.artifacts = (analysis.typeBreakdown.artifacts || 0) + quantity;
      } else if (types.includes('enchantment')) {
        analysis.typeBreakdown.enchantments = (analysis.typeBreakdown.enchantments || 0) + quantity;
      } else if (types.includes('planeswalker')) {
        analysis.typeBreakdown.planeswalkers = (analysis.typeBreakdown.planeswalkers || 0) + quantity;
      }

      // Land membership is independent because cards such as Artifact Lands
      // and Land Creatures still count toward deck land totals.
      if (types.includes('land')) {
        analysis.typeBreakdown.lands = (analysis.typeBreakdown.lands || 0) + quantity;
      }
      
      // Color breakdown
      for (const color of colors) {
        analysis.colorBreakdown[color] = (analysis.colorBreakdown[color] || 0) + quantity;
      }
      
      // Rarity breakdown
      analysis.rarityBreakdown[rarity] = (analysis.rarityBreakdown[rarity] || 0) + quantity;
      
      // Expensive cards (>$5)
      if (price > 5) {
        analysis.expensiveCards.push({ name: card.name, price, quantity });
      }
      
      // Key cards (mythic/rare with relevant abilities)
      if ((rarity === 'mythic' || rarity === 'rare') && card.oracle_text) {
        analysis.keyCards.push(card.name);
      }
    }
    
    analysis.averageCMC = analysis.totalCards > 0 ? totalCMC / analysis.totalCards : 0;
    
    // Sort expensive cards by price
    analysis.expensiveCards.sort((a, b) => b.price - a.price);
    
    return analysis;
  }

  /**
   * Generate recommendations based on analysis
   */
  private generateRecommendations(analysis: DeckCompositionAnalysis, params: DeckAnalysisParams): string[] {
    const recommendations: string[] = [];
    const { strategy, format } = params;
    
    // Mana curve recommendations
    if (analysis.averageCMC > 4 && strategy === 'aggro') {
      recommendations.push('⚡ Mana curve too high for aggro - consider more 1-2 mana cards');
    } else if (analysis.averageCMC < 2.5 && strategy === 'control') {
      recommendations.push('🏰 Mana curve too low for control - consider more high-impact cards');
    }
    
    // Land count recommendations
    const landCount = analysis.typeBreakdown.lands || 0;
    const expectedLands = getExpectedLandCount(format, analysis.requestedCards);
    
    if (landCount < expectedLands - 2) {
      recommendations.push(`🌍 Consider adding ${expectedLands - landCount} more lands`);
    } else if (landCount > expectedLands + 2) {
      recommendations.push(`🌍 Consider reducing lands by ${landCount - expectedLands}`);
    }
    
    // Creature count recommendations
    const creatureCount = analysis.typeBreakdown.creatures || 0;
    const totalNonLands = analysis.totalCards - landCount;
    
    if (strategy === 'aggro' && creatureCount < totalNonLands * 0.6) {
      recommendations.push('⚔️ Aggro decks typically want 60%+ creatures');
    } else if (strategy === 'control' && creatureCount > totalNonLands * 0.3) {
      recommendations.push('🛡️ Control decks typically want fewer creatures');
    }
    
    // Color balance recommendations
    const colorCount = Object.keys(analysis.colorBreakdown).length;
    if (colorCount > 3) {
      recommendations.push('🎨 Consider focusing on fewer colors for better consistency');
    }
    
    // Expensive cards warning
    if (analysis.expensiveCards.length > 5) {
      const totalCost = analysis.expensiveCards.reduce((sum, card) => sum + (card.price * card.quantity), 0);
      recommendations.push(`💰 Deck contains ${analysis.expensiveCards.length} expensive cards (total: $${totalCost.toFixed(2)})`);
    }
    
    return recommendations;
  }

  /**
   * Format analysis response
   */
  private formatAnalysisResponse(
    analysis: DeckCompositionAnalysis,
    recommendations: string[],
    params: DeckAnalysisParams,
    warnings?: DeckFetchWarnings
  ): string {
    let response = `**Deck Composition Analysis**\n\n`;

    if (warnings?.rateLimitError) {
      const retry = warnings.rateLimitError.retryAfter ? ` Retry after ${warnings.rateLimitError.retryAfter}s.` : '';
      const missed = Math.max(0, warnings.totalCardNames - warnings.analyzedCardNames);
      response += `⚠️ **Partial analysis:** Rate limit exceeded.${retry} `;
      response += `${missed} card name${missed === 1 ? '' : 's'} `;
      response += `${missed === 1 ? 'was' : 'were'} not analyzed.\n\n`;
    }

    if (warnings?.fuzzyResolutions.length) {
      response += `ℹ️ **Fuzzy name resolutions:**\n`;
      for (const resolution of warnings.fuzzyResolutions.slice(0, 10)) {
        response += `• ${resolution.requestedName} -> ${resolution.resolvedName}\n`;
      }
      if (warnings.fuzzyResolutions.length > 10) {
        response += `• ${warnings.fuzzyResolutions.length - 10} more\n`;
      }
      response += '\n';
    }

    if (warnings?.unresolvedEntries.length) {
      response += `⚠️ **Cards not found:**\n`;
      for (const entry of warnings.unresolvedEntries) {
        response += `• ${entry.quantity}x ${entry.name}\n`;
      }
      response += '\n';
    }
    
    // Basic stats
    response += `📊 **Overview:**\n`;
    response += `• Total Cards: ${analysis.requestedCards}\n`;
    if (analysis.totalCards !== analysis.requestedCards) {
      response += `• Analyzed Cards: ${analysis.totalCards} of ${analysis.requestedCards}\n`;
    }
    response += `• Average CMC: ${analysis.averageCMC.toFixed(2)}\n`;
    if (params.strategy !== 'unknown') {
      response += `• Strategy: ${params.strategy}\n`;
    }
    if (params.format) {
      response += `• Format: ${params.format}\n`;
    }
    response += '\n';
    
    // Mana curve
    response += `⚡ **Mana Curve:**\n`;
    const displayedManaValues = Object.entries(analysis.manaCurve)
      .filter(([manaValue]) => Number(manaValue) < 7)
      .sort(([left], [right]) => Number(left) - Number(right));
    const highManaCount = Object.entries(analysis.manaCurve)
      .filter(([manaValue]) => Number(manaValue) >= 7)
      .reduce((sum, [, quantity]) => sum + quantity, 0);
    for (const [manaValue, count] of [...displayedManaValues, ['7+', highManaCount] as const]) {
      if (count > 0) {
        const bar = '█'.repeat(Math.max(1, Math.floor(count / 2)));
        response += `• ${manaValue} CMC: ${count} ${bar}\n`;
      }
    }
    response += '\n';
    
    // Type breakdown
    response += `🃏 **Card Types:**\n`;
    for (const [type, count] of Object.entries(analysis.typeBreakdown)) {
      response += `• ${type}: ${count}\n`;
    }
    response += '\n';
    
    // Color breakdown
    if (Object.keys(analysis.colorBreakdown).length > 0) {
      response += `🎨 **Color Identity:**\n`;
      const colorNames = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' };
      for (const [color, count] of Object.entries(analysis.colorBreakdown)) {
        const colorName = colorNames[color as keyof typeof colorNames] || color;
        response += `• ${colorName}: ${count}\n`;
      }
      response += '\n';
    }
    
    if (warnings?.recommendationsOmitted) {
      response += `⚠️ **Recommendations omitted:** one or more requested cards could not be analyzed.\n\n`;
    }

    // Recommendations
    if (recommendations.length > 0) {
      response += `💡 **Recommendations:**\n`;
      for (const rec of recommendations) {
        response += `${rec}\n`;
      }
      response += '\n';
    }
    
    // Expensive cards
    if (analysis.expensiveCards.length > 0) {
      response += `💰 **Most Expensive Cards:**\n`;
      for (const card of analysis.expensiveCards.slice(0, 5)) {
        response += `• ${card.quantity}x ${card.name}: $${card.price.toFixed(2)} each\n`;
      }
      response += '\n';
    }
    
    // Key cards
    if (analysis.keyCards.length > 0) {
      response += `⭐ **Key Cards:**\n`;
      for (const cardName of analysis.keyCards.slice(0, 8)) {
        response += `• ${cardName}\n`;
      }
    }
    
    return response;
  }
}
