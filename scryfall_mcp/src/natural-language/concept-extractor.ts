/**
 * @fileoverview Concept Extractor for Natural Language Query Building
 * 
 * This module maps parsed natural language concepts to Scryfall operators
 * and values, handling conflict resolution and priority management.
 */

import { 
  ParsedQuery, 
  ConceptMapping, 
  ColorConcept, 
  ArchetypeConcept, 
  PriceConcept,
  TypeConcept,
  FormatConcept,
  KeywordConcept,
  ManaCostConcept,
  StatConcept
} from './types.js';

/**
 * Maps natural language concepts to Scryfall search operators
 */
export class ConceptExtractor {
  
  /**
   * Extract all concept mappings from a parsed query
   */
  extractMappings(parsed: ParsedQuery): ConceptMapping[] {
    const mappings: ConceptMapping[] = [];
    
    // Map each concept type to Scryfall operators
    mappings.push(...this.mapColors(parsed.colors));
    mappings.push(...this.mapTypes(parsed.types));
    mappings.push(...parsed.subtypes.map(subtype => ({
      operator: 't',
      value: subtype.subtype,
      conjunction: true,
      confidence: subtype.confidence,
      priority: 8,
    })));
    mappings.push(...this.mapArchetypes(parsed.archetypes));
    mappings.push(...this.mapPrices(parsed.priceConstraints));
    mappings.push(...this.mapFormats(parsed.formats));
    mappings.push(...this.mapKeywords(parsed.keywords));
    mappings.push(...parsed.abilities.map(ability => ({
      operator: 'o',
      value: ability.ability,
      conjunction: true,
      confidence: ability.confidence,
      priority: 6,
    })));
    mappings.push(...parsed.mechanics.map(mechanic => ({
      operator: 'o',
      value: mechanic.mechanic,
      conjunction: true,
      confidence: mechanic.confidence,
      priority: 6,
    })));
    mappings.push(...this.mapManaCost(parsed.manaCost));
    mappings.push(...this.mapPowerToughness(parsed.powerToughness));
    
    // Resolve conflicts and return final mappings
    return this.resolveConflicts(mappings);
  }
  
  /**
   * Map color concepts to Scryfall color operators
   */
  mapColors(colors: ColorConcept[]): ConceptMapping[] {
    const mappings: ConceptMapping[] = [];
    
    for (const colorConcept of colors) {
      if (colorConcept.colorless) {
        mappings.push({
          operator: 'c',
          value: 'c',
          confidence: colorConcept.confidence,
          priority: 10
        });
      } else if (colorConcept.multicolor) {
        mappings.push({
          operator: 'c',
          value: 'm',
          confidence: colorConcept.confidence,
          priority: 9
        });
      } else if (colorConcept.colors.length > 0) {
        const value = colorConcept.colors.join('');
        const operator = 'c';
        const comparison = colorConcept.exact ? '=' : 
                          colorConcept.inclusive ? '>=' : '=';
        
        mappings.push({
          operator,
          value,
          comparison: colorConcept.exact ? '=' : comparison,
          confidence: colorConcept.confidence,
          priority: 10
        });
      }
    }
    
    return mappings;
  }
  
  /**
   * Map type concepts to Scryfall type operators
   */
  mapTypes(types: TypeConcept[]): ConceptMapping[] {
    const mappings: ConceptMapping[] = [];
    
    for (const typeConcept of types) {
      if (typeConcept.type) {
        const alternatives = typeConcept.type.split(' OR ');
        for (const type of alternatives) {
          const negatedType = type.startsWith('-t:');
          mappings.push({
            operator: 't',
            value: negatedType ? type.slice(3) : type,
            negation: negatedType,
            conjunction: alternatives.length === 1,
            confidence: typeConcept.confidence,
            priority: 8
          });
        }
      }
      
      if (typeConcept.supertype) {
        mappings.push({
          operator: 't',
          value: typeConcept.supertype,
          conjunction: true,
          confidence: typeConcept.confidence,
          priority: 8
        });
      }

      if (typeConcept.function) {
        mappings.push({
          operator: 'function',
          value: typeConcept.function,
          confidence: typeConcept.confidence,
          priority: 8,
        });
      }
    }
    
    return mappings;
  }
  
