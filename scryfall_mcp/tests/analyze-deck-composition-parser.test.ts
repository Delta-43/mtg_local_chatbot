import { describe, expect, it } from 'vitest';
import { AnalyzeDeckCompositionTool, parseDeckListEntries } from '../src/tools/analyze-deck-composition.js';
import { RateLimitError, ScryfallAPIError } from '../src/types/mcp-types.js';

const islandCard = {
  id: 'island',
  name: 'Island',
  cmc: 0,
  type_line: 'Basic Land - Island',
  prices: { usd: '0.01' },
  rarity: 'common',
  color_identity: [],
};

const optCard = {
  id: 'opt',
  name: 'Opt',
  cmc: 1,
  type_line: 'Instant',
  prices: { usd: '0.05' },
  rarity: 'common',
  color_identity: ['U'],
};

describe('parseDeckListEntries', () => {
  it('preserves commas inside card names', () => {
    expect(parseDeckListEntries('1 Baral, Chief of Compliance\n1 Ral, Storm Conduit')).toEqual([
      { name: 'Baral, Chief of Compliance', quantity: 1 },
      { name: 'Ral, Storm Conduit', quantity: 1 },
    ]);
  });

  it('strips Arena set and collector suffixes', () => {
    expect(parseDeckListEntries('Commander\n1 Sanar, Unfinished Genius (SOS) 223\n\nDeck\n5 Island (SOS) 274')).toEqual([
      { name: 'Sanar, Unfinished Genius', quantity: 1 },
      { name: 'Island', quantity: 5 },
    ]);
  });
});

describe('AnalyzeDeckCompositionTool Brawl land recommendations', () => {
  it('documents the newline-delimited deck grammar that the parser accepts', () => {
    const tool = new AnalyzeDeckCompositionTool({} as never);
    const description = tool.inputSchema.properties.deck_list.description;

    expect(description).toContain('one card per line');
    expect(description).not.toContain('comma-separated');
  });

  it('does not recommend reducing realistic 100-card Brawl land counts', async () => {
    const client = {
      getCard: async ({ identifier }: { identifier: string }) => identifier === 'Island' ? islandCard : optCard,
    };
    const tool = new AnalyzeDeckCompositionTool(client as never);

    const result = await tool.execute({
      deck_list: '38 Island\n62 Opt',
      format: 'brawl',
      strategy: 'combo',
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Total Cards: 100');
    expect(result.content[0].text).toContain('lands: 38');
    expect(result.content[0].text).not.toContain('Consider reducing lands');
  });

  it('uses exact card lookup before fuzzy fallback for parsed deck names', async () => {
    const calls: Array<{ identifier: string; match?: string }> = [];
    const client = {
      getCard: async ({ identifier, match }: { identifier: string; match?: string }) => {
        calls.push({ identifier, match });

        if (identifier === 'Lightning Bolt' && match === 'exact') {
          throw new ScryfallAPIError('Not found', 404);
        }

        return {
          ...optCard,
          name: identifier === 'Lightning Bolt' ? 'Lightning Bolt' : identifier,
        };
      },
    };
    const tool = new AnalyzeDeckCompositionTool(client as never);

    const result = await tool.execute({
      deck_list: '1 Lightning Bolt',
      format: 'brawl',
      strategy: 'combo',
    });

    expect(result.isError).toBeUndefined();
    expect(calls).toEqual([
      { identifier: 'Lightning Bolt', match: 'exact' },
      { identifier: 'Lightning Bolt', match: undefined },
    ]);
    expect(result.content[0].text).toContain('Fuzzy name resolutions');
    expect(result.content[0].text).toContain('Lightning Bolt -> Lightning Bolt');
  });

  it('returns an explicit rate-limit message when no deck cards can be fetched', async () => {
    const client = {
      getCard: async () => {
        throw new RateLimitError('Rate limit exceeded', 60);
      },
    };
    const tool = new AnalyzeDeckCompositionTool(client as never);

    const result = await tool.execute({
      deck_list: '1 Opt',
      format: 'brawl',
      strategy: 'combo',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Rate limit exceeded. Retry after 60s. No deck analysis was produced.');
  });

  it('returns a partial analysis warning when rate limiting interrupts deck fetches', async () => {
    const client = {
      getCard: async ({ identifier }: { identifier: string }) => {
        if (identifier === 'Opt') {
          throw new RateLimitError('Rate limit exceeded', 30);
        }

        return islandCard;
      },
    };
    const tool = new AnalyzeDeckCompositionTool(client as never);

    const result = await tool.execute({
      deck_list: '1 Island\n1 Opt',
      format: 'brawl',
      strategy: 'combo',
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Partial analysis');
    expect(result.content[0].text).toContain('Retry after 30s');
    expect(result.content[0].text).toContain('1 card name was not analyzed');
    expect(result.content[0].text).toContain('Total Cards: 2');
  });

  it('reports unresolved quantities and suppresses recommendations for low-coverage analysis', async () => {
    const client = {
      getCard: async ({ identifier }: { identifier: string }) => {
        if (identifier === 'Missing Card') {
          throw new ScryfallAPIError('Not found', 404);
        }

        return islandCard;
      },
    };
    const tool = new AnalyzeDeckCompositionTool(client as never);

    const result = await tool.execute({
      deck_list: '1 Island\n9 Missing Card',
      format: 'brawl',
      strategy: 'combo',
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Total Cards: 10');
    expect(result.content[0].text).toContain('Analyzed Cards: 1 of 10');
    expect(result.content[0].text).toContain('9x Missing Card');
    expect(result.content[0].text).toContain('Recommendations omitted');
    expect(result.content[0].text).not.toContain('Consider adding');
  });

  it('suppresses type-dependent recommendations whenever analysis is incomplete', async () => {
    const client = {
      getCard: async ({ identifier }: { identifier: string }) => {
        if (identifier === 'Missing Card') {
          throw new ScryfallAPIError('Not found', 404);
        }

        return identifier === 'Island' ? islandCard : optCard;
      },
    };
    const tool = new AnalyzeDeckCompositionTool(client as never);

    const result = await tool.execute({
      deck_list: '38 Island\n47 Opt\n15 Missing Card',
      format: 'brawl',
      strategy: 'combo',
    });

    expect(result.content[0].text).toContain('Analyzed Cards: 85 of 100');
    expect(result.content[0].text).toContain('Recommendations omitted');
    expect(result.content[0].text).not.toContain('Consider reducing lands');
  });

  it('groups mana values above seven into the displayed 7+ bucket', async () => {
    const client = {
      getCard: async () => ({ ...optCard, name: 'High-Cost Card', cmc: 8 }),
    };
    const tool = new AnalyzeDeckCompositionTool(client as never);

    const result = await tool.execute({
      deck_list: '2 High-Cost Card',
      strategy: 'unknown',
    });

    expect(result.content[0].text).toContain('7+ CMC: 2');
  });
});
