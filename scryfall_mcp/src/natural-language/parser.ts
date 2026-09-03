/**
 * @fileoverview Natural Language Parser for Scryfall Query Building
 * 
 * This module coordinates all pattern recognition engines to parse natural
 * language queries into structured concepts that can be converted to Scryfall
 * search syntax.
 */

import { 
  ParsedQuery, 
  QueryContext, 
  Ambiguity,
  ColorConcept,
  KeywordConcept,
  AbilityConcept,
  MechanicConcept,
  ManaCostConcept,
  StatConcept
} from './types.js';
import { ColorPatternEngine } from './extractors/color-extractor.js';
import { ArchetypePatternEngine } from './extractors/archetype-extractor.js';
import { PricePatternEngine } from './extractors/price-extractor.js';
import { TypePatternEngine } from './extractors/type-extractor.js';
import { FormatPatternEngine } from './extractors/format-extractor.js';
import { containsWholePhrase } from './text-matching.js';

type ExtractedConcepts = Omit<ParsedQuery, 'confidence' | 'ambiguities' | 'context'>;
type SupplementalConcepts = Pick<
  ExtractedConcepts,
  'keywords' | 'abilities' | 'mechanics' | 'manaCost' | 'powerToughness'
>;
type DeferredConcepts = Pick<
  ExtractedConcepts,
  'legality' | 'deckRoles' | 'strategies' | 'sets' | 'rarity' | 'timeConstraints' | 'namePatterns' | 'flavorText' | 'artist'
>;

/**
 * Main natural language parser that coordinates all extraction engines
 */
export class NaturalLanguageParser {
  private readonly colorEngine = new ColorPatternEngine();
  private readonly typeEngine = new TypePatternEngine();
  private readonly archetypeEngine = new ArchetypePatternEngine();
  private readonly priceEngine = new PricePatternEngine();
  private readonly formatEngine = new FormatPatternEngine();
  
  /**
   * Parse natural language query into structured concepts
   */
  parse(naturalQuery: string, context?: QueryContext): ParsedQuery {
    // Preprocess text
    const cleanedText = this.preprocessText(naturalQuery);
    
    // Extract all concepts
    const colors = this.colorEngine.extract(cleanedText);
    const types = this.typeEngine.extract(cleanedText);
    const subtypes = this.typeEngine.extractSubtypes(cleanedText);
    const archetypes = this.archetypeEngine.extract(cleanedText);
    const priceConstraints = this.priceEngine.extract(cleanedText);
    const formats = this.formatEngine.extract(cleanedText);
    const supplementalConcepts = this.extractSupplementalConcepts(cleanedText);
    const deferredConcepts = this.createDeferredConcepts();
    
    // Resolve conflicts and calculate confidence
    const resolved = this.resolveConflicts({
      colors,
      types,
      subtypes,
      archetypes,
      priceConstraints,
      formats,
      ...supplementalConcepts,
      ...deferredConcepts
    });
    
    return {
      ...resolved,
      confidence: this.calculateOverallConfidence(resolved),
      ambiguities: this.detectAmbiguities(resolved),
      context: context || {}
    };
  }
  
