import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { SearchCardsTool } from '../src/tools/search-cards.js';
import { GetCardTool } from '../src/tools/get-card.js';
import { GetCardRulingsTool } from '../src/tools/get-card-rulings.js';
import { GetCardPricesTool } from '../src/tools/get-card-prices.js';
import { QueryRulesTool } from '../src/tools/query-rules.js';
import { SearchFormatStaplesTool } from '../src/tools/search-format-staples.js';
import { SearchAlternativesTool } from '../src/tools/search-alternatives.js';
import { FindSynergisticCardsTool } from '../src/tools/find-synergistic-cards.js';
import { BuildScryfallQueryTool } from '../src/tools/build-scryfall-query.js';
import { buildSynergyQueries } from '../src/tools/find-synergistic-cards/query-builder.js';
import { BatchCardAnalysisTool } from '../src/tools/batch-card-analysis.js';
import { AnalyzeDeckCompositionTool } from '../src/tools/analyze-deck-composition.js';
import { SuggestManaBaseTool } from '../src/tools/suggest-mana-base.js';
import { ScryfallAPIError } from '../src/types/mcp-types.js';

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

// Mock the ScryfallClient
vi.mock('../src/services/scryfall-client.js');

describe('MCP Tools', () => {
  let mockScryfallClient: any;

  beforeEach(() => {
    mockScryfallClient = {
      searchCards: vi.fn(),
      getCard: vi.fn(),
      getCardRulings: vi.fn(),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('SearchCardsTool', () => {
    let tool: SearchCardsTool;

    beforeEach(() => {
      tool = new SearchCardsTool(mockScryfallClient);
    });

    it('should have correct name and description', () => {
      expect(tool.name).toBe('search_cards');
      expect(tool.description).toContain('Search for Magic: The Gathering cards');
    });

    it('should have correct input schema', () => {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.properties.query).toBeDefined();
      expect(tool.inputSchema.required).toContain('query');
    });

    it('should validate required query parameter', async () => {
      const result = await tool.execute({});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation error');
    });

    it('should validate query parameter type', async () => {
      const result = await tool.execute({ query: 123 });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation error');
    });

    it('should validate limit parameter range', async () => {
      const result = await tool.execute({ query: 'test', limit: 200 });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation error');
    });

    it('should handle successful search', async () => {
      const mockResponse = {
        total_cards: 1,
        has_more: false,
        data: [{
          id: 'test-id',
          name: 'Lightning Bolt',
          mana_cost: '{R}',
          type_line: 'Instant',
          oracle_text: 'Lightning Bolt deals 3 damage to any target.',
          set_name: 'Alpha',
          rarity: 'common',
          prices: { usd: '1.00' },
          legalities: { modern: 'legal' }
        }]
      };

      mockScryfallClient.searchCards.mockResolvedValue(mockResponse);

      const result = await tool.execute({ query: 'lightning bolt' });
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('Lightning Bolt');
      expect(mockScryfallClient.searchCards).toHaveBeenCalledWith({
        query: 'lightning bolt',
        limit: 20,
        page: 1,
        include_extras: false,
        order: undefined,
        unique: 'cards',
        direction: 'auto',
        include_multilingual: false,
        include_variations: false,
        price_range: undefined
      });
    });

    it('should handle no results', async () => {
      const mockResponse = {
        total_cards: 0,
        has_more: false,
        data: []
      };

      mockScryfallClient.searchCards.mockResolvedValue(mockResponse);

      const result = await tool.execute({ query: 'nonexistent card' });
      expect(result.content[0].text).toContain('No cards found');
    });

    it('should handle enhanced search parameters', async () => {
      const mockResponse = {
        total_cards: 1,
        has_more: false,
        data: [{
          id: 'test-id',
          name: 'Lightning Bolt',
          mana_cost: '{R}',
          type_line: 'Instant',
          oracle_text: 'Lightning Bolt deals 3 damage to any target.',
          set_name: 'Alpha',
          rarity: 'common',
          prices: { usd: '1.00' },
          legalities: { modern: 'legal' }
        }]
      };

      mockScryfallClient.searchCards.mockResolvedValue(mockResponse);

      const result = await tool.execute({
        query: 'lightning bolt',
        unique: 'prints',
        direction: 'desc',
        include_multilingual: true,
        include_variations: true,
        price_range: { min: 0.5, max: 2.0, currency: 'usd' }
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('Lightning Bolt');
      expect(mockScryfallClient.searchCards).toHaveBeenCalledWith({
        query: 'lightning bolt',
        limit: 20,
        page: 1,
        include_extras: false,
        order: undefined,
        unique: 'prints',
        direction: 'desc',
        include_multilingual: true,
        include_variations: true,
        price_range: { min: 0.5, max: 2.0, currency: 'usd' }
      });
    });

    it('should normalize enum-like search inputs and nested currency fields', async () => {
      mockScryfallClient.searchCards.mockResolvedValue({
        total_cards: 1,
        has_more: false,
        data: [{
          id: 'test-id',
          name: 'Lightning Bolt',
          mana_cost: '{R}',
          type_line: 'Instant',
          oracle_text: 'Lightning Bolt deals 3 damage to any target.',
          set_name: 'Alpha',
          set: 'lea',
          collector_number: '161',
          arena_id: 67330,
          rarity: 'common',
          prices: { usd: '1.00' },
          legalities: { modern: 'legal' }
        }]
      });

      const result = await tool.execute({
        query: '  lightning bolt  ',
        format: 'JSON',
        unique: 'PRINTS',
        direction: 'DESC',
        order: 'USD',
        price_range: { min: 0.5, max: 2.0, currency: 'USD' }
      });

      expect(result.isError).toBeUndefined();
      expect(mockScryfallClient.searchCards).toHaveBeenCalledWith(expect.objectContaining({
        query: 'lightning bolt',
        unique: 'prints',
        direction: 'desc',
        order: 'usd',
        price_range: { min: 0.5, max: 2.0, currency: 'usd' }
      }));
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.cards[0]).toMatchObject({
        name: 'Lightning Bolt',
        set: 'lea',
        collector_number: '161',
        arena_id: 67330
      });
      expect(result.content[0].text.trim().startsWith('{')).toBe(true);
    });

    it('does not append duplicate game:arena when arena_only is true', async () => {
      mockScryfallClient.searchCards.mockResolvedValue({
        object: 'list',
        total_cards: 1,
        has_more: false,
        data: [{
          id: 'test-id',
          name: 'Goblin Guide',
          mana_cost: '{R}',
          type_line: 'Creature — Goblin Scout',
          oracle_text: 'Haste',
          set_name: 'Zendikar',
          set: 'zen',
          collector_number: '126',
          rarity: 'rare',
          prices: { usd: '5.00' },
          legalities: { brawl: 'legal' }
        }]
      });

      const result = await tool.execute({
        query: 'game:arena legal:brawl t:goblin',
        arena_only: true,
        format: 'json'
      });

      expect(result.isError).toBeUndefined();
      expect(mockScryfallClient.searchCards).toHaveBeenCalledWith(expect.objectContaining({
        query: 'game:arena legal:brawl t:goblin'
      }));
    });

    it('returns a validation error for invalid query syntax before calling search', async () => {
      const result = await tool.execute({ query: '(c:red AND t:creature' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation error');
      expect(result.content[0].text.toLowerCase()).toContain('unbalanced parentheses');
      expect(mockScryfallClient.searchCards).not.toHaveBeenCalled();
    });

    it('continues search when validator emits warnings without hard errors', async () => {
      mockScryfallClient.searchCards.mockResolvedValue({
        object: 'list',
        total_cards: 1,
        has_more: false,
        data: [{
          id: 'warn-path-id',
          name: 'Lightning Bolt',
          mana_cost: '{R}',
          type_line: 'Instant',
          oracle_text: 'Lightning Bolt deals 3 damage to any target.',
          set_name: 'Alpha',
          set: 'lea',
          collector_number: '161',
          rarity: 'common',
          prices: { usd: '1.00' },
          legalities: { modern: 'legal' }
        }]
      });

      const result = await tool.execute({ query: 'colr:red t:instant' });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('Lightning Bolt');
      expect(mockScryfallClient.searchCards).toHaveBeenCalledWith(expect.objectContaining({
        query: 'colr:red t:instant'
      }));
    });
  });

  describe('BuildScryfallQueryTool', () => {
    it('builds queries without live validation by default', async () => {
      const tool = new BuildScryfallQueryTool({ searchCards: mockScryfallClient.searchCards } as never);

      mockScryfallClient.searchCards.mockResolvedValue({
        object: 'list',
        total_cards: 12,
        has_more: false,
        data: [],
      });

      const result = await tool.execute({ natural_query: 'blue counterspells under $5 for modern' });

      expect(mockScryfallClient.searchCards).not.toHaveBeenCalled();
      expect(result.content[0].text).toContain('Generated Scryfall Query');
      expect(result.content[0].text).not.toContain('Query Test Results');
    });
  });

  describe('GetCardTool', () => {
    let tool: GetCardTool;

    beforeEach(() => {
      tool = new GetCardTool(mockScryfallClient);
    });

    it('should have correct name and description', () => {
      expect(tool.name).toBe('get_card');
      expect(tool.description).toContain('Get detailed information');
    });

    it('should validate required identifier parameter', async () => {
      const result = await tool.execute({});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation error');
    });

    it('should handle successful card retrieval', async () => {
      const mockCard = {
        id: 'test-id',
        name: 'Lightning Bolt',
        mana_cost: '{R}',
        type_line: 'Instant',
        oracle_text: 'Lightning Bolt deals 3 damage to any target.',
        set_name: 'Alpha',
        rarity: 'common',
        prices: { usd: '1.00' },
        legalities: { modern: 'legal' }
      };

      mockScryfallClient.getCard.mockResolvedValue(mockCard);

      const result = await tool.execute({ identifier: 'Lightning Bolt' });
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('Lightning Bolt');
      expect(result.content[0].text).toContain('Instant');
    });
  });

  describe('GetCardRulingsTool', () => {
    let tool: GetCardRulingsTool;

    beforeEach(() => {
      tool = new GetCardRulingsTool(mockScryfallClient);
    });

    // Only the two checks that don't involve card/ruling data at all --
    // static metadata and input validation, which reject before any client
    // call happens -- live here, mocked, alongside every other tool's tests
    // in this file (this file mocks scryfall-client.js at module scope, so a
    // real ScryfallClient can't be constructed in it). Everything that
    // touches actual ruling data is a real-network test in
    // get-card-rulings.live.test.ts instead.
    it('should have correct name and description', () => {
      expect(tool.name).toBe('get_card_rulings');
      expect(tool.description).toContain('rulings');
    });

    it('should validate required identifier parameter', async () => {
      const result = await tool.execute({});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation error');
    });
  });

  describe('QueryRulesTool', () => {
    let tool: QueryRulesTool;

    beforeEach(() => {
      tool = new QueryRulesTool();
    });

    it('should have correct name and description', () => {
      expect(tool.name).toBe('query_rules');
      expect(tool.description).toContain('Search Magic: The Gathering comprehensive rules');
    });

    it('should have correct input schema', () => {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.properties.query).toBeDefined();
      expect(tool.inputSchema.required).toContain('query');
    });

    it('should validate required query parameter', async () => {
      const result = await tool.execute({});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation error');
    });

    it('should validate query parameter type', async () => {
      const result = await tool.execute({ query: 123 });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation error');
    });

    it('should validate context_lines parameter range', async () => {
      const result = await tool.execute({ query: 'test', context_lines: 15 });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation error');
    });

    it('should handle missing rules file gracefully', async () => {
      // This test assumes the rules file might not be available in test environment
      const result = await tool.execute({ query: 'priority' });

      // Should either find results or indicate file is not available
      expect(result.content[0].text).toBeDefined();

      if (result.isError) {
        expect(result.content[0].text).toContain('MTG rules file is not available');
      } else {
        // If rules file is available, should return search results
        expect(result.content[0].text).toMatch(/Found \d+ rule|No rules found/);
      }
    });

    it('should load the bundled rules independently of the process working directory', async () => {
      const originalCwd = process.cwd();

      try {
        process.chdir(tmpdir());
        const isolatedTool = new QueryRulesTool();
        const result = await isolatedTool.execute({ query: 'priority' });

        expect(result.isError).toBeUndefined();
        expect(result.content[0].text).toMatch(/Found \d+ rule/);
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe('SearchFormatStaplesTool', () => {
    let tool: SearchFormatStaplesTool;

    beforeEach(() => {
      tool = new SearchFormatStaplesTool(mockScryfallClient);
    });

    it('should have correct name and description', () => {
      expect(tool.name).toBe('search_format_staples');
      expect(tool.description).toContain('Find format staples');
    });

    it('should validate required format parameter', async () => {
      const result = await tool.execute({});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Format is required');
    });

    it('should validate format parameter values', async () => {
      const result = await tool.execute({ format: 'invalid' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Format must be one of');
    });

    it('should handle successful search', async () => {
      const mockResponse = {
        total_cards: 1,
        has_more: false,
        data: [{
          id: 'test-id',
          name: 'Lightning Bolt',
          mana_cost: '{R}',
          type_line: 'Instant',
          oracle_text: 'Lightning Bolt deals 3 damage to any target.',
          set_name: 'Alpha',
          rarity: 'common',
          prices: { usd: '1.00' },
          legalities: { modern: 'legal' }
        }]
      };

      mockScryfallClient.searchCards.mockResolvedValue(mockResponse);

      const result = await tool.execute({ format: 'modern', role: 'removal' });
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('Lightning Bolt');
    });

    it('should build threats queries with valid loyalty syntax and color identity filtering', async () => {
      mockScryfallClient.searchCards.mockResolvedValue({
        total_cards: 0,
        has_more: false,
        data: []
      });

      await tool.execute({
        format: 'commander',
        role: 'threats',
        color_identity: 'grixis'
      });

      expect(mockScryfallClient.searchCards).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.stringContaining('loy>=3')
        })
      );
      expect(mockScryfallClient.searchCards).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.stringContaining('id:ubr')
        })
      );
      expect(mockScryfallClient.searchCards).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.not.stringContaining('loyalty>=')
        })
      );
    });

    it('should normalize format, tier, role, and color identity inputs', async () => {
      mockScryfallClient.searchCards.mockResolvedValue({
        total_cards: 0,
        has_more: false,
        data: []
      });

      const result = await tool.execute({
        format: ' COMMANDER ',
        tier: 'BUDGET',
        role: 'COUNTERSPELLS',
        color_identity: ' Grixis '
      });

      expect(result.isError).toBeUndefined();
      expect(mockScryfallClient.searchCards).toHaveBeenCalledWith(expect.objectContaining({
        order: 'usd',
        query: expect.stringContaining('f:commander')
      }));
      expect(mockScryfallClient.searchCards).toHaveBeenCalledWith(expect.objectContaining({
        query: expect.stringContaining('id:ubr')
      }));
      expect(mockScryfallClient.searchCards).toHaveBeenCalledWith(expect.objectContaining({
        query: expect.stringContaining('(o:counter AND o:spell)')
      }));
    });
  });

  describe('SearchAlternativesTool', () => {
    let tool: SearchAlternativesTool;

    beforeEach(() => {
      tool = new SearchAlternativesTool(mockScryfallClient);
    });

    it('should have correct name and description', () => {
      expect(tool.name).toBe('search_alternatives');
      expect(tool.description).toContain('Find budget alternatives');
    });

    it('should validate required parameters', async () => {
      const result = await tool.execute({});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Target card is required');
    });

    it('should validate direction parameter', async () => {
      const result = await tool.execute({ target_card: 'Lightning Bolt', direction: 'invalid' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Direction must be one of');
    });

    it('should handle target card not found', async () => {
      const error = new ScryfallAPIError('Not found', 404);
      mockScryfallClient.getCard.mockRejectedValue(error);

      const result = await tool.execute({ target_card: 'Nonexistent Card', direction: 'cheaper' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Target card not found');
    });

    it('should handle successful alternatives search', async () => {
      const targetCard = {
        id: 'target-id',
        name: 'Lightning Bolt',
        cmc: 1,
        type_line: 'Instant',
        prices: { usd: '1.00' }
      };

      const alternativeCard = {
        id: 'alt-id',
        name: 'Shock',
        mana_cost: '{R}',
        type_line: 'Instant',
        oracle_text: 'Shock deals 2 damage to any target.',
        set_name: 'Alpha',
        rarity: 'common',
        prices: { usd: '0.50' },
        legalities: { modern: 'legal' }
      };

      mockScryfallClient.getCard.mockResolvedValue(targetCard);
      mockScryfallClient.searchCards.mockResolvedValue({
        total_cards: 1,
        has_more: false,
        data: [alternativeCard]
      });

      const result = await tool.execute({ target_card: 'Lightning Bolt', direction: 'cheaper' });
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('Alternatives for Lightning Bolt');
      expect(result.content[0].text).toContain('Shock');
    });

    it('should exclude other printings of the target card from alternatives', async () => {
      mockScryfallClient.getCard.mockResolvedValue({
        id: 'target-print-id',
        oracle_id: 'lightning-bolt-oracle',
        name: 'Lightning Bolt',
        cmc: 1,
        type_line: 'Instant',
        prices: { usd: '2.00' }
      });
      mockScryfallClient.searchCards.mockImplementation(async ({
        query,
        limit = 20
      }: {
        query: string;
        limit?: number;
      }) => {
        const candidates = [
          {
            id: 'other-print-id',
            oracle_id: 'lightning-bolt-oracle',
            name: 'Lightning Bolt',
            type_line: 'Instant',
            prices: { usd: '1.00' },
            legalities: { modern: 'legal' }
          },
          {
            id: 'shock-id',
            oracle_id: 'shock-oracle',
            name: 'Shock',
            type_line: 'Instant',
            prices: { usd: '0.25' },
            legalities: { modern: 'legal' }
          }
        ];
        const data = query.includes('-oracleid:lightning-bolt-oracle')
          ? candidates.filter(card => card.oracle_id !== 'lightning-bolt-oracle')
          : candidates;

        return {
          total_cards: data.length,
          has_more: data.length > limit,
          data: data.slice(0, limit)
        };
      });

      const result = await tool.execute({
        target_card: 'Lightning Bolt',
        direction: 'cheaper',
        limit: 1
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('Found 1 card:');
      expect(result.content[0].text).toContain('Shock');
      expect(result.content[0].text).not.toContain('**Lightning Bolt**');
      expect(mockScryfallClient.searchCards).toHaveBeenCalledWith(expect.objectContaining({
        query: expect.stringContaining('-oracleid:lightning-bolt-oracle'),
        unique: 'cards'
      }));
    });

    it('should exclude a reversible target that has no top-level Oracle ID', async () => {
      mockScryfallClient.getCard.mockResolvedValue({
        id: 'reversible-target-id',
        name: 'Front Face // Back Face',
        cmc: 2,
        type_line: 'Creature',
        prices: { usd: '2.00' }
      });
      mockScryfallClient.searchCards.mockImplementation(async ({
        query,
        limit = 20
      }: {
        query: string;
        limit?: number;
      }) => {
        const candidates = [
          {
            id: 'other-reversible-print',
            name: 'Front Face // Back Face',
            type_line: 'Creature',
            prices: { usd: '1.00' },
            legalities: { modern: 'legal' }
          },
          {
            id: 'alternative-id',
            oracle_id: 'alternative-oracle',
            name: 'Alternative Card',
            type_line: 'Creature',
            prices: { usd: '0.25' },
            legalities: { modern: 'legal' }
          }
        ];
        const data = query.includes('-!"Front Face // Back Face"')
          ? candidates.filter(card => card.name !== 'Front Face // Back Face')
          : candidates;

        return {
          total_cards: data.length,
          has_more: data.length > limit,
          data: data.slice(0, limit)
        };
      });

      const result = await tool.execute({
        target_card: 'Front Face // Back Face',
        direction: 'cheaper',
        limit: 1
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('Found 1 card:');
      expect(result.content[0].text).toContain('Alternative Card');
      expect(mockScryfallClient.searchCards).toHaveBeenCalledWith(expect.objectContaining({
        query: expect.stringContaining('-!"Front Face // Back Face"')
      }));
    });

    it('should preserve the actual card type instead of the first type-line token', async () => {
      const targetCard = {
        id: 'target-id',
        name: 'Atraxa, Grand Unifier',
        cmc: 7,
        type_line: 'Legendary Creature — Phyrexian Angel',
        prices: { usd: '12.00' }
      };

      mockScryfallClient.getCard.mockResolvedValue(targetCard);
      mockScryfallClient.searchCards.mockResolvedValue({
        total_cards: 0,
        has_more: false,
        data: []
      });

      await tool.execute({ target_card: 'Atraxa, Grand Unifier', direction: 'similar' });

      expect(mockScryfallClient.searchCards).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.stringContaining('t:creature')
        })
      );
      expect(mockScryfallClient.searchCards).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.not.stringContaining('t:Legendary')
        })
      );
    });

    it('should normalize direction and format inputs', async () => {
      const targetCard = {
        id: 'target-id',
        name: 'Lightning Bolt',
        cmc: 1,
        type_line: 'Instant',
        prices: { usd: '1.00' }
      };

      mockScryfallClient.getCard.mockResolvedValue(targetCard);
      mockScryfallClient.searchCards.mockResolvedValue({
        total_cards: 0,
        has_more: false,
        data: []
      });

      const result = await tool.execute({
        target_card: ' Lightning Bolt ',
        direction: 'CHEAPER',
        format: 'MODERN'
      });

      expect(result.isError).toBeUndefined();
      expect(mockScryfallClient.getCard).toHaveBeenCalledWith({ identifier: 'Lightning Bolt' });
      expect(mockScryfallClient.searchCards).toHaveBeenCalledWith(expect.objectContaining({
        order: 'usd',
        query: expect.stringContaining('f:modern')
      }));
    });
  });

  describe('FindSynergisticCardsTool', () => {
    let tool: FindSynergisticCardsTool;

    beforeEach(() => {
      tool = new FindSynergisticCardsTool(mockScryfallClient);
    });

    it('should have correct name and description', () => {
      expect(tool.name).toBe('find_synergistic_cards');
      expect(tool.description).toContain('Find cards that synergize');
    });

    it('should validate required focus_card parameter', async () => {
      const result = await tool.execute({});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Focus card is required');
    });

    it('should validate synergy_type parameter', async () => {
      const result = await tool.execute({ focus_card: 'Lightning Bolt', synergy_type: 'invalid' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Synergy type must be one of');
    });

    it('should handle successful synergy search with existing card', async () => {
      const focusCard = {
        id: 'focus-id',
        name: 'Serra Angel',
        type_line: 'Creature — Angel',
        oracle_text: 'Flying, vigilance'
      };

      const synergyCard = {
        id: 'synergy-id',
        name: 'Sephara, Sky\'s Blade',
        mana_cost: '{4}{W}{W}{W}',
        type_line: 'Legendary Creature — Angel',
        oracle_text: 'Flying, lifelink. Other creatures you control with flying get +1/+1.',
        set_name: 'Core Set 2020',
        rarity: 'mythic',
        prices: { usd: '2.50' },
        legalities: { modern: 'legal' }
      };

      mockScryfallClient.getCard.mockResolvedValue(focusCard);
      // Mock multiple search calls that the synergy tool makes
      mockScryfallClient.searchCards
        .mockResolvedValueOnce({
          total_cards: 1,
          has_more: false,
          data: [synergyCard]
        })
        .mockResolvedValue({
          total_cards: 0,
          has_more: false,
          data: []
        });

      const result = await tool.execute({ focus_card: 'Serra Angel', synergy_type: 'keyword' });
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('Synergistic cards for "Serra Angel"');
      expect(result.content[0].text).toContain('Sephara');
    });

    it('should handle theme-based synergy search when card not found', async () => {
      const synergyCard = {
        id: 'synergy-id',
        name: 'Goblin Guide',
        mana_cost: '{R}',
        type_line: 'Creature — Goblin Berserker',
        oracle_text: 'Haste',
        set_name: 'Zendikar',
        rarity: 'rare',
        prices: { usd: '5.00' },
        legalities: { modern: 'legal' }
      };

      mockScryfallClient.getCard.mockRejectedValue(new ScryfallAPIError('Not found', 404));
      mockScryfallClient.searchCards.mockResolvedValue({
        total_cards: 1,
        has_more: false,
        data: [synergyCard]
      });

      const result = await tool.execute({ focus_card: 'goblin tribal', synergy_type: 'tribal' });
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('Synergistic cards for "goblin tribal"');
    });

    it('should render fallback results when primary layered searches miss', async () => {
      const synergyCard = {
        id: 'fallback-id',
        name: 'Foundry Inspector',
        mana_cost: '{3}',
        type_line: 'Artifact Creature — Construct',
        oracle_text: 'Artifact spells you cast cost {1} less to cast.',
        set_name: 'Kaladesh',
        rarity: 'uncommon',
        prices: { usd: '0.25' },
        legalities: { commander: 'legal' }
      };

      let callCount = 0;
      mockScryfallClient.getCard.mockRejectedValue(new ScryfallAPIError('Not found', 404));
      mockScryfallClient.searchCards.mockImplementation(async () => {
        callCount += 1;
        return callCount <= 8
          ? { total_cards: 0, has_more: false, data: [] }
          : { total_cards: 1, has_more: false, data: [synergyCard] };
      });

      const result = await tool.execute({ focus_card: 'artifact', synergy_type: 'theme' });
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('Foundry Inspector');
    });

    it('should stop searching once enough unique synergy results are found', async () => {
      const params = {
        focus_card: 'artifact token graveyard counter',
        synergy_type: 'theme' as const,
        include_lands: true,
        limit: 2,
        arena_only: false
      };
      const totalQueries = buildSynergyQueries(null, params).length;
      let searchCallCount = 0;

      mockScryfallClient.getCard.mockRejectedValue(new ScryfallAPIError('Not found', 404));
      mockScryfallClient.searchCards.mockImplementation(async ({ query }: { query: string }) => {
        searchCallCount += 1;
        return {
          total_cards: 1,
          has_more: false,
          data: [{
            id: `synergy-${searchCallCount}`,
            name: `Card ${searchCallCount}`,
            mana_cost: '{1}',
            type_line: 'Artifact',
            oracle_text: query,
            set_name: 'Test Set',
            rarity: 'uncommon',
            prices: { usd: '0.25' },
            legalities: { commander: 'legal' }
          }]
        };
      });

      const result = await tool.execute({
        focus_card: params.focus_card,
        synergy_type: params.synergy_type,
        limit: params.limit
      });

      expect(result.isError).toBeUndefined();
      expect(searchCallCount).toBeLessThan(totalQueries);
      expect(result.content[0].text).toContain('Card 1');
      expect(result.content[0].text).toContain('Card 2');
    });

    it('should normalize synergy parameters defensively', async () => {
      const focusCard = {
        id: 'focus-id',
        name: 'Serra Angel',
        type_line: 'Creature — Angel',
        oracle_text: 'Flying, vigilance'
      };

      mockScryfallClient.getCard.mockResolvedValue(focusCard);
      mockScryfallClient.searchCards.mockResolvedValue({
        total_cards: 0,
        has_more: false,
        data: []
      });

      const result = await tool.execute({
        focus_card: ' Serra Angel ',
        synergy_type: 'KEYWORD',
        format: 'COMMANDER',
        exclude_colors: ' RB '
      });

      expect(result.isError).toBeUndefined();
      expect(mockScryfallClient.getCard).toHaveBeenCalledWith({ identifier: 'Serra Angel' });
      expect(mockScryfallClient.searchCards).toHaveBeenCalledWith(expect.objectContaining({
        query: expect.stringContaining('legal:commander')
      }));
      expect(mockScryfallClient.searchCards).toHaveBeenCalledWith(expect.objectContaining({
        query: expect.stringContaining('-c:r')
      }));
      expect(mockScryfallClient.searchCards).toHaveBeenCalledWith(expect.objectContaining({
        query: expect.stringContaining('-c:b')
      }));
    });

    it('should prioritize strategic synergies ahead of mechanical matches in the final output', async () => {
      const focusCard = {
        id: 'focus-id',
        name: 'Test Focus',
        type_line: 'Creature — Human Wizard',
        oracle_text: 'Flying. Whenever you cast an instant or sorcery, create a token. At the beginning of your upkeep, draw a card.',
        color_identity: ['U', 'R']
      };

      const strategicCard = {
        id: 'strategic-id',
        name: 'Young Pyromancer',
        mana_cost: '{1}{R}',
        type_line: 'Creature — Human Shaman',
        oracle_text: 'Whenever you cast an instant or sorcery spell, create a 1/1 red Elemental creature token.',
        edhrec_rank: 120,
        set_name: 'Magic 2014',
        rarity: 'rare',
        prices: { usd: '1.50' },
        legalities: { commander: 'legal' }
      };

      const mechanicalCard = {
        id: 'mechanical-id',
        name: 'Watcher of the Spheres',
        mana_cost: '{1}{W}',
        type_line: 'Creature — Bird Wizard',
        oracle_text: 'Creature spells with flying you cast cost {1} less to cast.',
        edhrec_rank: 400,
        set_name: 'Core Set 2021',
        rarity: 'uncommon',
        prices: { usd: '0.25' },
        legalities: { commander: 'legal' }
      };

      mockScryfallClient.getCard.mockResolvedValue(focusCard);
      mockScryfallClient.searchCards.mockImplementation(async ({ query }: { query: string }) => {
        if (query.includes('whenever you cast an instant or sorcery')) {
          return { total_cards: 1, has_more: false, data: [strategicCard] };
        }

        if (query.includes('(o:"human" OR t:"human")')) {
          return { total_cards: 1, has_more: false, data: [focusCard] };
        }

        if (query.includes('o:"flying"')) {
          return { total_cards: 1, has_more: false, data: [mechanicalCard] };
        }

        return { total_cards: 0, has_more: false, data: [] };
      });

      const result = await tool.execute({ focus_card: 'Test Focus', format: 'commander', limit: 6 });
      const text = result.content[0].text;

      expect(result.isError).toBeUndefined();
      expect(text).toContain('**🎯 Strategic Synergies:**');
      expect(text).toContain('**⚡ Mechanical Synergies:**');
      expect(text.indexOf('**🎯 Strategic Synergies:**')).toBeLessThan(text.indexOf('**⚡ Mechanical Synergies:**'));
      expect(text).toContain('Young Pyromancer');
      expect(text).toContain('Watcher of the Spheres');
      expect(text).toContain('Triggers from spell casting');
      expect(text).not.toContain('• **Test Focus**');
    });
  });

  describe('GetCardPricesTool', () => {
    let tool: GetCardPricesTool;

    beforeEach(() => {
      tool = new GetCardPricesTool(mockScryfallClient);
    });

    it('should normalize currency and format context inputs', async () => {
      mockScryfallClient.getCard.mockResolvedValue({
        id: 'test-id',
        name: 'Lightning Bolt',
        mana_cost: '{R}',
        type_line: 'Instant',
        oracle_text: 'Lightning Bolt deals 3 damage to any target.',
        set_name: 'Alpha',
        rarity: 'common',
        prices: { usd: '1.00' },
        legalities: { modern: 'legal' }
      });

      const result = await tool.execute({
        card_identifier: ' Lightning Bolt ',
        currency: 'USD',
        format_context: 'MODERN'
      });

      expect(result.isError).toBeUndefined();
      expect(mockScryfallClient.getCard).toHaveBeenCalledWith({ identifier: 'Lightning Bolt' });
      expect(result.content[0].text).toContain('Paper');
      expect(result.content[0].text).toContain('MODERN Legality');
    });
  });

  describe('BatchCardAnalysisTool', () => {
    let tool: BatchCardAnalysisTool;

    beforeEach(() => {
      tool = new BatchCardAnalysisTool(mockScryfallClient);
    });

    it('should have correct name and description', () => {
      expect(tool.name).toBe('batch_card_analysis');
      expect(tool.description).toContain('Analyze multiple cards');
    });

    it('should validate required parameters', async () => {
      const result = await tool.execute({});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Card list is required');
    });

    it('should validate analysis_type parameter', async () => {
      const result = await tool.execute({
        card_list: ['Lightning Bolt'],
        analysis_type: 'invalid'
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Analysis type must be one of');
    });

    it('should validate card list size', async () => {
      const largeList = Array(101).fill('Lightning Bolt');
      const result = await tool.execute({
        card_list: largeList,
        analysis_type: 'legality'
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('cannot exceed 100 cards');
    });

    it('should handle successful legality analysis', async () => {
      const mockCard = {
        id: 'test-id',
        name: 'Lightning Bolt',
        mana_cost: '{R}',
        type_line: 'Instant',
        oracle_text: 'Lightning Bolt deals 3 damage to any target.',
        cmc: 1,
        legalities: {
          modern: 'legal',
          standard: 'not_legal',
          legacy: 'legal'
        },
        prices: { usd: '1.00' },
        color_identity: ['R']
      };

      mockScryfallClient.getCard.mockResolvedValue(mockCard);

      const result = await tool.execute({
        card_list: ['Lightning Bolt'],
        analysis_type: 'legality',
        format: 'modern'
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('Legality Analysis');
      expect(result.content[0].text).toContain('MODERN Legality');
      expect(result.content[0].text).toContain('Legal: 1 cards');
    });

    it('should handle successful price analysis', async () => {
      const mockCard = {
        id: 'test-id',
        name: 'Lightning Bolt',
        mana_cost: '{R}',
        type_line: 'Instant',
        cmc: 1,
        legalities: { modern: 'legal' },
        prices: { usd: '1.50', eur: '1.20' },
        color_identity: ['R']
      };

      mockScryfallClient.getCard.mockResolvedValue(mockCard);

      const result = await tool.execute({
        card_list: ['Lightning Bolt'],
        analysis_type: 'prices',
        currency: 'usd'
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('Price Analysis');
      expect(result.content[0].text).toContain('Total Value: USD 1.50');
    });

    it('should handle card not found error', async () => {
      mockScryfallClient.getCard.mockRejectedValue(new ScryfallAPIError('Not found', 404));

      const result = await tool.execute({
        card_list: ['Nonexistent Card'],
        analysis_type: 'legality'
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Cards not found: Nonexistent Card');
    });

    it('should normalize analysis enums and trim card list entries', async () => {
      mockScryfallClient.getCard.mockResolvedValue({
        id: 'test-id',
        name: 'Lightning Bolt',
        mana_cost: '{R}',
        type_line: 'Instant',
        cmc: 1,
        legalities: { modern: 'legal' },
        prices: { usd: '1.50' },
        color_identity: ['R']
      });

      const result = await tool.execute({
        card_list: [' Lightning Bolt '],
        analysis_type: 'PRICES',
        currency: 'USD'
      });

      expect(result.isError).toBeUndefined();
      expect(mockScryfallClient.getCard).toHaveBeenCalledWith({ identifier: 'Lightning Bolt' });
      expect(result.content[0].text).toContain('Price Analysis');
      expect(result.content[0].text).toContain('USD 1.50');
    });
  });

  describe('AnalyzeDeckCompositionTool', () => {
    let tool: AnalyzeDeckCompositionTool;

    beforeEach(() => {
      tool = new AnalyzeDeckCompositionTool(mockScryfallClient);
    });

    it('should not expose commander as a public input parameter', () => {
      expect(tool.inputSchema.properties.commander).toBeUndefined();
    });

    it('should respect quantities in the deck list', async () => {
      mockScryfallClient.getCard.mockImplementation(async ({ identifier }: { identifier: string }) => {
        if (identifier === 'Lightning Bolt') {
          return {
            id: 'bolt-id',
            name: 'Lightning Bolt',
            cmc: 1,
            type_line: 'Instant',
            oracle_text: 'Lightning Bolt deals 3 damage to any target.',
            rarity: 'common',
            prices: { usd: '1.00' },
            color_identity: ['R']
          };
        }

        return {
          id: 'mountain-id',
          name: 'Mountain',
          cmc: 0,
          type_line: 'Basic Land — Mountain',
          rarity: 'common',
          prices: { usd: '0.10' },
          color_identity: ['R']
        };
      });

      const result = await tool.execute({
        deck_list: '4 Lightning Bolt\n20 Mountain',
        format: 'modern',
        strategy: 'aggro'
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('Total Cards: 24');
      expect(result.content[0].text).toContain('0 CMC: 20');
      expect(result.content[0].text).toContain('1 CMC: 4');
      expect(result.content[0].text).toContain('lands: 20');
    });

    it('should count multi-type lands as lands and in their primary category', async () => {
      mockScryfallClient.getCard.mockImplementation(async ({ identifier }: { identifier: string }) => {
        if (identifier === 'Seat of the Synod') {
          return {
            id: 'seat-id',
            name: identifier,
            cmc: 0,
            type_line: 'Artifact Land',
            rarity: 'common',
            prices: { usd: '1.00' },
            color_identity: ['U']
          };
        }

        return {
          id: 'dryad-arbor-id',
          name: identifier,
          cmc: 0,
          type_line: 'Land Creature — Forest Dryad',
          rarity: 'rare',
          prices: { usd: '8.00' },
          color_identity: ['G']
        };
      });

      const result = await tool.execute({
        deck_list: '4 Seat of the Synod\n4 Dryad Arbor',
        format: 'modern',
        strategy: 'midrange'
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('lands: 8');
      expect(result.content[0].text).toContain('artifacts: 4');
      expect(result.content[0].text).toContain('creatures: 4');
    });

    it('should normalize format and strategy inputs', async () => {
      mockScryfallClient.getCard.mockResolvedValue({
        id: 'bolt-id',
        name: 'Lightning Bolt',
        cmc: 1,
        type_line: 'Instant',
        oracle_text: 'Lightning Bolt deals 3 damage to any target.',
        rarity: 'common',
        prices: { usd: '1.00' },
        color_identity: ['R']
      });

      const result = await tool.execute({
        deck_list: 'Lightning Bolt',
        format: 'MODERN',
        strategy: 'AGGRO'
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('Strategy: aggro');
      expect(result.content[0].text).toContain('Format: modern');
    });

    it('should fetch unique deck cards concurrently while preserving output', async () => {
      const boltLookup = createDeferred<{
        id: string;
        name: string;
        cmc: number;
        type_line: string;
        oracle_text: string;
        rarity: 'common';
        prices: { usd: string };
        color_identity: ['R'];
      }>();
      const mountainLookup = createDeferred<{
        id: string;
        name: string;
        cmc: number;
        type_line: string;
        rarity: 'common';
        prices: { usd: string };
        color_identity: ['R'];
      }>();

      mockScryfallClient.getCard.mockImplementation(({ identifier }: { identifier: string }) => {
        if (identifier === 'Lightning Bolt') {
          return boltLookup.promise;
        }

        return mountainLookup.promise;
      });

      const execution = tool.execute({
        deck_list: '4 Lightning Bolt\n20 Mountain',
        format: 'modern',
        strategy: 'aggro'
      });

      await Promise.resolve();
      expect(mockScryfallClient.getCard).toHaveBeenCalledTimes(2);
      expect(mockScryfallClient.getCard).toHaveBeenNthCalledWith(1, { identifier: 'Lightning Bolt', match: 'exact' });
      expect(mockScryfallClient.getCard).toHaveBeenNthCalledWith(2, { identifier: 'Mountain', match: 'exact' });

      mountainLookup.resolve({
        id: 'mountain-id',
        name: 'Mountain',
        cmc: 0,
        type_line: 'Basic Land — Mountain',
        rarity: 'common',
        prices: { usd: '0.10' },
        color_identity: ['R']
      });
      boltLookup.resolve({
        id: 'bolt-id',
        name: 'Lightning Bolt',
        cmc: 1,
        type_line: 'Instant',
        oracle_text: 'Lightning Bolt deals 3 damage to any target.',
        rarity: 'common',
        prices: { usd: '1.00' },
        color_identity: ['R']
      });

      const result = await execution;
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('Total Cards: 24');
    });

    it('should surface actionable warnings for an under-landed high-curve aggro shell', async () => {
      const expensiveThreats = new Map([
        ['Goldspan Dragon', { cmc: 5, price: '12.00' }],
        ['Glorybringer', { cmc: 5, price: '7.50' }],
        ['Thundermaw Hellkite', { cmc: 5, price: '18.00' }],
        ['Terror of the Peaks', { cmc: 5, price: '25.00' }],
        ['Skarrgan Hellkite', { cmc: 5, price: '6.50' }],
        ['Leyline Tyrant', { cmc: 5, price: '8.50' }]
      ]);

      mockScryfallClient.getCard.mockImplementation(async ({ identifier }: { identifier: string }) => {
        if (identifier === 'Mountain') {
          return {
            id: 'mountain-id',
            name: 'Mountain',
            cmc: 0,
            type_line: 'Basic Land — Mountain',
            rarity: 'common',
            prices: { usd: '0.10' },
            color_identity: ['R']
          };
        }

        const threat = expensiveThreats.get(identifier);
        if (!threat) {
          throw new Error(`Unexpected card lookup: ${identifier}`);
        }

        return {
          id: identifier.toLowerCase().replace(/\s+/g, '-'),
          name: identifier,
          cmc: threat.cmc,
          type_line: 'Creature — Dragon',
          oracle_text: 'Flying, haste',
          rarity: 'mythic',
          prices: { usd: threat.price },
          color_identity: ['R']
        };
      });

      const result = await tool.execute({
        deck_list: [
          '4 Mountain',
          '3 Goldspan Dragon',
          '3 Glorybringer',
          '3 Thundermaw Hellkite',
          '3 Terror of the Peaks',
          '3 Skarrgan Hellkite',
          '3 Leyline Tyrant'
        ].join('\n'),
        format: 'modern',
        strategy: 'aggro'
      });

      const text = result.content[0].text;

      expect(result.isError).toBeUndefined();
      expect(text).toContain('Average CMC: 4.09');
      expect(text).toContain('⚡ Mana curve too high for aggro');
      expect(text).toContain('🌍 Consider adding 20 more lands');
      expect(text).toContain('💰 Deck contains 6 expensive cards (total: $232.50)');
      expect(text).toContain('• 3x Thundermaw Hellkite: $18.00 each');
      expect(text).toContain('⭐ **Key Cards:**');
    });
  });

  describe('SuggestManaBaseTool', () => {
    let tool: SuggestManaBaseTool;

    beforeEach(() => {
      tool = new SuggestManaBaseTool();
    });

    it('should not recommend more lands than the computed land count', async () => {
      const result = await tool.execute({
        color_requirements: 'WU',
        deck_size: 60,
        format: 'modern',
        strategy: 'midrange',
        budget: 'moderate'
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('Total Lands: 24/60');

      const recommendationCounts = Array.from(result.content[0].text.matchAll(/• (\d+)x /g))
        .map((match) => Number(match[1]));
      const totalRecommended = recommendationCounts.reduce((sum, count) => sum + count, 0);

      expect(totalRecommended).toBe(24);
    });

    it('should normalize strategy, budget, and special requirements inputs', async () => {
      const result = await tool.execute({
        color_requirements: ' wu ',
        deck_size: 60,
        format: 'MODERN',
        strategy: 'MIDRANGE',
        budget: 'MODERATE',
        special_requirements: ['UTILITY_LANDS', ' enters_untapped ']
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('Colors: WU');
      expect(result.content[0].text).toContain('Strategy: midrange');
      expect(result.content[0].text).toContain('Budget: moderate');
    });

    it('should produce a coherent fixing plan for a three-color modern control deck', async () => {
      const result = await tool.execute({
        color_requirements: 'WUB',
        deck_size: 60,
        format: 'modern',
        strategy: 'control',
        budget: 'expensive',
        average_cmc: 4.5,
        special_requirements: ['utility_lands']
      });

      const text = result.content[0].text;
      const recommendationCounts = Array.from(text.matchAll(/• (\d+)x /g))
        .map((match) => Number(match[1]));
      const totalRecommended = recommendationCounts.reduce((sum, count) => sum + count, 0);

      expect(result.isError).toBeUndefined();
      expect(text).toContain('• Colors: WUB');
      expect(text).toContain('• Total Lands: 26/60');
      expect(text).toContain('• Dual/Fixing: 6 lands');
      expect(text).toContain('🌈 **Dual Lands:**');
      expect(text).toContain('• 3x Fetchlands');
      expect(text).toContain('• 3x Shocklands');
      expect(text).toContain('• Include more utility lands for late game');
      expect(totalRecommended).toBe(26);
    });
  });
});
