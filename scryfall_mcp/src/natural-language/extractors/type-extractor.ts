/**
 * @fileoverview Type Pattern Engine for Natural Language Processing
 * 
 * This module handles the extraction and interpretation of card type-related
 * concepts from natural language queries, including card types, supertypes,
 * and subtypes.
 */

import { TypeConcept, SubtypeConcept } from '../types.js';
import { containsWholePhrase } from '../text-matching.js';

type CardTypeDefinition = Pick<TypeConcept, 'type' | 'supertype' | 'function' | 'confidence'>;

type SubtypeCategory = SubtypeConcept['category'];

interface SubtypeDefinition {
  subtype: string;
  category: SubtypeCategory;
  confidence: number;
}

/**
 * Engine for extracting type concepts from natural language
 */
export class TypePatternEngine {
  private readonly cardTypes = new Map<string, CardTypeDefinition>([
    // Primary types
    ['creature', { type: 'creature', confidence: 0.98 }],
    ['creatures', { type: 'creature', confidence: 0.98 }],
    ['instant', { type: 'instant', confidence: 0.98 }],
    ['instants', { type: 'instant', confidence: 0.98 }],
    ['sorcery', { type: 'sorcery', confidence: 0.98 }],
    ['sorceries', { type: 'sorcery', confidence: 0.98 }],
    ['artifact', { type: 'artifact', confidence: 0.98 }],
    ['artifacts', { type: 'artifact', confidence: 0.98 }],
    ['enchantment', { type: 'enchantment', confidence: 0.98 }],
    ['enchantments', { type: 'enchantment', confidence: 0.98 }],
    ['planeswalker', { type: 'planeswalker', confidence: 0.98 }],
    ['planeswalkers', { type: 'planeswalker', confidence: 0.98 }],
    ['land', { type: 'land', confidence: 0.98 }],
    ['lands', { type: 'land', confidence: 0.98 }],
    ['battle', { type: 'battle', confidence: 0.98 }],
    ['battles', { type: 'battle', confidence: 0.98 }],
    
    // Synonyms and common terms
    ['spell', { type: 'instant OR sorcery', confidence: 0.85 }],
    ['spells', { type: 'instant OR sorcery', confidence: 0.85 }],
    ['permanent', { type: 'creature OR artifact OR enchantment OR planeswalker OR land', confidence: 0.80 }],
    ['permanents', { type: 'creature OR artifact OR enchantment OR planeswalker OR land', confidence: 0.80 }],
    ['nonland', { type: '-t:land', confidence: 0.85 }],
    ['non-land', { type: '-t:land', confidence: 0.85 }],
    ['noncreature', { type: '-t:creature', confidence: 0.85 }],
    ['non-creature', { type: '-t:creature', confidence: 0.85 }],
    
    // Supertypes
    ['legendary', { supertype: 'legendary', confidence: 0.95 }],
    ['basic', { supertype: 'basic', confidence: 0.95 }],
    ['snow', { supertype: 'snow', confidence: 0.95 }],
    ['world', { supertype: 'world', confidence: 0.95 }],
    
    // Functional groupings
    ['removal', { function: 'removal', confidence: 0.88 }],
    ['counterspell', { type: 'instant OR sorcery', function: 'counterspell', confidence: 0.90 }],
    ['counterspells', { type: 'instant OR sorcery', function: 'counterspell', confidence: 0.90 }],
    ['draw', { function: 'draw', confidence: 0.85 }],
    ['card draw', { function: 'draw', confidence: 0.88 }],
    ['ramp', { function: 'ramp', confidence: 0.90 }],
    ['mana ramp', { function: 'ramp', confidence: 0.92 }],
    ['tutor', { function: 'tutor', confidence: 0.88 }],
    ['tutors', { function: 'tutor', confidence: 0.88 }],
    ['wipe', { function: 'wipe', confidence: 0.85 }],
    ['board wipe', { function: 'wipe', confidence: 0.90 }],
    ['sweeper', { function: 'wipe', confidence: 0.88 }]
  ]);

