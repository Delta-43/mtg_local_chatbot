import { describe, expect, it } from 'vitest';

describe('HTTP smoke SSE parser', () => {
  it('parses the expected Streamable HTTP SSE message frame', async () => {
    const { parseSseMessage } = await import('../scripts/http-mcp-smoke-lib.mjs');

    expect(parseSseMessage('event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n\n')).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: { ok: true },
    });
  });

  it('rejects malformed SSE frames without a message event', async () => {
    const { parseSseMessage } = await import('../scripts/http-mcp-smoke-lib.mjs');

    expect(() => parseSseMessage('data: {"jsonrpc":"2.0"}\n\n')).toThrow(
      'Expected SSE event "message", got none'
    );
  });
});
