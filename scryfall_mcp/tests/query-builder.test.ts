import { describe, expect, it, vi } from 'vitest';
import { NaturalLanguageParser } from '../src/natural-language/parser.js';
import { ConceptExtractor } from '../src/natural-language/concept-extractor.js';
import { QueryBuilderEngine } from '../src/natural-language/query-builder.js';
import { buildBaseQuery, applyFormat } from '../src/natural-language/query-builder/query-assembly.js';
import {
  applyOptimization,
  testAndAdjustQuery,
} from '../src/natural-language/query-builder/query-optimization.js';
import {
  generateAlternatives,
  generateExplanation,
} from '../src/natural-language/query-builder/query-explanations.js';
import { ConceptMapping, ParsedQuery } from '../src/natural-language/types.js';

function createEmptyParsedQuery(overrides: Partial<ParsedQuery> = {}): ParsedQuery {
  return {
    colors: [],
    types: [],
    subtypes: [],
    keywords: [],
    abilities: [],
    mechanics: [],
    manaCost: [],
    powerToughness: [],
    priceConstraints: [],
    formats: [],
    legality: [],
    archetypes: [],
    deckRoles: [],
    strategies: [],
    sets: [],
    rarity: [],
    timeConstraints: [],
    namePatterns: [],
    flavorText: [],
    artist: [],
    confidence: 0.8,
    ambiguities: [],
    context: {},
    ...overrides,
  };
}

