import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GetCardRulingsTool } from '../src/tools/get-card-rulings.js';
import { ScryfallClient } from '../src/services/scryfall-client.js';

/**
 * Real-network tests for GetCardRulingsTool -- deliberately in their own file
 * so they aren't caught by tools.test.ts's `vi.mock('../src/services/
 * scryfall-client.js')` (that mock is file-scoped, but would silently turn
 * `new ScryfallClient()` into a mock instance too if these lived there).
 *
 * No mocked client, no fabricated ruling data: a mock only proves the
 * formatter does what we told it to do with data we made up ourselves, not
 * that the real integration (identifier resolution -> rulings_uri -> rulings
 * text) actually works against Scryfall's real API responses. These hit
 * https://api.scryfall.com for real, so they need network access and are
 * slower / less deterministic than the rest of the suite by nature --
 * expected trade-off for genuine end-to-end confidence in this one tool.
 */
describe('GetCardRulingsTool (live Scryfall API)', () => {
  // Real network calls, some behind Scryfall's own rate limiter (500ms
  // minimum between /cards/named lookups) -- longer than vitest's 5s default.
  const REAL_API_TIMEOUT = 15000;

  let client: ScryfallClient;
  let tool: GetCardRulingsTool;

  beforeEach(() => {
    client = new ScryfallClient();
    tool = new GetCardRulingsTool(client);
  });

  afterEach(() => {
    client.destroy();
  });

  it(
    'returns real rulings for a card known to have them',
    async () => {
      // Doubling Season -- verified against the live API (2026-09-03) to
      // currently carry 5 real WotC rulings on its default (fuzzy-matched)
      // printing. Not Lightning Bolt: checked first, and its own
      // fuzzy-matched printing's rulings_uri is genuinely empty on the real
      // API right now -- a good example of why this file exists instead of
      // asserting against an assumption.
      const result = await tool.execute({ identifier: 'Doubling Season' });
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('Official rulings for Doubling Season:');
      expect(result.content[0].text).toMatch(/-\s*\(\d{4}-\d{2}-\d{2}\)/);
    },
    REAL_API_TIMEOUT
  );

  it(
    'reports when a real card has no rulings',
    async () => {
      // Grizzly Bears is a plain vanilla 2/2 -- verified against the live API
      // (2026-09-03) to currently have zero rulings. If Wizards ever gives it
      // one, this test failing is the correct signal to pick a new card, not
      // a bug in get-card-rulings.ts.
      const result = await tool.execute({ identifier: 'Grizzly Bears' });
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('No official rulings found');
    },
    REAL_API_TIMEOUT
  );

  it(
    'surfaces a real 404 as a card-not-found message',
    async () => {
      const result = await tool.execute({
        identifier: 'Zzxxqqvvnonexistentcardnamezzz123'
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Card not found');
    },
    REAL_API_TIMEOUT
  );
});
