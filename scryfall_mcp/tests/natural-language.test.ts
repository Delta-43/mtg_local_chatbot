import { describe, it, expect, beforeEach } from 'vitest';
import { NaturalLanguageParser } from '../src/natural-language/parser.js';
import { ConceptExtractor } from '../src/natural-language/concept-extractor.js';
import { ColorPatternEngine } from '../src/natural-language/extractors/color-extractor.js';
import { ArchetypePatternEngine } from '../src/natural-language/extractors/archetype-extractor.js';
import { PricePatternEngine } from '../src/natural-language/extractors/price-extractor.js';
import { TypePatternEngine } from '../src/natural-language/extractors/type-extractor.js';
import { FormatPatternEngine } from '../src/natural-language/extractors/format-extractor.js';

describe('Natural Language Query Builder', () => {
  let parser: NaturalLanguageParser;
  let conceptExtractor: ConceptExtractor;

  beforeEach(() => {
    parser = new NaturalLanguageParser();
    conceptExtractor = new ConceptExtractor();
  });

  describe('NaturalLanguageParser', () => {
    it('should parse simple color queries', () => {
      const result = parser.parse('red creatures');
      
      expect(result.colors).toHaveLength(1);
      expect(result.colors[0].colors).toContain('r');
      expect(result.types).toHaveLength(1);
      expect(result.types[0].type).toBe('creature');
    });

    it('should parse price constraints', () => {
      const result = parser.parse('cards under $10');
      
      expect(result.priceConstraints).toHaveLength(1);
      expect(result.priceConstraints[0].max).toBe(10);
      expect(result.priceConstraints[0].currency).toBe('usd');
    });

    it('should parse archetype queries', () => {
      const result = parser.parse('aggressive creatures for modern');
      
      expect(result.archetypes).toHaveLength(1);
      expect(result.archetypes[0].name).toBe('aggressive');
      expect(result.formats).toHaveLength(1);
      expect(result.formats[0].name).toBe('modern');
    });

    it('should handle complex queries', () => {
      const result = parser.parse('blue counterspells under $20 for modern control decks');
      
      expect(result.colors[0].colors).toContain('u');
      expect(result.priceConstraints[0].max).toBe(20);
      expect(result.formats[0].name).toBe('modern');
      expect(result.archetypes[0].name).toBe('control');
    });
  });

  describe('ColorPatternEngine', () => {
    let colorEngine: ColorPatternEngine;

    beforeEach(() => {
      colorEngine = new ColorPatternEngine();
    });

    it('should extract basic colors', () => {
      const result = colorEngine.extract('red and blue cards');

      // The color extractor merges "red and blue" into a single multicolor concept
      expect(result).toHaveLength(1);
      expect(result[0].colors).toContain('r');
      expect(result[0].colors).toContain('u');
    });

    it('should extract guild names', () => {
      const result = colorEngine.extract('azorius control');
      
      expect(result).toHaveLength(1);
      expect(result[0].colors).toEqual(['w', 'u']);
      expect(result[0].exact).toBe(true);
    });

    it('should detect exclusive color indicators', () => {
      const result = colorEngine.extract('only red cards');
      
      expect(result).toHaveLength(1);
      expect(result[0].exclusive).toBe(true);
    });

    it('should detect multicolor indicators', () => {
      const result = colorEngine.extract('multicolor spells');
      
      expect(result).toHaveLength(1);
      expect(result[0].multicolor).toBe(true);
    });
  });

  describe('ArchetypePatternEngine', () => {
    let archetypeEngine: ArchetypePatternEngine;

    beforeEach(() => {
      archetypeEngine = new ArchetypePatternEngine();
    });

    it('should extract aggro archetype', () => {
      const result = archetypeEngine.extract('aggressive deck');
      
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('aggressive');
      expect(result[0].constraints.powerMin).toBe(2);
    });

    it('should extract control archetype', () => {
      const result = archetypeEngine.extract('control strategy');
      
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('control');
      expect(result[0].constraints.functions).toContain('counterspell');
    });

    it('should extract ramp archetype', () => {
      const result = archetypeEngine.extract('ramp deck');
      
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('ramp');
      expect(result[0].constraints.functions).toContain('ramp');
    });
  });

  describe('PricePatternEngine', () => {
    let priceEngine: PricePatternEngine;

    beforeEach(() => {
      priceEngine = new PricePatternEngine();
    });

    it('should extract under price constraints', () => {
      const result = priceEngine.extract('under $15');
      
      expect(result).toHaveLength(1);
      expect(result[0].max).toBe(15);
      expect(result[0].currency).toBe('usd');
    });

    it('should extract price ranges', () => {
      const result = priceEngine.extract('between $5 and $20');
      
      expect(result).toHaveLength(1);
      expect(result[0].min).toBe(5);
      expect(result[0].max).toBe(20);
    });

    it('should detect budget conditions', () => {
      const result = priceEngine.extract('budget cards under $5');
      
      expect(result).toHaveLength(1);
      expect(result[0].condition).toBe('budget');
    });

    it('should detect different currencies', () => {
      const result = priceEngine.extract('under 10 tix');
      
      expect(result).toHaveLength(1);
      expect(result[0].currency).toBe('tix');
    });
  });

  describe('TypePatternEngine', () => {
    let typeEngine: TypePatternEngine;

    beforeEach(() => {
      typeEngine = new TypePatternEngine();
    });

    it('should extract basic card types', () => {
      const result = typeEngine.extract('instant spells');

      // The type extractor finds both "instant" and "spells" (which maps to instant OR sorcery)
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result.some(t => t.type === 'instant')).toBe(true);
    });

    it('should extract creature subtypes', () => {
      const subtypes = typeEngine.extractSubtypes('dragon creatures');
      
      expect(subtypes).toHaveLength(1);
      expect(subtypes[0].subtype).toBe('dragon');
      expect(subtypes[0].category).toBe('creature');
    });

    it('should extract supertypes', () => {
      const result = typeEngine.extract('legendary artifacts');
      
      expect(result).toHaveLength(2); // legendary and artifact
      expect(result.some(t => t.supertype === 'legendary')).toBe(true);
      expect(result.some(t => t.type === 'artifact')).toBe(true);
    });
  });

  describe('FormatPatternEngine', () => {
    let formatEngine: FormatPatternEngine;

    beforeEach(() => {
      formatEngine = new FormatPatternEngine();
    });

    it('should extract format names', () => {
      const result = formatEngine.extract('modern legal cards');
      
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('modern');
    });

    it('should extract EDH as commander', () => {
      const result = formatEngine.extract('EDH deck');
      
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('commander');
    });

    it('should handle format context', () => {
      const result = formatEngine.extract('cards for standard');
      
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('standard');
    });
  });

  describe('ConceptExtractor', () => {
    it('should map colors to Scryfall operators', () => {
      const parsed = parser.parse('red creatures');
      const mappings = conceptExtractor.extractMappings(parsed);
      
      const colorMapping = mappings.find(m => m.operator === 'c');
      expect(colorMapping).toBeDefined();
      expect(colorMapping?.value).toBe('r');
    });

    it('should map types to Scryfall operators', () => {
      const parsed = parser.parse('instant spells');
      const mappings = conceptExtractor.extractMappings(parsed);
      
      const typeMapping = mappings.find(m => m.operator === 't');
      expect(typeMapping).toBeDefined();
      expect(typeMapping?.value).toBe('instant');
    });

    it('should map prices to Scryfall operators', () => {
      const parsed = parser.parse('cards under $10');
      const mappings = conceptExtractor.extractMappings(parsed);
      
      const priceMapping = mappings.find(m => m.operator === 'usd');
      expect(priceMapping).toBeDefined();
      expect(priceMapping?.value).toBe('10');
      expect(priceMapping?.comparison).toBe('<=');
    });

    it('should resolve conflicts correctly', () => {
      const parsed = parser.parse('red creatures under $5 in modern');
      const mappings = conceptExtractor.extractMappings(parsed);
      
      // Should have one mapping per operator type
      const operators = mappings.map(m => m.operator);
      const uniqueOperators = [...new Set(operators)];
      expect(operators.length).toBe(uniqueOperators.length);
    });
  });
});
