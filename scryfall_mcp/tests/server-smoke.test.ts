import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ScryfallMCPServer, createConfiguredServer } from '../src/server.js';

async function invokeRequest(server: Server, method: string, params: Record<string, unknown> = {}) {
  const handlers = (server as unknown as { _requestHandlers: Map<string, (request: unknown) => Promise<unknown>> })._requestHandlers;
  const handler = handlers.get(method);

  if (!handler) {
    throw new Error(`No handler registered for ${method}`);
  }

  return handler({
    jsonrpc: '2.0',
    id: 1,
    method,
    params,
  });
}

describe('MCP server smoke tests', () => {
  let appServer: ScryfallMCPServer;
  let sdkServer: Server;
  let mockScryfallClient: {
    searchCards: ReturnType<typeof vi.fn>;
    getCard: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    const configuredServer = await createConfiguredServer({
      name: 'scryfall-mcp-test',
      version: '1.0.0',
    });

    appServer = configuredServer.appServer;
    sdkServer = configuredServer.sdkServer;

    mockScryfallClient = {
      searchCards: vi.fn(),
      getCard: vi.fn(),
    };

    Object.assign((appServer as unknown as { scryfallClient: unknown }).scryfallClient as object, mockScryfallClient);
  });

  afterEach(async () => {
    await appServer.destroy();
    vi.clearAllMocks();
  });

  it('lists registered tools through the MCP server handler', async () => {
    const result = await invokeRequest(sdkServer, 'tools/list');
    const listedTools = (result as {
      tools: Array<{ name: string; inputSchema?: { properties?: Record<string, { type?: string }> }; _meta?: Record<string, unknown> }>;
    }).tools;
    const tools = listedTools.map((tool) => tool.name);

    expect(tools).toContain('search_cards');
    expect(tools).toContain('query_rules');
    expect(tools).toContain('suggest_mana_base');
    expect(tools).toContain('show_card_search');
    expect(listedTools.find((tool) => tool.name === 'show_card_search')?._meta).toMatchObject({
      ui: {
        resourceUri: 'ui://widget/card-search.html',
      },
    });
    expect(listedTools.find((tool) => tool.name === 'show_card_search')?.inputSchema?.properties?.limit?.type).toBe('integer');
  });

  it('exposes the ChatGPT card search widget as an MCP app resource', async () => {
    const listResult = await invokeRequest(sdkServer, 'resources/list');
    const resources = (listResult as { resources: Array<{ uri: string; mimeType?: string }> }).resources;

    expect(resources).toContainEqual(
      expect.objectContaining({
        uri: 'ui://widget/card-search.html',
        mimeType: 'text/html;profile=mcp-app',
      })
    );

    const readResult = await invokeRequest(sdkServer, 'resources/read', {
      uri: 'ui://widget/card-search.html',
    });
    const contents = (readResult as { contents: Array<{ text: string; _meta?: Record<string, unknown> }> }).contents;

    expect(contents[0].text).toContain('ui/notifications/tool-result');
    expect(contents[0].text).toContain('View on Scryfall');
    expect(contents[0]._meta).toMatchObject({
      ui: {
        csp: {
          resourceDomains: ['https://cards.scryfall.io'],
        },
      },
    });
  });

  it('executes a search tool through the server layer using the registered call handler', async () => {
    mockScryfallClient.searchCards.mockResolvedValue({
      total_cards: 1,
      has_more: false,
      data: [
        {
          id: 'bolt-id',
          name: 'Lightning Bolt',
          mana_cost: '{R}',
          type_line: 'Instant',
          oracle_text: 'Lightning Bolt deals 3 damage to any target.',
          set_name: 'Magic 2010',
          rarity: 'common',
          prices: { usd: '1.00' },
          legalities: { modern: 'legal' },
        },
      ],
    });

    const result = await invokeRequest(sdkServer, 'tools/call', {
      name: 'search_cards',
      arguments: {
        query: 'Lightning Bolt',
        limit: 5,
      },
    });

    const response = result as { content: Array<{ text: string }>; isError?: boolean };
    expect(response.isError).toBeUndefined();
    expect(response.content[0].text).toContain('Lightning Bolt');
    expect(mockScryfallClient.searchCards).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'Lightning Bolt',
        limit: 5,
      })
    );
  });

  it('returns structured widget data from the ChatGPT card search tool', async () => {
    mockScryfallClient.searchCards.mockResolvedValue({
      total_cards: 1,
      has_more: false,
      data: [
        {
          object: 'card',
          id: 'bolt-id',
          name: 'Lightning Bolt',
          mana_cost: '{R}',
          type_line: 'Instant',
          image_uris: { normal: 'https://cards.scryfall.io/normal/front/bolt.jpg' },
          set: 'm10',
          rarity: 'common',
          artist: 'Christopher Rush',
          scryfall_uri: 'https://scryfall.com/card/m10/146/lightning-bolt',
        },
      ],
    });

    const result = await invokeRequest(sdkServer, 'tools/call', {
      name: 'show_card_search',
      arguments: {
        query: 'Lightning Bolt',
        limit: 1,
      },
    });

    const response = result as {
      content: Array<{ text: string }>;
      structuredContent?: {
        cards?: Array<{ name: string; imageUrl?: string; artist?: string; scryfallUrl?: string }>;
        totalCards?: number;
      };
      isError?: boolean;
    };
    expect(response.isError).toBeUndefined();
    expect(response.content[0].text).toContain('Showing 1 Scryfall card result');
    expect(response.structuredContent?.totalCards).toBe(1);
    expect(response.structuredContent?.cards?.[0]).toMatchObject({
      name: 'Lightning Bolt',
      imageUrl: 'https://cards.scryfall.io/normal/front/bolt.jpg',
      artist: 'Christopher Rush',
      scryfallUrl: 'https://scryfall.com/card/m10/146/lightning-bolt',
    });
  });

  it('continues serving valid search calls after a user-correctable invalid search', async () => {
    const invalidResult = await invokeRequest(sdkServer, 'tools/call', {
      name: 'search_cards',
      arguments: {
        query: '(c:red AND t:creature',
      },
    });

    expect((invalidResult as { isError?: boolean }).isError).toBe(true);
    expect(mockScryfallClient.searchCards).not.toHaveBeenCalled();

    mockScryfallClient.searchCards.mockResolvedValue({
      total_cards: 1,
      has_more: false,
      data: [
        {
          id: 'bolt-id',
          name: 'Lightning Bolt',
          mana_cost: '{R}',
          type_line: 'Instant',
          oracle_text: 'Lightning Bolt deals 3 damage to any target.',
          set_name: 'Magic 2010',
          rarity: 'common',
          prices: { usd: '1.00' },
          legalities: { modern: 'legal' },
        },
      ],
    });

    const validResult = await invokeRequest(sdkServer, 'tools/call', {
      name: 'search_cards',
      arguments: {
        query: 'Lightning Bolt',
        order: 'name',
        limit: 1,
      },
    });

    const response = validResult as { content: Array<{ text: string }>; isError?: boolean };
    expect(response.isError).toBeUndefined();
    expect(response.content[0].text).toContain('Lightning Bolt');
    expect(mockScryfallClient.searchCards).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'Lightning Bolt',
        order: 'name',
      })
    );
  });

  it('executes the rules lookup tool through the server layer', async () => {
    const result = await invokeRequest(sdkServer, 'tools/call', {
      name: 'query_rules',
      arguments: {
        query: 'state-based actions',
        context_lines: 1,
      },
    });

    const response = result as { content: Array<{ text: string }>; isError?: boolean };
    expect(response.isError).toBeUndefined();
    expect(response.content[0].text).toContain('Found');
    expect(response.content[0].text).toContain('state-based actions');
    expect(response.content[0].text).toContain('704. State-Based Actions');
  });

  it('executes a recommendation-oriented tool through the server layer', async () => {
    const result = await invokeRequest(sdkServer, 'tools/call', {
      name: 'suggest_mana_base',
      arguments: {
        color_requirements: 'WU',
        deck_size: 60,
        format: 'modern',
        strategy: 'control',
        budget: 'moderate',
      },
    });

    const response = result as { content: Array<{ text: string }>; isError?: boolean };
    expect(response.isError).toBeUndefined();
    expect(response.content[0].text).toContain('**Mana Base Suggestion**');
    expect(response.content[0].text).toContain('• Colors: WU');
    expect(response.content[0].text).toContain('🌈 **Dual Lands:**');
  });
});
