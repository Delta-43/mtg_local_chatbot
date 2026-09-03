/**
 * @fileoverview Color Pattern Engine for Natural Language Processing
 * 
 * This module handles the extraction and interpretation of color-related
 * concepts from natural language queries, including basic colors, guild names,
 * shard names, wedge names, and special color combinations.
 */

import { ColorConcept } from '../types.js';

/**
 * Engine for extracting color concepts from natural language
 */
export class ColorPatternEngine {
  private readonly patterns = new Map([
    // Basic colors
    ['red', { colors: ['r'], exact: false, confidence: 0.95 }],
    ['blue', { colors: ['u'], exact: false, confidence: 0.95 }],
    ['white', { colors: ['w'], exact: false, confidence: 0.95 }],
    ['black', { colors: ['b'], exact: false, confidence: 0.95 }],
    ['green', { colors: ['g'], exact: false, confidence: 0.95 }],
    
    // Guild names with higher confidence
    ['azorius', { colors: ['w', 'u'], exact: true, confidence: 0.98 }],
    ['dimir', { colors: ['u', 'b'], exact: true, confidence: 0.98 }],
    ['rakdos', { colors: ['b', 'r'], exact: true, confidence: 0.98 }],
    ['gruul', { colors: ['r', 'g'], exact: true, confidence: 0.98 }],
    ['selesnya', { colors: ['g', 'w'], exact: true, confidence: 0.98 }],
    ['orzhov', { colors: ['w', 'b'], exact: true, confidence: 0.98 }],
    ['izzet', { colors: ['u', 'r'], exact: true, confidence: 0.98 }],
    ['golgari', { colors: ['b', 'g'], exact: true, confidence: 0.98 }],
    ['boros', { colors: ['r', 'w'], exact: true, confidence: 0.98 }],
    ['simic', { colors: ['g', 'u'], exact: true, confidence: 0.98 }],
    
    // Shard names
    ['bant', { colors: ['g', 'w', 'u'], exact: true, confidence: 0.98 }],
    ['esper', { colors: ['w', 'u', 'b'], exact: true, confidence: 0.98 }],
    ['grixis', { colors: ['u', 'b', 'r'], exact: true, confidence: 0.98 }],
    ['jund', { colors: ['b', 'r', 'g'], exact: true, confidence: 0.98 }],
    ['naya', { colors: ['r', 'g', 'w'], exact: true, confidence: 0.98 }],
    
    // Wedge names  
    ['abzan', { colors: ['w', 'b', 'g'], exact: true, confidence: 0.98 }],
    ['jeskai', { colors: ['u', 'r', 'w'], exact: true, confidence: 0.98 }],
    ['sultai', { colors: ['b', 'g', 'u'], exact: true, confidence: 0.98 }],
    ['mardu', { colors: ['r', 'w', 'b'], exact: true, confidence: 0.98 }],
    ['temur', { colors: ['g', 'u', 'r'], exact: true, confidence: 0.98 }],
    
    // Special color combinations
    ['multicolor', { colors: [], multicolor: true, confidence: 0.90 }],
    ['multicolored', { colors: [], multicolor: true, confidence: 0.90 }],
    ['colorless', { colors: [], colorless: true, confidence: 0.95 }],
    ['rainbow', { colors: ['w', 'u', 'b', 'r', 'g'], exact: false, confidence: 0.85 }],
    ['five-color', { colors: ['w', 'u', 'b', 'r', 'g'], exact: false, confidence: 0.90 }],
    ['five color', { colors: ['w', 'u', 'b', 'r', 'g'], exact: false, confidence: 0.90 }],
    
    // Alternative color names
    ['mono-red', { colors: ['r'], exact: true, confidence: 0.92 }],
    ['mono-blue', { colors: ['u'], exact: true, confidence: 0.92 }],
    ['mono-white', { colors: ['w'], exact: true, confidence: 0.92 }],
    ['mono-black', { colors: ['b'], exact: true, confidence: 0.92 }],
    ['mono-green', { colors: ['g'], exact: true, confidence: 0.92 }],
    ['mono red', { colors: ['r'], exact: true, confidence: 0.92 }],
    ['mono blue', { colors: ['u'], exact: true, confidence: 0.92 }],
    ['mono white', { colors: ['w'], exact: true, confidence: 0.92 }],
    ['mono black', { colors: ['b'], exact: true, confidence: 0.92 }],
    ['mono green', { colors: ['g'], exact: true, confidence: 0.92 }],
  ]);

