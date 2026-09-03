import { describe, expect, it, vi } from 'vitest';
import { fetchCardsWithConcurrency } from '../src/tools/batch-card-analysis/fetcher.js';
import { analyzeLegality, analyzePrices } from '../src/tools/batch-card-analysis/analyzers.js';
import { ScryfallAPIError } from '../src/types/mcp-types.js';

describe('fetchCardsWithConcurrency', () => {
  it('limits helper-level scheduled fetches to the configured concurrency for injected clients', async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    const mockClient = {
      getCard: vi.fn(async ({ identifier }: { identifier: string }) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise(resolve => setTimeout(resolve, 10));
        inFlight -= 1;

        return {
          id: identifier,
          name: identifier,
          mana_cost: '',
          type_line: 'Instant',
          oracle_text: '',
          cmc: 1,
          legalities: { modern: 'legal' },
          prices: { usd: '1.00' },
          color_identity: ['R']
        };
      })
    };

    const cards = await fetchCardsWithConcurrency(
      mockClient as never,
      ['A', 'B', 'C', 'D', 'E', 'F'],
      2
    );

    expect(cards).toHaveLength(6);
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  it('aggregates missing cards into a validation error', async () => {
    const mockClient = {
      getCard: vi.fn(async ({ identifier }: { identifier: string }) => {
        if (identifier === 'Missing Card') {
          throw new ScryfallAPIError('Not found', 404);
        }

        return {
          id: identifier,
          name: identifier,
          mana_cost: '',
          type_line: 'Instant',
          oracle_text: '',
          cmc: 1,
          legalities: { modern: 'legal' },
          prices: { usd: '1.00' },
          color_identity: ['R']
        };
      })
    };

    await expect(
      fetchCardsWithConcurrency(
        mockClient as never,
        ['Lightning Bolt', 'Missing Card'],
        2
      )
    ).rejects.toThrow('Cards not found: Missing Card');
  });

  it('fetches duplicate card names once while preserving requested output order', async () => {
    const mockClient = {
      getCard: vi.fn(async ({ identifier }: { identifier: string }) => ({
        id: identifier,
        name: identifier,
        mana_cost: '',
        type_line: 'Instant',
        oracle_text: '',
        cmc: 1,
        legalities: { modern: 'legal' },
        prices: { usd: '1.00' },
        color_identity: ['R']
      }))
    };

    const cards = await fetchCardsWithConcurrency(
      mockClient as never,
      ['Lightning Bolt', 'Lightning Bolt', 'Counterspell'],
      2
    );

    expect(mockClient.getCard).toHaveBeenCalledTimes(2);
    expect(mockClient.getCard).toHaveBeenNthCalledWith(1, { identifier: 'Lightning Bolt' });
    expect(mockClient.getCard).toHaveBeenNthCalledWith(2, { identifier: 'Counterspell' });
    expect(cards.map(card => card.name)).toEqual([
      'Lightning Bolt',
      'Lightning Bolt',
      'Counterspell'
    ]);
  });
});

describe('batch card analyzers', () => {
  it('preserves detailed legality output while counting statuses in one pass', () => {
    const result = analyzeLegality([
      {
        id: 'legal-card',
        name: 'Legal Card',
        mana_cost: '',
        type_line: 'Instant',
        oracle_text: '',
        cmc: 1,
        legalities: { modern: 'legal' },
        prices: { usd: '1.00' },
        color_identity: ['U']
      },
      {
        id: 'banned-card',
        name: 'Banned Card',
        mana_cost: '',
        type_line: 'Instant',
        oracle_text: '',
        cmc: 1,
        legalities: { modern: 'banned' },
        prices: { usd: '2.00' },
        color_identity: ['B']
      },
      {
        id: 'restricted-card',
        name: 'Restricted Card',
        mana_cost: '',
        type_line: 'Instant',
        oracle_text: '',
        cmc: 1,
        legalities: { modern: 'restricted' },
        prices: { usd: '3.00' },
        color_identity: ['R']
      },
      {
        id: 'not-legal-card',
        name: 'Not Legal Card',
        mana_cost: '',
        type_line: 'Instant',
        oracle_text: '',
        cmc: 1,
        legalities: { modern: 'not_legal' },
        prices: { usd: '4.00' },
        color_identity: ['G']
      }
    ] as never, 'modern');

    expect(result).toContain('- Legal: 1 cards');
    expect(result).toContain('- Banned: 1 cards');
    expect(result).toContain('- Restricted: 1 cards');
    expect(result).toContain('- Not Legal: 1 cards');
    expect(result).toContain('- Banned Card');
    expect(result).toContain('- Restricted Card');
  });

  it('preserves price summaries and expensive-card ordering while parsing prices once', () => {
    const result = analyzePrices([
      {
        id: 'budget-card',
        name: 'Budget Card',
        mana_cost: '',
        type_line: 'Instant',
        oracle_text: '',
        cmc: 1,
        legalities: { modern: 'legal' },
        prices: { usd: '0.75' },
        color_identity: ['U']
      },
      {
        id: 'moderate-card',
        name: 'Moderate Card',
        mana_cost: '',
        type_line: 'Instant',
        oracle_text: '',
        cmc: 2,
        legalities: { modern: 'legal' },
        prices: { usd: '5.00' },
        color_identity: ['B']
      },
      {
        id: 'expensive-card',
        name: 'Expensive Card',
        mana_cost: '',
        type_line: 'Instant',
        oracle_text: '',
        cmc: 3,
        legalities: { modern: 'legal' },
        prices: { usd: '12.50' },
        color_identity: ['R']
      },
      {
        id: 'premium-card',
        name: 'Premium Card',
        mana_cost: '',
        type_line: 'Instant',
        oracle_text: '',
        cmc: 4,
        legalities: { modern: 'legal' },
        prices: { usd: '20.00' },
        color_identity: ['G']
      }
    ] as never, 'usd');

    expect(result).toContain('- Total Value: USD 38.25');
    expect(result).toContain('- Cards with Prices: 4/4');
    expect(result).toContain('- Expensive (≥$10): 2 cards');
    expect(result).toContain('- Moderate ($1-$10): 1 cards');
    expect(result).toContain('- Budget (<$1): 1 cards');

    const expensiveSection = result.split('**Most Expensive Cards:**\n')[1] || '';
    expect(expensiveSection.indexOf('Premium Card')).toBeLessThan(expensiveSection.indexOf('Expensive Card'));
  });
});
