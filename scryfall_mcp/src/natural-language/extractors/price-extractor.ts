/**
 * @fileoverview Price Pattern Engine for Natural Language Processing
 * 
 * This module handles the extraction and interpretation of price-related
 * concepts from natural language queries, including budget constraints,
 * price ranges, and currency specifications.
 */

import { PriceConcept } from '../types.js';

/**
 * Engine for extracting price concepts from natural language
 */
export class PricePatternEngine {
  private readonly patterns = [
    // Under patterns
    { regex: /under\s*\$?(\d+(?:\.\d{2})?)/i, type: 'max', confidence: 0.95 },
    { regex: /less\s+than\s*\$?(\d+(?:\.\d{2})?)/i, type: 'max', confidence: 0.93 },
    { regex: /below\s*\$?(\d+(?:\.\d{2})?)/i, type: 'max', confidence: 0.90 },
    { regex: /\$?(\d+(?:\.\d{2})?)\s*or\s*less/i, type: 'max', confidence: 0.92 },
    { regex: /\$?(\d+(?:\.\d{2})?)\s*and\s*under/i, type: 'max', confidence: 0.90 },
    { regex: /\$?(\d+(?:\.\d{2})?)\s*max/i, type: 'max', confidence: 0.88 },
    { regex: /maximum\s*\$?(\d+(?:\.\d{2})?)/i, type: 'max', confidence: 0.87 },
    
    // Budget patterns
    { regex: /budget.*?\$?(\d+(?:\.\d{2})?)/i, type: 'max', confidence: 0.85 },
    { regex: /cheap.*?\$?(\d+(?:\.\d{2})?)/i, type: 'max', confidence: 0.80 },
    { regex: /affordable.*?\$?(\d+(?:\.\d{2})?)/i, type: 'max', confidence: 0.82 },
    { regex: /inexpensive.*?\$?(\d+(?:\.\d{2})?)/i, type: 'max', confidence: 0.78 },
    
    // Over patterns
    { regex: /over\s*\$?(\d+(?:\.\d{2})?)/i, type: 'min', confidence: 0.95 },
    { regex: /more\s+than\s*\$?(\d+(?:\.\d{2})?)/i, type: 'min', confidence: 0.93 },
    { regex: /above\s*\$?(\d+(?:\.\d{2})?)/i, type: 'min', confidence: 0.90 },
    { regex: /\$?(\d+(?:\.\d{2})?)\s*or\s*more/i, type: 'min', confidence: 0.92 },
    { regex: /\$?(\d+(?:\.\d{2})?)\s*and\s*up/i, type: 'min', confidence: 0.88 },
    { regex: /minimum\s*\$?(\d+(?:\.\d{2})?)/i, type: 'min', confidence: 0.87 },
    
    // Range patterns
    { regex: /between\s*\$?(\d+(?:\.\d{2})?)\s*(?:and|to|-)\s*\$?(\d+(?:\.\d{2})?)/i, type: 'range', confidence: 0.88 },
    { regex: /\$?(\d+(?:\.\d{2})?)\s*(?:-|to)\s*\$?(\d+(?:\.\d{2})?)/i, type: 'range', confidence: 0.85 },
    { regex: /from\s*\$?(\d+(?:\.\d{2})?)\s*to\s*\$?(\d+(?:\.\d{2})?)/i, type: 'range', confidence: 0.87 },
    
    // Exact patterns
    { regex: /exactly\s*\$?(\d+(?:\.\d{2})?)/i, type: 'exact', confidence: 0.90 },
    { regex: /costs\s*\$?(\d+(?:\.\d{2})?)/i, type: 'exact', confidence: 0.85 },
    { regex: /priced\s*at\s*\$?(\d+(?:\.\d{2})?)/i, type: 'exact', confidence: 0.83 },
    
    // Special budget terms
    { regex: /budget/i, type: 'budget_general', confidence: 0.70 },
    { regex: /cheap/i, type: 'budget_general', confidence: 0.65 },
    { regex: /affordable/i, type: 'budget_general', confidence: 0.68 },
    { regex: /expensive/i, type: 'expensive_general', confidence: 0.65 },
    { regex: /premium/i, type: 'expensive_general', confidence: 0.70 },
    { regex: /high.?end/i, type: 'expensive_general', confidence: 0.72 }
  ];
  