  /**
   * Map archetype concepts to multiple Scryfall constraints
   */
  mapArchetypes(archetypes: ArchetypeConcept[]): ConceptMapping[] {
    const mappings: ConceptMapping[] = [];
    
    for (const archetype of archetypes) {
      const constraints = archetype.constraints;
      
      // Map CMC constraints
      if (constraints.cmcRange) {
        const [min, max] = constraints.cmcRange;
        mappings.push({
          operator: 'cmc',
          value: min.toString(),
          comparison: '>=',
          confidence: archetype.confidence * 0.8,
          priority: 6
        });
        mappings.push({
          operator: 'cmc',
          value: max.toString(),
          comparison: '<=',
          confidence: archetype.confidence * 0.8,
          priority: 6
        });
      }
      
      // Map power constraints
      if (constraints.powerMin) {
        mappings.push({
          operator: 'pow',
          value: constraints.powerMin.toString(),
          comparison: '>=',
          confidence: archetype.confidence * 0.7,
          priority: 5
        });
      }
      
      // Map keyword constraints
      if (constraints.keywords) {
        for (const keyword of constraints.keywords) {
          mappings.push({
            operator: 'o',
            value: keyword,
            confidence: archetype.confidence * 0.6,
            priority: 4
          });
        }
      }
      
      // Map function constraints
      if (constraints.functions) {
        for (const func of constraints.functions) {
          mappings.push({
            operator: 'function',
            value: func,
            confidence: archetype.confidence * 0.8,
            priority: 7
          });
        }
      }
      
      // Map card type constraints
      if (constraints.cardTypes) {
        for (const type of constraints.cardTypes) {
          mappings.push({
            operator: 't',
            value: type,
            confidence: archetype.confidence * 0.9,
            priority: 8
          });
        }
      }
    }
    
    return mappings;
  }
  
  /**
   * Map price concepts to Scryfall price operators
   */
  mapPrices(prices: PriceConcept[]): ConceptMapping[] {
    const mappings: ConceptMapping[] = [];
    
    for (const price of prices) {
      const currencyOperator = price.currency === 'eur' ? 'eur' : 
                              price.currency === 'tix' ? 'tix' : 'usd';
      
      if (price.max !== undefined) {
        mappings.push({
          operator: currencyOperator,
          value: price.max.toString(),
          comparison: '<=',
          confidence: price.confidence,
          priority: 8
        });
      }
      
      if (price.min !== undefined) {
        mappings.push({
          operator: currencyOperator,
          value: price.min.toString(),
          comparison: '>=',
          confidence: price.confidence,
          priority: 8
        });
      }
    }
    
    return mappings;
  }
  
  /**
   * Map format concepts to Scryfall format operators
   */
  mapFormats(formats: FormatConcept[]): ConceptMapping[] {
    const mappings: ConceptMapping[] = [];
    
    for (const format of formats) {
      mappings.push({
        operator: 'f',
        value: format.name,
        confidence: format.confidence,
        priority: 9
      });
    }
    
    return mappings;
  }
  
  /**
   * Map keyword concepts to oracle text searches
   */
  mapKeywords(keywords: KeywordConcept[]): ConceptMapping[] {
    const mappings: ConceptMapping[] = [];
    
    for (const keyword of keywords) {
      mappings.push({
        operator: 'o',
        value: keyword.keyword,
        conjunction: true,
        confidence: keyword.confidence,
        priority: 5
      });
    }
    
    return mappings;
  }
  
  /**
   * Map mana cost concepts to CMC operators
   */
  mapManaCost(manaCosts: ManaCostConcept[]): ConceptMapping[] {
    const mappings: ConceptMapping[] = [];
    
    for (const manaCost of manaCosts) {
      if (manaCost.exact !== undefined) {
        mappings.push({
          operator: 'cmc',
          value: manaCost.exact.toString(),
          comparison: '=',
          confidence: manaCost.confidence,
          priority: 7
        });
      }
      
      if (manaCost.min !== undefined) {
        mappings.push({
          operator: 'cmc',
          value: manaCost.min.toString(),
          comparison: '>=',
          confidence: manaCost.confidence,
          priority: 7
        });
      }
      
      if (manaCost.max !== undefined) {
        mappings.push({
          operator: 'cmc',
          value: manaCost.max.toString(),
          comparison: '<=',
          confidence: manaCost.confidence,
          priority: 7
        });
      }
    }
    
    return mappings;
  }
  