  /**
   * Extract color concepts from natural language text
   */
  extract(text: string): ColorConcept[] {
    const concepts: ColorConcept[] = [];
    const lowerText = text.toLowerCase();
    
    // Check for exact phrases first (higher confidence)
    for (const [pattern, concept] of this.patterns) {
      if (lowerText.includes(pattern)) {
        concepts.push({
          colors: concept.colors || [],
          exact: concept.exact || false,
          inclusive: this.detectInclusive(text, pattern),
          exclusive: this.detectExclusive(text, pattern),
          multicolor: concept.multicolor || false,
          colorless: concept.colorless || false,
          confidence: concept.confidence
        });
      }
    }
    
    return this.deduplicateAndMerge(concepts);
  }
  
  /**
   * Detect inclusive color indicators (or, any, either, include)
   */
  private detectInclusive(text: string, pattern: string): boolean {
    const inclusiveIndicators = ['or', 'any', 'either', 'include', 'containing'];
    const context = this.getContextWindow(text, pattern, 5);
    return inclusiveIndicators.some(indicator => context.includes(indicator));
  }
  
  /**
   * Detect exclusive color indicators (only, just, exactly, purely, solely)
   */
  private detectExclusive(text: string, pattern: string): boolean {
    const exclusiveIndicators = ['only', 'just', 'exactly', 'purely', 'solely', 'mono'];
    const context = this.getContextWindow(text, pattern, 5);
    return exclusiveIndicators.some(indicator => context.includes(indicator));
  }
  
  /**
   * Get context window around a pattern match
   */
  private getContextWindow(text: string, pattern: string, wordCount: number): string {
    const index = text.toLowerCase().indexOf(pattern.toLowerCase());
    if (index === -1) return '';
    
    const words = text.split(/\s+/);
    const patternWords = pattern.split(/\s+/);
    const patternStart = words.findIndex(word => 
      word.toLowerCase().includes(patternWords[0].toLowerCase())
    );
    
    if (patternStart === -1) return '';
    
    const start = Math.max(0, patternStart - wordCount);
    const end = Math.min(words.length, patternStart + patternWords.length + wordCount);
    
    return words.slice(start, end).join(' ').toLowerCase();
  }
  
  /**
   * Deduplicate and merge similar color concepts
   */
  private deduplicateAndMerge(concepts: ColorConcept[]): ColorConcept[] {
    if (concepts.length <= 1) return concepts;
    
    const merged: ColorConcept[] = [];
    const processed = new Set<number>();
    
    for (let i = 0; i < concepts.length; i++) {
      if (processed.has(i)) continue;
      
      let current = concepts[i];
      
      // Look for mergeable concepts
      for (let j = i + 1; j < concepts.length; j++) {
        if (processed.has(j)) continue;
        
        const other = concepts[j];
        if (this.canMergeConcepts(current, other)) {
          current = this.mergeConcepts(current, other);
          processed.add(j);
        }
      }
      
      merged.push(current);
      processed.add(i);
    }
    
    return merged;
  }
  
  /**
   * Check if two color concepts can be merged
   */
  private canMergeConcepts(a: ColorConcept, b: ColorConcept): boolean {
    // Can merge if they have overlapping colors or compatible flags
    const hasOverlap = a.colors.some(color => b.colors.includes(color));
    const compatibleFlags = (a.multicolor === b.multicolor) && (a.colorless === b.colorless);
    
    return hasOverlap || compatibleFlags;
  }
  
  /**
   * Merge two compatible color concepts
   */
  private mergeConcepts(a: ColorConcept, b: ColorConcept): ColorConcept {
    const mergedColors = [...new Set([...a.colors, ...b.colors])];
    
    return {
      colors: mergedColors,
      exact: a.exact && b.exact,
      inclusive: a.inclusive || b.inclusive,
      exclusive: a.exclusive || b.exclusive,
      multicolor: a.multicolor || b.multicolor,
      colorless: a.colorless || b.colorless,
      confidence: Math.max(a.confidence, b.confidence)
    };
  }
}