  private readonly subtypes = new Map<string, SubtypeDefinition>([
    // Common creature types
    ['human', { subtype: 'human', category: 'creature', confidence: 0.90 }],
    ['humans', { subtype: 'human', category: 'creature', confidence: 0.90 }],
    ['elf', { subtype: 'elf', category: 'creature', confidence: 0.95 }],
    ['elves', { subtype: 'elf', category: 'creature', confidence: 0.95 }],
    ['goblin', { subtype: 'goblin', category: 'creature', confidence: 0.95 }],
    ['goblins', { subtype: 'goblin', category: 'creature', confidence: 0.95 }],
    ['zombie', { subtype: 'zombie', category: 'creature', confidence: 0.95 }],
    ['zombies', { subtype: 'zombie', category: 'creature', confidence: 0.95 }],
    ['dragon', { subtype: 'dragon', category: 'creature', confidence: 0.95 }],
    ['dragons', { subtype: 'dragon', category: 'creature', confidence: 0.95 }],
    ['angel', { subtype: 'angel', category: 'creature', confidence: 0.95 }],
    ['angels', { subtype: 'angel', category: 'creature', confidence: 0.95 }],
    ['demon', { subtype: 'demon', category: 'creature', confidence: 0.95 }],
    ['demons', { subtype: 'demon', category: 'creature', confidence: 0.95 }],
    ['wizard', { subtype: 'wizard', category: 'creature', confidence: 0.90 }],
    ['wizards', { subtype: 'wizard', category: 'creature', confidence: 0.90 }],
    ['warrior', { subtype: 'warrior', category: 'creature', confidence: 0.90 }],
    ['warriors', { subtype: 'warrior', category: 'creature', confidence: 0.90 }],
    ['knight', { subtype: 'knight', category: 'creature', confidence: 0.90 }],
    ['knights', { subtype: 'knight', category: 'creature', confidence: 0.90 }],
    ['beast', { subtype: 'beast', category: 'creature', confidence: 0.90 }],
    ['beasts', { subtype: 'beast', category: 'creature', confidence: 0.90 }],
    ['spirit', { subtype: 'spirit', category: 'creature', confidence: 0.90 }],
    ['spirits', { subtype: 'spirit', category: 'creature', confidence: 0.90 }],
    ['elemental', { subtype: 'elemental', category: 'creature', confidence: 0.90 }],
    ['elementals', { subtype: 'elemental', category: 'creature', confidence: 0.90 }],
    
    // Equipment and vehicles
    ['equipment', { subtype: 'equipment', category: 'artifact', confidence: 0.95 }],
    ['vehicle', { subtype: 'vehicle', category: 'artifact', confidence: 0.95 }],
    ['vehicles', { subtype: 'vehicle', category: 'artifact', confidence: 0.95 }],
    
    // Artifact subtypes
    ['treasure', { subtype: 'treasure', category: 'artifact', confidence: 0.95 }],
    ['treasures', { subtype: 'treasure', category: 'artifact', confidence: 0.95 }],
    ['food', { subtype: 'food', category: 'artifact', confidence: 0.95 }],
    ['clue', { subtype: 'clue', category: 'artifact', confidence: 0.95 }],
    ['clues', { subtype: 'clue', category: 'artifact', confidence: 0.95 }],
    
    // Land subtypes
    ['mountain', { subtype: 'mountain', category: 'land', confidence: 0.90 }],
    ['mountains', { subtype: 'mountain', category: 'land', confidence: 0.90 }],
    ['island', { subtype: 'island', category: 'land', confidence: 0.90 }],
    ['islands', { subtype: 'island', category: 'land', confidence: 0.90 }],
    ['forest', { subtype: 'forest', category: 'land', confidence: 0.90 }],
    ['forests', { subtype: 'forest', category: 'land', confidence: 0.90 }],
    ['plains', { subtype: 'plains', category: 'land', confidence: 0.90 }],
    ['swamp', { subtype: 'swamp', category: 'land', confidence: 0.90 }],
    ['swamps', { subtype: 'swamp', category: 'land', confidence: 0.90 }],
    
    // Enchantment subtypes
    ['aura', { subtype: 'aura', category: 'enchantment', confidence: 0.95 }],
    ['auras', { subtype: 'aura', category: 'enchantment', confidence: 0.95 }],
    ['saga', { subtype: 'saga', category: 'enchantment', confidence: 0.95 }],
    ['sagas', { subtype: 'saga', category: 'enchantment', confidence: 0.95 }]
  ]);
  
  /**
   * Extract type concepts from natural language text
   */
  extract(text: string): TypeConcept[] {
    const concepts: TypeConcept[] = [];
    const lowerText = text.toLowerCase();
    
    for (const [pattern, definition] of this.cardTypes) {
      if (containsWholePhrase(lowerText, pattern)) {
        concepts.push({
          type: definition.type,
          supertype: definition.supertype,
          function: definition.function,
          confidence: definition.confidence,
          context: this.getContextWindow(text, pattern, 3)
        });
      }
    }
    
    return this.deduplicateAndMerge(concepts);
  }
  
  /**
   * Extract subtype concepts from natural language text
   */
  extractSubtypes(text: string): SubtypeConcept[] {
    const concepts: SubtypeConcept[] = [];
    const lowerText = text.toLowerCase();
    
    for (const [pattern, definition] of this.subtypes) {
      if (containsWholePhrase(lowerText, pattern)) {
        concepts.push({
          subtype: definition.subtype,
          category: definition.category,
          confidence: definition.confidence
        });
      }
    }
    
    const unique = new Map<string, SubtypeConcept>();
    for (const concept of concepts) {
      const existing = unique.get(concept.subtype);
      if (!existing || concept.confidence > existing.confidence) {
        unique.set(concept.subtype, concept);
      }
    }

    return Array.from(unique.values());
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
    
    return words.slice(start, end).join(' ');
  }
  
  /**
   * Deduplicate and merge similar type concepts
   */
  private deduplicateAndMerge(concepts: TypeConcept[]): TypeConcept[] {
    if (concepts.length <= 1) return concepts;
    
    const merged: TypeConcept[] = [];
    const seen = new Set<string>();
    
    for (const concept of concepts) {
      const key = concept.type || concept.supertype || concept.function || '';
      if (!seen.has(key)) {
        merged.push(concept);
        seen.add(key);
      }
    }
    
    return merged;
  }
}