  /**
   * Map power/toughness concepts to stat operators
   */
  mapPowerToughness(stats: StatConcept[]): ConceptMapping[] {
    const mappings: ConceptMapping[] = [];
    
    for (const stat of stats) {
      const operator = stat.stat === 'power' ? 'pow' : 'tou';
      
      if (stat.exact !== undefined) {
        mappings.push({
          operator,
          value: stat.exact.toString(),
          comparison: '=',
          confidence: stat.confidence,
          priority: 6
        });
      }
      
      if (stat.min !== undefined) {
        mappings.push({
          operator,
          value: stat.min.toString(),
          comparison: '>=',
          confidence: stat.confidence,
          priority: 6
        });
      }
      
      if (stat.max !== undefined) {
        mappings.push({
          operator,
          value: stat.max.toString(),
          comparison: '<=',
          confidence: stat.confidence,
          priority: 6
        });
      }
    }
    
    return mappings;
  }
  
  /**
   * Resolve conflicts between mappings
   */
  resolveConflicts(mappings: ConceptMapping[]): ConceptMapping[] {
    // Group by operator
    const grouped = new Map<string, ConceptMapping[]>();
    for (const mapping of mappings) {
      const key = mapping.operator;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(mapping);
    }
    
    const resolved: ConceptMapping[] = [];
    
    for (const [operator, operatorMappings] of grouped) {
      if (operatorMappings.length === 1) {
        resolved.push(operatorMappings[0]);
        continue;
      }
      
      // Resolve conflicts based on priority and confidence
      const sorted = operatorMappings.sort((a, b) => {
        const priorityDiff = b.priority - a.priority;
        if (priorityDiff !== 0) return priorityDiff;
        return b.confidence - a.confidence;
      });
      
      // Special conflict resolution rules
      if (operator === 'c') {
        resolved.push(...this.resolveColorConflicts(sorted));
      } else if (operator === 'cmc') {
        resolved.push(...this.resolveCmcConflicts(sorted));
      } else if (['usd', 'eur', 'tix'].includes(operator)) {
        resolved.push(...this.resolvePriceConflicts(sorted));
      } else if (operator === 't' || operator === 'o') {
        const unique = new Map<string, ConceptMapping>();
        for (const mapping of sorted) {
          const key = `${mapping.negation ? '-' : ''}${mapping.conjunction ? '&' : ''}${mapping.value}`;
          if (!unique.has(key)) {
            unique.set(key, mapping);
          }
        }
        resolved.push(...unique.values());
      } else {
        // Default: take highest priority/confidence
        resolved.push(sorted[0]);
      }
    }
    
    return resolved;
  }
  
  /**
   * Resolve color conflicts
   */
  private resolveColorConflicts(mappings: ConceptMapping[]): ConceptMapping[] {
    const hasExact = mappings.some(m => m.comparison === '=');
    const hasInclusive = mappings.some(m => m.comparison === '>=');
    
    if (hasExact && hasInclusive) {
      // Exact takes precedence
      return mappings.filter(m => m.comparison === '=');
    }
    
    // Return highest confidence mapping
    return [mappings[0]];
  }
  
  /**
   * Resolve CMC conflicts by creating ranges
   */
  private resolveCmcConflicts(mappings: ConceptMapping[]): ConceptMapping[] {
    const minMappings = mappings.filter(m => m.comparison === '>=');
    const maxMappings = mappings.filter(m => m.comparison === '<=');
    const exactMappings = mappings.filter(m => !m.comparison || m.comparison === '=');
    
    if (exactMappings.length > 0) {
      // Exact value takes precedence
      return [exactMappings[0]];
    }
    
    const result: ConceptMapping[] = [];
    
    if (minMappings.length > 0) {
      result.push(minMappings[0]);
    }
    
    if (maxMappings.length > 0) {
      result.push(maxMappings[0]);
    }
    
    return result;
  }
  
  /**
   * Resolve price conflicts by creating ranges
   */
  private resolvePriceConflicts(mappings: ConceptMapping[]): ConceptMapping[] {
    return this.resolveCmcConflicts(mappings); // Same logic as CMC
  }
}
