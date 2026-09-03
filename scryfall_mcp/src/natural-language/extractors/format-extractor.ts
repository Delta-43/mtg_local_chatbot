/**
 * @fileoverview Format Pattern Engine for Natural Language Processing
 * 
 * This module handles the extraction and interpretation of format-related
 * concepts from natural language queries, including Magic formats and
 * legality constraints.
 */

import { FormatConcept } from '../types.js';

/**
 * Engine for extracting format concepts from natural language
 */
export class FormatPatternEngine {
  private readonly formatPatterns = new Map([
    // Standard formats
    ['standard', { name: 'standard', confidence: 0.95 }],
    ['modern', { name: 'modern', confidence: 0.95 }],
    ['legacy', { name: 'legacy', confidence: 0.95 }],
    ['vintage', { name: 'vintage', confidence: 0.95 }],
    ['pioneer', { name: 'pioneer', confidence: 0.95 }],
    ['commander', { name: 'commander', confidence: 0.95 }],
    ['edh', { name: 'commander', confidence: 0.98 }], // EDH is Commander
    ['brawl', { name: 'brawl', confidence: 0.95 }],
    ['pauper', { name: 'pauper', confidence: 0.95 }],
    ['penny', { name: 'penny', confidence: 0.95 }],
    ['historic', { name: 'historic', confidence: 0.95 }],
    ['alchemy', { name: 'alchemy', confidence: 0.95 }],
    ['timeless', { name: 'timeless', confidence: 0.95 }],
    
    // Format variations and synonyms
    ['standard legal', { name: 'standard', confidence: 0.90 }],
    ['modern legal', { name: 'modern', confidence: 0.90 }],
    ['legacy legal', { name: 'legacy', confidence: 0.90 }],
    ['vintage legal', { name: 'vintage', confidence: 0.90 }],
    ['pioneer legal', { name: 'pioneer', confidence: 0.90 }],
    ['commander legal', { name: 'commander', confidence: 0.90 }],
    ['edh legal', { name: 'commander', confidence: 0.92 }],
    ['brawl legal', { name: 'brawl', confidence: 0.90 }],
    ['pauper legal', { name: 'pauper', confidence: 0.90 }],
    
    // Context-based format detection
    ['in standard', { name: 'standard', confidence: 0.88 }],
    ['in modern', { name: 'modern', confidence: 0.88 }],
    ['in legacy', { name: 'legacy', confidence: 0.88 }],
    ['in vintage', { name: 'vintage', confidence: 0.88 }],
    ['in pioneer', { name: 'pioneer', confidence: 0.88 }],
    ['in commander', { name: 'commander', confidence: 0.88 }],
    ['in edh', { name: 'commander', confidence: 0.90 }],
    ['in brawl', { name: 'brawl', confidence: 0.88 }],
    ['in pauper', { name: 'pauper', confidence: 0.88 }],
    
    ['for standard', { name: 'standard', confidence: 0.85 }],
    ['for modern', { name: 'modern', confidence: 0.85 }],
    ['for legacy', { name: 'legacy', confidence: 0.85 }],
    ['for vintage', { name: 'vintage', confidence: 0.85 }],
    ['for pioneer', { name: 'pioneer', confidence: 0.85 }],
    ['for commander', { name: 'commander', confidence: 0.85 }],
    ['for edh', { name: 'commander', confidence: 0.87 }],
    ['for brawl', { name: 'brawl', confidence: 0.85 }],
    ['for pauper', { name: 'pauper', confidence: 0.85 }],
    
    // Casual format references
    ['casual', { name: 'casual', confidence: 0.75 }],
    ['kitchen table', { name: 'casual', confidence: 0.80 }],
    ['multiplayer', { name: 'commander', confidence: 0.70 }], // Often implies Commander
    
    // Arena-specific formats
    ['arena', { name: 'standard', confidence: 0.70 }], // Arena often implies Standard
    ['mtg arena', { name: 'standard', confidence: 0.72 }],
    ['mtga', { name: 'standard', confidence: 0.72 }],
    
    // MTGO-specific references
    ['mtgo', { name: 'legacy', confidence: 0.60 }], // MTGO supports many formats
    ['magic online', { name: 'legacy', confidence: 0.60 }],
    
    // Competitive context
    ['competitive', { name: 'modern', confidence: 0.60 }], // Often Modern in competitive
    ['tournament', { name: 'standard', confidence: 0.65 }], // Tournaments often Standard
    ['fnm', { name: 'standard', confidence: 0.70 }], // Friday Night Magic often Standard
    ['friday night magic', { name: 'standard', confidence: 0.70 }],
    
    // Deck size hints
    ['100 card', { name: 'commander', confidence: 0.85 }],
    ['100-card', { name: 'commander', confidence: 0.85 }],
    ['singleton', { name: 'commander', confidence: 0.75 }], // Often Commander
    ['highlander', { name: 'commander', confidence: 0.80 }], // Canadian Highlander or Commander
    
    // Power level hints
    ['high power', { name: 'vintage', confidence: 0.60 }],
    ['powered', { name: 'vintage', confidence: 0.70 }], // Power 9 reference
    ['unpowered', { name: 'legacy', confidence: 0.65 }],
    ['budget', { name: 'pauper', confidence: 0.60 }], // Budget often implies Pauper
  ]);
  
  /**
   * Extract format concepts from natural language text
   */
  extract(text: string): FormatConcept[] {
    const concepts: FormatConcept[] = [];
    const lowerText = text.toLowerCase();
    
    for (const [pattern, definition] of this.formatPatterns) {
      if (this.matchesPattern(lowerText, pattern)) {
        concepts.push({
          name: definition.name,
          confidence: definition.confidence
        });
      }
    }
    
    return this.deduplicateAndMerge(concepts);
  }
  
  /**
   * Check if text matches a format pattern
   */
  private matchesPattern(text: string, pattern: string): boolean {
    // For single words, use word boundaries to avoid partial matches
    if (!pattern.includes(' ')) {
      const regex = new RegExp(`\\b${pattern}\\b`, 'i');
      return regex.test(text);
    }
    
    // For phrases, use includes
    return text.includes(pattern);
  }
  
  /**
   * Deduplicate and merge format concepts
   */
  private deduplicateAndMerge(concepts: FormatConcept[]): FormatConcept[] {
    if (concepts.length <= 1) return concepts;
    
    const formatMap = new Map<string, FormatConcept>();
    
    for (const concept of concepts) {
      const existing = formatMap.get(concept.name);
      if (existing) {
        // Keep the one with higher confidence
        if (concept.confidence > existing.confidence) {
          formatMap.set(concept.name, concept);
        }
      } else {
        formatMap.set(concept.name, concept);
      }
    }
    
    return Array.from(formatMap.values());
  }
  
  /**
   * Get the most likely format from extracted concepts
   */
  getBestFormat(concepts: FormatConcept[]): FormatConcept | undefined {
    if (concepts.length === 0) return undefined;
    
    // Sort by confidence and return the highest
    return concepts.sort((a, b) => b.confidence - a.confidence)[0];
  }
  
  /**
   * Check if a format is explicitly mentioned (high confidence)
   */
  hasExplicitFormat(concepts: FormatConcept[], threshold = 0.85): boolean {
    return concepts.some(concept => concept.confidence >= threshold);
  }
}
