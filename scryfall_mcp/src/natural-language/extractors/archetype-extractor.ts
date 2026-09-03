/**
 * @fileoverview Archetype Pattern Engine for Natural Language Processing
 * 
 * This module handles the extraction and interpretation of archetype-related
 * concepts from natural language queries, including deck archetypes like
 * aggro, control, combo, midrange, etc.
 */

import { ArchetypeConcept } from '../types.js';
import { containsWholePhrase } from '../text-matching.js';

/**
 * Engine for extracting archetype concepts from natural language
 */
export class ArchetypePatternEngine {
  private readonly archetypeDefinitions = new Map([
    ['aggressive', {
      constraints: {
        cmcRange: [1, 4] as [number, number],
        powerMin: 2,
        keywords: ['haste', 'trample', 'first strike', 'double strike'],
        functions: ['burn', 'direct damage'],
        cardTypes: ['creature', 'instant', 'sorcery']
      },
      confidence: 0.90
    }],
    ['aggro', {
      constraints: {
        cmcRange: [1, 3] as [number, number],
        powerMin: 2,
        keywords: ['haste', 'prowess', 'menace'],
        functions: ['burn'],
        cardTypes: ['creature']
      },
      confidence: 0.92
    }],
    ['control', {
      constraints: {
        cmcRange: [2, 8] as [number, number],
        keywords: ['flash', 'vigilance'],
        functions: ['counterspell', 'removal', 'draw', 'wipe'],
        cardTypes: ['instant', 'sorcery', 'enchantment', 'planeswalker']
      },
      confidence: 0.88
    }],
    ['midrange', {
      constraints: {
        cmcRange: [3, 6] as [number, number],
        powerMin: 2,
        functions: ['removal', 'value'],
        cardTypes: ['creature', 'planeswalker']
      },
      confidence: 0.85
    }],
    ['combo', {
      constraints: {
        keywords: ['flash', 'storm', 'cascade'],
        functions: ['tutor', 'draw', 'ritual'],
        cardTypes: ['instant', 'sorcery', 'artifact', 'enchantment']
      },
      confidence: 0.80
    }],
    ['ramp', {
      constraints: {
        functions: ['ramp', 'mana acceleration'],
        cardTypes: ['land', 'artifact', 'creature', 'sorcery'],
        keywords: ['vigilance'] // for mana dorks
      },
      confidence: 0.93
    }],
    ['tribal', {
      constraints: {
        cardTypes: ['creature'],
        // Will be enhanced with specific creature types
      },
      confidence: 0.85
    }],
    ['tempo', {
      constraints: {
        cmcRange: [1, 4] as [number, number],
        keywords: ['flash', 'prowess', 'flying'],
        functions: ['bounce', 'counterspell'],
        cardTypes: ['creature', 'instant']
      },
      confidence: 0.87
    }],
    ['burn', {
      constraints: {
        cmcRange: [1, 4] as [number, number],
        functions: ['burn', 'direct damage'],
        cardTypes: ['instant', 'sorcery', 'creature']
      },
      confidence: 0.90
    }],
    ['reanimator', {
      constraints: {
        functions: ['reanimation', 'graveyard'],
        cardTypes: ['sorcery', 'instant', 'creature'],
        keywords: ['flashback']
      },
      confidence: 0.88
    }],
    ['prison', {
      constraints: {
        functions: ['lock', 'stax'],
        cardTypes: ['artifact', 'enchantment'],
        keywords: ['static']
      },
      confidence: 0.82
    }],
    ['storm', {
      constraints: {
        keywords: ['storm'],
        functions: ['ritual', 'draw'],
        cardTypes: ['instant', 'sorcery']
      },
      confidence: 0.95
    }],
    ['voltron', {
      constraints: {
        cardTypes: ['equipment', 'aura', 'creature'],
        functions: ['protection', 'pump'],
        keywords: ['hexproof', 'shroud', 'indestructible']
      },
      confidence: 0.85
    }],
    ['tokens', {
      constraints: {
        functions: ['token generation'],
        cardTypes: ['sorcery', 'instant', 'creature', 'enchantment'],
        keywords: ['convoke']
      },
      confidence: 0.88
    }],
    ['aristocrats', {
      constraints: {
        functions: ['sacrifice', 'death triggers'],
        cardTypes: ['creature', 'enchantment'],
        keywords: ['sacrifice']
      },
      confidence: 0.86
    }]
  ]);
  
  /**
   * Extract archetype concepts from natural language text
   */
  extract(text: string): ArchetypeConcept[] {
    const concepts: ArchetypeConcept[] = [];
    const lowerText = text.toLowerCase();
    
    for (const [archetype, definition] of this.archetypeDefinitions) {
      if (this.matchesArchetype(lowerText, archetype)) {
        concepts.push({
          name: archetype,
          constraints: definition.constraints,
          confidence: definition.confidence
        });
      }
    }
    
    return concepts;
  }
  
  /**
   * Check if text matches an archetype pattern
   */
  private matchesArchetype(text: string, archetype: string): boolean {
    // Direct mention
    if (containsWholePhrase(text, archetype)) return true;
    
    // Synonym matching
    const synonyms = this.getArchetypeSynonyms(archetype);
    return synonyms.some(synonym => containsWholePhrase(text, synonym));
  }
  
  /**
   * Get synonyms for archetype names
   */
  private getArchetypeSynonyms(archetype: string): string[] {
    const synonymMap = new Map([
      ['aggressive', ['aggro', 'fast', 'beatdown', 'rush', 'tempo']],
      ['control', ['controlling', 'defensive', 'reactive', 'late game']],
      ['midrange', ['midgame', 'value', 'grindy', 'fair']],
      ['combo', ['synergy', 'engine', 'infinite', 'lock']],
      ['ramp', ['acceleration', 'big mana', 'ramping', 'fast mana']],
      ['tribal', ['creature type', 'synergy', 'lord effects']],
      ['tempo', ['pressure', 'clock', 'efficient']],
      ['burn', ['direct damage', 'face damage', 'lightning']],
      ['reanimator', ['graveyard', 'resurrection', 'cheat']],
      ['prison', ['stax', 'lock', 'denial']],
      ['storm', ['spell velocity', 'ritual']],
      ['voltron', ['equipment', 'aura', 'pump']],
      ['tokens', ['go wide', 'swarm', 'army']],
      ['aristocrats', ['sacrifice', 'death', 'blood artist']]
    ]);
    
    return synonymMap.get(archetype) || [];
  }
  
  /**
   * Enhance archetype with specific creature type if tribal
   */
  enhanceTribalArchetype(archetype: ArchetypeConcept, detectedTypes: string[]): ArchetypeConcept {
    if (archetype.name !== 'tribal' || detectedTypes.length === 0) {
      return archetype;
    }
    
    // Add the detected creature type to the constraints
    const enhancedConstraints = {
      ...archetype.constraints,
      subtypes: detectedTypes
    };
    
    return {
      ...archetype,
      constraints: enhancedConstraints,
      confidence: archetype.confidence + 0.1 // Boost confidence for specific tribal
    };
  }
}