  /**
   * Extract price concepts from natural language text
   */
  extract(text: string): PriceConcept[] {
    const concepts: PriceConcept[] = [];
    
    for (const pattern of this.patterns) {
      const match = text.match(pattern.regex);
      if (match) {
        const concept: PriceConcept = {
          currency: 'usd', // Default to USD
          confidence: pattern.confidence
        };
        
        if (pattern.type === 'max') {
          concept.max = parseFloat(match[1]);
        } else if (pattern.type === 'min') {
          concept.min = parseFloat(match[1]);
        } else if (pattern.type === 'range') {
          concept.min = parseFloat(match[1]);
          concept.max = parseFloat(match[2]);
        } else if (pattern.type === 'exact') {
          concept.min = concept.max = parseFloat(match[1]);
        } else if (pattern.type === 'budget_general') {
          concept.max = 10; // Default budget threshold
          concept.condition = 'budget';
        } else if (pattern.type === 'expensive_general') {
          concept.min = 50; // Default expensive threshold
          concept.condition = 'premium';
        }
        
        // Detect currency
        concept.currency = this.detectCurrency(text, match.index || 0);
        
        // Detect condition context
        if (!concept.condition) {
          concept.condition = this.detectCondition(text, match.index || 0);
        }
        
        concepts.push(concept);
      }
    }
    
    return this.deduplicateAndMerge(concepts);
  }
  
  /**
   * Detect currency from context
   */
  private detectCurrency(text: string, position: number): 'usd' | 'eur' | 'tix' {
    const context = text.substring(Math.max(0, position - 20), position + 20).toLowerCase();
    
    if (context.includes('euro') || context.includes('eur') || context.includes('€')) {
      return 'eur';
    } else if (context.includes('tix') || context.includes('ticket') || context.includes('mtgo')) {
      return 'tix';
    }
    
    return 'usd'; // Default
  }
  
  /**
   * Detect price condition from context
   */
  private detectCondition(text: string, position: number): 'budget' | 'value' | 'premium' | undefined {
    const context = text.substring(Math.max(0, position - 20), position + 20).toLowerCase();
    
    if (context.includes('budget') || context.includes('cheap') || context.includes('affordable')) {
      return 'budget';
    } else if (context.includes('value') || context.includes('efficient') || context.includes('reasonable')) {
      return 'value';
    } else if (context.includes('premium') || context.includes('expensive') || context.includes('high end')) {
      return 'premium';
    }
    
    return undefined;
  }
  
  /**
   * Deduplicate and merge similar price concepts
   */
  private deduplicateAndMerge(concepts: PriceConcept[]): PriceConcept[] {
    if (concepts.length <= 1) return concepts;
    
    const merged: PriceConcept[] = [];
    const processed = new Set<number>();
    
    for (let i = 0; i < concepts.length; i++) {
      if (processed.has(i)) continue;
      
      let current = concepts[i];
      
      // Look for mergeable concepts (same currency)
      for (let j = i + 1; j < concepts.length; j++) {
        if (processed.has(j)) continue;
        
        const other = concepts[j];
        if (current.currency === other.currency) {
          current = this.mergePriceConcepts(current, other);
          processed.add(j);
        }
      }
      
      merged.push(current);
      processed.add(i);
    }
    
    return merged;
  }
  
  /**
   * Merge two price concepts with the same currency
   */
  private mergePriceConcepts(a: PriceConcept, b: PriceConcept): PriceConcept {
    return {
      min: this.mergeMinValues(a.min, b.min),
      max: this.mergeMaxValues(a.max, b.max),
      currency: a.currency,
      condition: a.condition || b.condition,
      confidence: Math.max(a.confidence, b.confidence)
    };
  }
  
  /**
   * Merge minimum values (take the higher one)
   */
  private mergeMinValues(a?: number, b?: number): number | undefined {
    if (a === undefined) return b;
    if (b === undefined) return a;
    return Math.max(a, b);
  }
  
  /**
   * Merge maximum values (take the lower one)
   */
  private mergeMaxValues(a?: number, b?: number): number | undefined {
    if (a === undefined) return b;
    if (b === undefined) return a;
    return Math.min(a, b);
  }
}