describe('Natural-Language Query Builder', () => {
  describe('query assembly helpers', () => {
    it('groups repeated operators into usable Scryfall clauses', () => {
      const mappings: ConceptMapping[] = [
        { operator: 'c', value: 'u', confidence: 0.9, comparison: '=' },
        { operator: 't', value: 'instant', confidence: 0.9 },
        { operator: 't', value: 'sorcery', confidence: 0.8 },
        { operator: 'usd', value: '5', confidence: 0.95, comparison: '<=' },
        { operator: 'pow', value: '2', confidence: 0.8, comparison: '>=' },
      ];

      const query = buildBaseQuery(mappings);

      expect(query).toContain('c:u');
      expect(query).toContain('(t:instant OR t:sorcery)');
      expect(query).toContain('usd<=5');
      expect(query).toContain('pow>=2');
    });

    it('adds format restrictions without disturbing the existing query', () => {
      expect(applyFormat('t:artifact usd<=5', 'commander')).toBe('t:artifact usd<=5 f:commander');
      expect(applyFormat('', 'modern')).toBe('f:modern');
    });
  });

  describe('query optimization helpers', () => {
    it('applies strategy-specific optimization rules', () => {
      expect(applyOptimization('t:creature pow:>=3', 'precision'))
        .toContain('(f:standard OR f:modern OR f:commander)');
      expect(applyOptimization('t:creature pow:>=3', 'precision'))
        .toContain('usd<=50');
      expect(applyOptimization('t:instant pow:>=3', 'recall'))
        .toContain('(t:instant OR t:sorcery)');
      expect(applyOptimization('t:artifact', 'budget')).toContain('usd<=5');
      expect(applyOptimization('t:legendary', 'discovery')).toContain('(is:unique OR is:reserved OR is:promo)');
    });

    it('broadens queries that return no results and narrows queries that are too broad', async () => {
      const mockClient = {
        searchCards: vi
          .fn()
          .mockResolvedValueOnce({ total_cards: 0, data: [] })
          .mockResolvedValueOnce({ total_cards: 12, data: [] })
          .mockResolvedValueOnce({ total_cards: 500, data: [] })
          .mockResolvedValueOnce({ total_cards: 18, data: [] }),
      };

      const broadened = await testAndAdjustQuery(
        mockClient as never,
        't:artifact cmc:=4 usd:<=5',
        { optimize_for: 'precision', max_results: 20 }
      );
      const narrowed = await testAndAdjustQuery(
        mockClient as never,
        't:artifact',
        { optimize_for: 'precision', max_results: 20 }
      );

      expect(broadened.query).toContain('cmc<=4');
      expect(broadened.query).toContain('usd<=10');
      expect(broadened.optimizations[0]?.type).toBe('broadening');
      expect(broadened.testSummary).toEqual({ total_cards: 12, has_more: false });

      expect(narrowed.query).toContain('f:modern');
      expect(narrowed.query).toContain('usd<=20');
      expect(narrowed.optimizations[0]?.type).toBe('narrowing');
      expect(narrowed.testSummary).toEqual({ total_cards: 18, has_more: false });
      expect(mockClient.searchCards).toHaveBeenCalledTimes(4);
    });

    it('keeps an adjustment when only the adjusted-query recount fails', async () => {
      const mockClient = {
        searchCards: vi
          .fn()
          .mockResolvedValueOnce({ total_cards: 0, data: [] })
          .mockRejectedValueOnce(new Error('temporary recount failure')),
      };

      const result = await testAndAdjustQuery(
        mockClient as never,
        't:creature usd<=5',
        { optimize_for: 'precision', max_results: 20 }
      );

      expect(result.query).toContain('usd<=10');
      expect(result.optimizations[0]?.type).toBe('broadening');
      expect(result.testSummary).toBeUndefined();
    });
  });

  describe('query explanation helpers', () => {
    it('describes mapped constraints and generates alternative strategies when format is fixed', () => {
      const mappings: ConceptMapping[] = [
        { operator: 'c', value: 'u', confidence: 0.95 },
        { operator: 't', value: 'instant', confidence: 0.9 },
        { operator: 'usd', value: '5', comparison: '<=', confidence: 0.85 },
        { operator: 'o', value: 'counter target spell', confidence: 0.8 },
      ];

      const explanation = generateExplanation(mappings, {
        optimize_for: 'precision',
        format: 'modern',
        max_results: 20,
      });
      const alternatives = generateAlternatives(
        createEmptyParsedQuery(),
        mappings,
        { optimize_for: 'precision', format: 'modern', max_results: 20 },
        buildBaseQuery
      );

      expect(explanation).toContain('Cards that are blue');
      expect(explanation).toContain('instant cards');
      expect(explanation).toContain('with counter target spell effects');
      expect(explanation).toContain('priced <=$5');
      expect(explanation).toContain('legal in modern format');

      expect(alternatives).toHaveLength(3);
      expect(alternatives.every((alternative) => alternative.type === 'optimization')).toBe(true);
      expect(alternatives.some((alternative) => alternative.description.includes('budget'))).toBe(true);
    });
  });

  describe('realistic prompt evaluation', () => {
    it('broadens a budget counterspell query while preserving the main intent', async () => {
      const parser = new NaturalLanguageParser();
      const mockClient = {
        searchCards: vi.fn(async ({ query }: { query: string }) => ({
          total_cards: query.includes('usd<=10') ? 12 : 0,
          data: [],
        })),
      };
      const builder = new QueryBuilderEngine(new ConceptExtractor(), mockClient as never);

      const parsed = parser.parse('blue counterspells under $5 for modern', {
        targetFormat: 'modern',
        optimizationStrategy: 'precision',
        maxResults: 20,
      });
      const result = await builder.build(parsed, {
        optimize_for: 'precision',
        format: 'modern',
        max_results: 20,
        test_query: true,
      });

      expect(result.query).toContain('f:modern');
      expect(result.query).toContain('usd<=10');
      expect(result.query).toContain('c:>=u');
      expect(result.query).toContain('(t:instant OR t:sorcery)');
      expect(result.optimizations.some((optimization) => optimization.type === 'broadening')).toBe(true);
      expect(result.testSummary).toEqual({ total_cards: 12, has_more: false });
      expect(result.explanation).toContain('priced <=$5');
    });

    it('narrows an overly broad budget artifact search for commander', async () => {
      const parser = new NaturalLanguageParser();
      const mockClient = {
        searchCards: vi.fn(async () => ({
          total_cards: 350,
          data: [],
        })),
      };
      const builder = new QueryBuilderEngine(new ConceptExtractor(), mockClient as never);

      const parsed = parser.parse('budget artifact cards for commander', {
        targetFormat: 'commander',
        optimizationStrategy: 'precision',
        maxResults: 20,
      });
      const result = await builder.build(parsed, {
        optimize_for: 'precision',
        format: 'commander',
        max_results: 20,
        test_query: true,
      });

      expect(result.query).toContain('t:artifact');
      expect(result.query).toContain('f:commander');
      expect(result.query).toContain('usd<=10');
      expect(result.optimizations.some((optimization) => optimization.type === 'narrowing')).toBe(true);
      expect(result.testSummary).toEqual({ total_cards: 350, has_more: false });
      expect(result.explanation).toContain('artifact cards');
    });

    it('skips live query testing when test_query is disabled', async () => {
      const parser = new NaturalLanguageParser();
      const mockClient = {
        searchCards: vi.fn(),
      };
      const builder = new QueryBuilderEngine(new ConceptExtractor(), mockClient as never);

      const parsed = parser.parse('blue counterspells under $5 for modern', {
        targetFormat: 'modern',
        optimizationStrategy: 'precision',
        maxResults: 20,
      });
      const result = await builder.build(parsed, {
        optimize_for: 'precision',
        format: 'modern',
        max_results: 20,
        test_query: false,
      });

      expect(mockClient.searchCards).not.toHaveBeenCalled();
      expect(result.optimizations).toEqual([]);
      expect(result.testSummary).toBeUndefined();
      expect(result.query).toContain('f:modern');
    });

    it('preserves functional, subtype, and mechanic intent in generated queries', async () => {
      const parser = new NaturalLanguageParser();
      const builder = new QueryBuilderEngine(new ConceptExtractor(), { searchCards: vi.fn() } as never);

      const counterspellResult = await builder.build(
        parser.parse('blue counterspells under $5 for modern'),
        { optimize_for: 'precision', format: 'modern', max_results: 20, test_query: false }
      );
      const dragonResult = await builder.build(
        parser.parse('modern dragon creatures with cycling'),
        { optimize_for: 'precision', format: 'modern', max_results: 20, test_query: false }
      );

      expect(counterspellResult.query).toContain('function:counterspell');
      expect(counterspellResult.query).toContain('(t:instant OR t:sorcery)');
      expect(counterspellResult.query).not.toContain('t:instant OR sorcery');
      expect(dragonResult.query).toContain('t:dragon');
      expect(dragonResult.query).toContain('t:creature t:dragon');
      expect(dragonResult.query).toContain('o:cycling');
    });

    it('keeps independent type and oracle constraints conjunctive', async () => {
      const parser = new NaturalLanguageParser();
      const builder = new QueryBuilderEngine(new ConceptExtractor(), { searchCards: vi.fn() } as never);

      const result = await builder.build(
        parser.parse('artifact creatures with flying and cycling'),
        { optimize_for: 'precision', max_results: 20, test_query: false }
      );

      expect(result.query).toContain('t:artifact');
      expect(result.query).toContain('t:creature');
      expect(result.query).not.toContain('(t:creature OR t:artifact)');
      expect(result.query).not.toContain('(t:artifact OR t:creature)');
      expect(result.query).toContain('o:"flying"');
      expect(result.query).toContain('o:"cycling"');
      expect(result.query).not.toContain('(o:"cycling" OR o:"flying")');
      expect(result.query).not.toContain('(o:"flying" OR o:"cycling")');
    });

    it('preserves explicit price budgets in every generated alternative', async () => {
      const parser = new NaturalLanguageParser();
      const builder = new QueryBuilderEngine(new ConceptExtractor(), { searchCards: vi.fn() } as never);

      const result = await builder.build(
        parser.parse('blue creatures'),
        {
          optimize_for: 'precision',
          max_results: 20,
          price_budget: { max: 7, currency: 'usd' },
          test_query: false,
        }
      );

      expect(result.query).toContain('usd<=7');
      expect(result.alternatives.length).toBeGreaterThan(0);
      expect(result.alternatives.every(alternative => alternative.query.includes('usd<=7'))).toBe(true);
    });

    it('does not infer subtypes or mechanics from substrings inside unrelated words', async () => {
      const parser = new NaturalLanguageParser();
      const builder = new QueryBuilderEngine(new ConceptExtractor(), { searchCards: vi.fn() } as never);

      const selfMillResult = await builder.build(
        parser.parse('self mill cards'),
        { optimize_for: 'precision', max_results: 20, test_query: false }
      );
      const brainstormResult = await builder.build(
        parser.parse('cards named Brainstorm'),
        { optimize_for: 'precision', max_results: 20, test_query: false }
      );

      expect(selfMillResult.query).not.toContain('t:elf');
      expect(brainstormResult.query).not.toContain('o:storm');
    });
  });
});
