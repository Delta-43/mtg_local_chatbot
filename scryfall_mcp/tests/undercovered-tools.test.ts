import { describe, expect, it, vi } from 'vitest';
import { GetCardPricesTool } from '../src/tools/get-card-prices.js';
import { SearchSetsTool } from '../src/tools/search-sets.js';
import { RandomCardTool } from '../src/tools/random-card.js';
import { ValidateBrawlCommanderTool } from '../src/tools/validate-brawl-commander.js';
import { BatchCardAnalysisTool } from '../src/tools/batch-card-analysis.js';
import { ScryfallAPIError } from '../src/types/mcp-types.js';

describe('Under-Covered User-Facing Tools', () => {
  describe('GetCardPricesTool', () => {
    it('shows budget and upgrade options using the card primary type rather than a supertype token', async () => {
      const mockClient = {
        getCard: vi.fn().mockResolvedValue({
          id: 'atraxa-id',
          oracle_id: 'atraxa-oracle',
          name: 'Atraxa, Praetors\' Voice',
          mana_cost: '{1}{G}{W}{U}{B}',
          cmc: 5,
          type_line: 'Legendary Creature — Phyrexian Angel Horror',
          prices: { usd: '7.50' },
          legalities: { commander: 'legal' }
        }),
        searchCards: vi
          .fn()
          .mockResolvedValueOnce({
            total_cards: 2,
            has_more: false,
            data: [
              { name: 'Jodah, the Unifier', prices: { usd: '4.00' } },
              { name: 'Niv-Mizzet Reborn', prices: { usd: '5.25' } }
            ]
          })
          .mockResolvedValueOnce({
            total_cards: 1,
            has_more: false,
            data: [
              { name: 'Omnath, Locus of All', prices: { usd: '14.00' } }
            ]
          })
      };

      const tool = new GetCardPricesTool(mockClient as never);
      const result = await tool.execute({
        card_identifier: 'Atraxa, Praetors\' Voice',
        currency: 'usd',
        format_context: 'commander',
        include_alternatives: true
      });

      const text = result.content[0].text;

      expect(result.isError).toBeUndefined();
      expect(mockClient.searchCards).toHaveBeenNthCalledWith(1, {
        query: 't:creature cmc:5 usd<7.5 f:commander -oracleid:atraxa-oracle',
        limit: 3,
        unique: 'cards'
      });
      expect(mockClient.searchCards).toHaveBeenNthCalledWith(2, {
        query: 't:creature cmc:5 usd>7.5 f:commander -oracleid:atraxa-oracle',
        limit: 3,
        unique: 'cards'
      });
      expect(text).toContain('**Alternatives:**');
      expect(text).toContain('*Budget Options:*');
      expect(text).toContain('Jodah, the Unifier: USD 4.00');
      expect(text).toContain('*Upgrade Options:*');
      expect(text).toContain('Omnath, Locus of All: USD 14.00');
    });

    it('explains when price data is unavailable for alternative comparisons', async () => {
      const mockClient = {
        getCard: vi.fn().mockResolvedValue({
          id: 'mystery-id',
          name: 'Mystery Card',
          mana_cost: '{3}',
          cmc: 3,
          type_line: 'Artifact',
          prices: { usd: null },
          legalities: { commander: 'legal' }
        }),
        searchCards: vi.fn()
      };

      const tool = new GetCardPricesTool(mockClient as never);
      const result = await tool.execute({
        card_identifier: 'Mystery Card',
        currency: 'usd',
        include_alternatives: true
      });

      expect(result.isError).toBeUndefined();
      expect(mockClient.searchCards).not.toHaveBeenCalled();
      expect(result.content[0].text).toContain('Price data not available for comparison');
    });

    it('excludes other printings of the priced card from budget and upgrade options', async () => {
      const mockClient = {
        getCard: vi.fn().mockResolvedValue({
          id: 'target-print',
          oracle_id: 'target-oracle',
          name: 'Target Card',
          cmc: 2,
          type_line: 'Creature',
          prices: { usd: '5.00' },
          legalities: { modern: 'legal' }
        }),
        searchCards: vi.fn().mockImplementation(async ({
          query,
          limit = 20
        }: {
          query: string;
          limit?: number;
        }) => {
          const candidates = query.includes('usd<')
            ? [
                { id: 'cheaper-print', oracle_id: 'target-oracle', name: 'Target Card', prices: { usd: '3.00' } },
                { id: 'budget-id-1', oracle_id: 'budget-oracle-1', name: 'Budget Creature 1', prices: { usd: '2.00' } },
                { id: 'budget-id-2', oracle_id: 'budget-oracle-2', name: 'Budget Creature 2', prices: { usd: '1.50' } },
                { id: 'budget-id-3', oracle_id: 'budget-oracle-3', name: 'Budget Creature 3', prices: { usd: '1.00' } }
              ]
            : [
                { id: 'premium-print', oracle_id: 'target-oracle', name: 'Target Card', prices: { usd: '8.00' } },
                { id: 'upgrade-id-1', oracle_id: 'upgrade-oracle-1', name: 'Upgrade Creature 1', prices: { usd: '10.00' } },
                { id: 'upgrade-id-2', oracle_id: 'upgrade-oracle-2', name: 'Upgrade Creature 2', prices: { usd: '12.00' } },
                { id: 'upgrade-id-3', oracle_id: 'upgrade-oracle-3', name: 'Upgrade Creature 3', prices: { usd: '15.00' } }
              ];
          const data = query.includes('-oracleid:target-oracle')
            ? candidates.filter(card => card.oracle_id !== 'target-oracle')
            : candidates;

          return {
            total_cards: data.length,
            has_more: data.length > limit,
            data: data.slice(0, limit)
          };
        })
      };
      const tool = new GetCardPricesTool(mockClient as never);

      const result = await tool.execute({
        card_identifier: 'Target Card',
        currency: 'usd',
        include_alternatives: true
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('Budget Creature 1: USD 2.00');
      expect(result.content[0].text).toContain('Budget Creature 3: USD 1.00');
      expect(result.content[0].text).toContain('Upgrade Creature 1: USD 10.00');
      expect(result.content[0].text).toContain('Upgrade Creature 3: USD 15.00');
      expect(result.content[0].text).not.toContain('- Target Card:');
      expect(mockClient.searchCards).toHaveBeenCalledTimes(2);
      for (const [params] of mockClient.searchCards.mock.calls) {
        expect(params).toEqual(expect.objectContaining({
          query: expect.stringContaining('-oracleid:target-oracle'),
          unique: 'cards',
          limit: 3
        }));
      }
    });
  });

  describe('SearchSetsTool', () => {
    it('accepts every set type exposed by the tool schema', async () => {
      const mockClient = { getSets: vi.fn().mockResolvedValue([]) };
      const tool = new SearchSetsTool(mockClient as never);

      const result = await tool.execute({ type: 'eternal' });

      expect(result.isError).toBeUndefined();
      expect(mockClient.getSets).toHaveBeenCalledWith(expect.objectContaining({ type: 'eternal' }));
    });

    it('includes formatted set details and explicit filter context in successful searches', async () => {
      const mockClient = {
        getSets: vi.fn().mockResolvedValue([
          {
            name: 'Dominaria United',
            code: 'dmu',
            set_type: 'expansion',
            released_at: '2022-09-09',
            card_count: 281,
            digital: false,
            icon_svg_uri: 'https://img.scryfall.com/sets/dmu.svg'
          }
        ])
      };

      const tool = new SearchSetsTool(mockClient as never);
      const result = await tool.execute({
        query: 'dominaria',
        type: 'expansion',
        released_after: '2022-01-01'
      });

      const text = result.content[0].text;

      expect(result.isError).toBeUndefined();
      expect(text).toContain('Found 1 set:');
      expect(text).toContain('**Dominaria United** (DMU)');
      expect(text).toContain('Type: expansion | Released: 2022-09-09 | Cards: 281');
      expect(text).toContain('*Filtered by: name/code: "dominaria", type: expansion, released after: 2022-01-01*');
    });

    it('rejects impossible release-date ranges with a validation error', async () => {
      const mockClient = {
        getSets: vi.fn()
      };

      const tool = new SearchSetsTool(mockClient as never);
      const result = await tool.execute({
        released_after: '2023-01-01',
        released_before: '2023-01-01'
      });

      expect(result.isError).toBe(true);
      expect(mockClient.getSets).not.toHaveBeenCalled();
      expect(result.content[0].text).toContain('released_after date must be before released_before date');
    });
  });

  describe('BatchCardAnalysisTool', () => {
    it('does not advertise grouping that is not implemented', () => {
      const tool = new BatchCardAnalysisTool({} as never);

      expect(tool.inputSchema.properties).not.toHaveProperty('group_by');
    });
  });

  describe('RandomCardTool', () => {
    it('builds a useful random-card query from combined filters and explains the selection context', async () => {
      const mockClient = {
        getRandomCard: vi.fn().mockResolvedValue({
          id: 'random-id',
          name: 'Questing Beast',
          mana_cost: '{2}{G}{G}',
          type_line: 'Legendary Creature — Beast',
          oracle_text: 'Vigilance, deathtouch, haste',
          set_name: 'Throne of Eldraine',
          rarity: 'mythic',
          prices: { usd: '14.00' },
          legalities: { modern: 'legal' },
          color_identity: ['G'],
          games: ['paper', 'arena']
        })
      };

      const tool = new RandomCardTool(mockClient as never);
      const result = await tool.execute({
        query: 't:creature',
        format: 'modern',
        archetype: 'aggro',
        price_range: { min: 5, max: 15, currency: 'usd' },
        exclude_reprints: true,
        similar_to: 'Questing Beast',
        rarity_preference: 'mythic'
      });

      const text = result.content[0].text;

      expect(result.isError).toBeUndefined();
      expect(mockClient.getRandomCard).toHaveBeenCalledWith(
        't:creature legal:modern (t:creature pow>=2) OR (o:"haste" OR o:"first strike") usd>=5 usd<=15 r:mythic is:firstprint "Questing Beast"'
      );
      expect(text).toContain('# Questing Beast');
      expect(text).toContain('with filters: legal in modern, aggro archetype, mythic rarity, USD price between 5-15, first printing only, similar to "Questing Beast", matching "t:creature"');
    });

    it('returns a caller-friendly no-results message when filtered random search fails', async () => {
      const mockClient = {
        getRandomCard: vi.fn().mockRejectedValue(new ScryfallAPIError('Not found', 404))
      };

      const tool = new RandomCardTool(mockClient as never);
      const result = await tool.execute({
        query: 'o:"extra turn"',
        format: 'standard'
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('No cards found matching the specified criteria');
      expect(result.content[0].text).toContain('(format: standard)');
      expect(result.content[0].text).toContain('(query: "o:"extra turn"")');
    });
  });

  describe('ValidateBrawlCommanderTool', () => {
    it('explains why a commander is valid and what deck-building constraints follow', async () => {
      const mockClient = {
        getCard: vi.fn().mockResolvedValue({
          id: 'niv-id',
          name: 'Niv-Mizzet, Supreme',
          mana_cost: '{U}{U}{B}{B}{R}{R}',
          type_line: 'Legendary Creature — Dragon Avatar',
          oracle_text: 'Flying, hexproof from monocolored',
          set_name: 'March of the Machine: The Aftermath',
          rarity: 'mythic',
          prices: { usd: '7.00' },
          legalities: { brawl: 'legal', standardbrawl: 'not_legal' },
          color_identity: ['U', 'B', 'R'],
          games: ['arena', 'paper']
        })
      };

      const tool = new ValidateBrawlCommanderTool(mockClient as never);
      const result = await tool.execute({
        card_identifier: 'Niv-Mizzet, Supreme',
        format: 'brawl'
      });

      const text = result.content[0].text;

      expect(result.isError).toBeUndefined();
      expect(text).toContain('✅ **VALID COMMANDER**');
      expect(text).toContain('Historic Brawl (100 cards)');
      expect(text).toContain('**Arena Availability:** ✅ Available');
      expect(text).toContain('**Commander Eligible:** ✅ Yes');
      expect(text).toContain('Deck size: 100 cards (including commander)');
      expect(text).toContain('Color identity: UBR only');
    });

    it('lists the specific reasons a card fails Brawl commander validation', async () => {
      const mockClient = {
        getCard: vi.fn().mockResolvedValue({
          id: 'bolt-id',
          name: 'Lightning Bolt',
          mana_cost: '{R}',
          type_line: 'Instant',
          oracle_text: 'Lightning Bolt deals 3 damage to any target.',
          set_name: 'Magic 2010',
          rarity: 'common',
          prices: { usd: '1.00' },
          legalities: { brawl: 'not_legal', standardbrawl: 'not_legal' },
          color_identity: ['R'],
          games: ['paper']
        })
      };

      const tool = new ValidateBrawlCommanderTool(mockClient as never);
      const result = await tool.execute({
        card_identifier: 'Lightning Bolt',
        format: 'brawl'
      });

      const text = result.content[0].text;

      expect(result.isError).toBeUndefined();
      expect(text).toContain('❌ **INVALID COMMANDER**');
      expect(text).toContain('Card must be legendary');
      expect(text).toContain('Card must be a creature or planeswalker');
      expect(text).toContain('Card is not legal in brawl (status: not_legal)');
      expect(text).toContain('Card is not available in Arena');
    });
  });
});