  /**
   * Preprocess text for better pattern matching
   */
  private preprocessText(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\w\s$.-]/g, ' ') // Remove special chars except $, ., -
      .replace(/\s+/g, ' ')        // Normalize whitespace
      .trim();
  }

  /**
   * Supplemental extraction currently supported directly in this parser.
   * Higher-signal domains such as color, type, price, archetype, and format
   * live in dedicated extractor modules instead.
   */
  private extractSupplementalConcepts(text: string): SupplementalConcepts {
    return {
      keywords: this.extractKeywords(text),
      abilities: this.extractAbilities(text),
      mechanics: this.extractMechanics(text),
      manaCost: this.extractManaCost(text),
      powerToughness: this.extractPowerToughness(text),
    };
  }

  /**
   * Concept categories that are part of the ParsedQuery contract but do not yet
   * have dedicated extractors in this parser. Keeping them centralized makes the
   * current capability boundary explicit instead of implying hidden logic.
   */
  private createDeferredConcepts(): DeferredConcepts {
    return {
      legality: [],
      deckRoles: [],
      strategies: [],
      sets: [],
      rarity: [],
      timeConstraints: [],
      namePatterns: [],
      flavorText: [],
      artist: [],
    };
  }
  
  /**
   * Extract directly named evergreen and common keyword abilities.
   */
  private extractKeywords(text: string): KeywordConcept[] {
    const keywords = ['flying', 'trample', 'haste', 'vigilance', 'lifelink', 'deathtouch', 'first strike', 'double strike'];
    return keywords
      .filter(keyword => containsWholePhrase(text, keyword))
      .map(keyword => ({ keyword, confidence: 0.85 }));
  }
  
  /**
   * Extract a small set of directly named multi-word abilities.
   */
  private extractAbilities(text: string): AbilityConcept[] {
    const abilities = ['enters the battlefield', 'when dies', 'tap to add', 'sacrifice to'];
    return abilities
      .filter(ability => containsWholePhrase(text, ability))
      .map(ability => ({ ability, confidence: 0.80 }));
  }
  
  /**
   * Extract a small set of explicitly named mechanics.
   */
  private extractMechanics(text: string): MechanicConcept[] {
    const mechanics = ['storm', 'cascade', 'flashback', 'madness', 'cycling'];
    return mechanics
      .filter(mechanic => containsWholePhrase(text, mechanic))
      .map(mechanic => ({ mechanic, confidence: 0.85 }));
  }
  
  /**
   * Extract simple mana-value constraints from natural-language text.
   */
  private extractManaCost(text: string): ManaCostConcept[] {
    const patterns = [
      /cmc\s*(\d+)/i,
      /mana cost\s*(\d+)/i,
      /costs?\s*(\d+)/i
    ];
    
    const constraints: ManaCostConcept[] = [];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        constraints.push({
          exact: parseInt(match[1]),
          confidence: 0.80
        });
      }
    }
    
    return constraints;
  }
  
  /**
   * Extract simple power/toughness constraints from natural-language text.
   */
  private extractPowerToughness(text: string): StatConcept[] {
    const patterns = [
      /power\s*(\d+)/i,
      /toughness\s*(\d+)/i,
      /(\d+)\/(\d+)/
    ];
    
    const constraints: StatConcept[] = [];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        if (pattern.source.includes('power')) {
          constraints.push({
            stat: 'power' as const,
            exact: parseInt(match[1]),
            confidence: 0.85
          });
        } else if (pattern.source.includes('toughness')) {
          constraints.push({
            stat: 'toughness' as const,
            exact: parseInt(match[1]),
            confidence: 0.85
          });
        }
      }
    }
    
    return constraints;
  }
  
  /**
   * Resolve conflicts between extracted concepts
   */
  private resolveConflicts(concepts: ExtractedConcepts): ParsedQuery {
    // Only color conflicts currently require normalization. Other concept
    // categories are returned as extracted until we add dedicated conflict
    // resolution rules for them.
    return {
      colors: this.resolveColorConflicts(concepts.colors),
      types: concepts.types,
      subtypes: concepts.subtypes,
      keywords: concepts.keywords,
      abilities: concepts.abilities,
      mechanics: concepts.mechanics,
      manaCost: concepts.manaCost,
      powerToughness: concepts.powerToughness,
      priceConstraints: concepts.priceConstraints,
      formats: concepts.formats,
      legality: concepts.legality,
      archetypes: concepts.archetypes,
      deckRoles: concepts.deckRoles,
      strategies: concepts.strategies,
      sets: concepts.sets,
      rarity: concepts.rarity,
      timeConstraints: concepts.timeConstraints,
      namePatterns: concepts.namePatterns,
      flavorText: concepts.flavorText,
      artist: concepts.artist,
      confidence: 0,
      ambiguities: [],
      context: {}
    };
  }
  
  /**
   * Resolve color conflicts (e.g., "red and blue" vs "only red")
   */
  private resolveColorConflicts(colors: ColorConcept[]): ColorConcept[] {
    if (colors.length <= 1) return colors;
    
    // If we have both exact and inclusive, prefer exact
    const hasExact = colors.some(c => c.exact);
    const hasInclusive = colors.some(c => c.inclusive);
    
    if (hasExact && hasInclusive) {
      return colors.filter(c => c.exact);
    }
    
    return colors;
  }
  
  /**
   * Calculate overall confidence score
   */
  private calculateOverallConfidence(parsed: ParsedQuery): number {
    const conceptConfidences = [
      ...parsed.colors.map(c => c.confidence),
      ...parsed.types.map(t => t.confidence),
      ...parsed.archetypes.map(a => a.confidence),
      ...parsed.priceConstraints.map(p => p.confidence),
      ...parsed.formats.map(f => f.confidence)
    ];
    
    if (conceptConfidences.length === 0) return 0;
    
    // Weighted average with bias toward higher confidence concepts
    return conceptConfidences.reduce((sum, conf) => {
      const weight = Math.pow(conf, 1.5); // Higher confidence gets more weight
      return sum + (conf * weight);
    }, 0) / conceptConfidences.length;
  }
  
  /**
   * Detect ambiguities in the parsed query
   */
  private detectAmbiguities(parsed: ParsedQuery): Ambiguity[] {
    const ambiguities: Ambiguity[] = [];
    
    // Check for color ambiguities
    if (parsed.colors.length > 1) {
      const colorNames = parsed.colors.map(c => c.colors.join('')).join(', ');
      ambiguities.push({
        type: 'color',
        description: `Multiple color interpretations found: ${colorNames}`,
        alternatives: parsed.colors.map(c => c.colors.join('')),
        confidence: 0.7
      });
    }
    
    // Check for format ambiguities
    if (parsed.formats.length > 1) {
      const formatNames = parsed.formats.map(f => f.name).join(', ');
      ambiguities.push({
        type: 'format',
        description: `Multiple format interpretations found: ${formatNames}`,
        alternatives: parsed.formats.map(f => f.name),
        confidence: 0.7
      });
    }
    
    return ambiguities;
  }
}
