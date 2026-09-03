import { describe, expect, it } from 'vitest';
import { calculateLandCount } from '../src/tools/suggest-mana-base/planner.js';
import { SuggestManaBaseTool } from '../src/tools/suggest-mana-base.js';

describe('calculateLandCount for Brawl', () => {
  it('recommends Commander-like land counts for 100-card Historic Brawl', () => {
    expect(calculateLandCount({
      color_requirements: 'UR',
      deck_size: 100,
      format: 'brawl',
      strategy: 'combo',
      average_cmc: 2.7,
      budget: 'no_limit',
      special_requirements: [],
    })).toBe(38);
  });

  it('keeps Standard Brawl near 24 lands for 60-card decks', () => {
    expect(calculateLandCount({
      color_requirements: 'UR',
      deck_size: 60,
      format: 'standardbrawl',
      strategy: 'midrange',
      average_cmc: 3,
      budget: 'moderate',
      special_requirements: [],
    })).toBe(24);
  });
});

describe('SuggestManaBaseTool validation', () => {
  const tool = new SuggestManaBaseTool();

  it('rejects deck_size of 0 instead of falling back to default', async () => {
    const result = await tool.execute({
      color_requirements: 'WU',
      deck_size: 0
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Deck size must be between 40 and 250');
  });

  it('rejects average_cmc values outside schema bounds', async () => {
    const result = await tool.execute({
      color_requirements: 'WU',
      average_cmc: 11
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Average CMC must be between 0 and 10');
  });

  it('rejects out-of-range color_intensity values', async () => {
    const result = await tool.execute({
      color_requirements: 'WU',
      color_intensity: { W: 11 }
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Color intensity for W must be between 0 and 10');
  });
});
