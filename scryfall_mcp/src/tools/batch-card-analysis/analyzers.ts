import { Prices, ScryfallCard } from '../../types/scryfall-api.js';
import { ValidatedBatchCardAnalysisParams } from './types.js';

export const getPriceForCurrency = (prices: Prices, currency: string): string | undefined =>
  prices[currency as keyof Prices];

export function analyzeLegality(cards: ScryfallCard[], format?: ValidatedBatchCardAnalysisParams['format']): string {
  let result = `# Legality Analysis\n\n`;
  result += `**Total Cards:** ${cards.length}\n\n`;

  if (format) {
    let legalCount = 0;
    let bannedCount = 0;
    let restrictedCount = 0;
    let notLegalCount = 0;
    const bannedCards: ScryfallCard[] = [];
    const restrictedCards: ScryfallCard[] = [];

    for (const card of cards) {
      const legality = card.legalities[format];
      if (legality === 'legal') {
        legalCount += 1;
      } else if (legality === 'banned') {
        bannedCount += 1;
        bannedCards.push(card);
      } else if (legality === 'restricted') {
        restrictedCount += 1;
        restrictedCards.push(card);
      } else {
        notLegalCount += 1;
      }
    }

    result += `**${format.toUpperCase()} Legality:**\n`;
    result += `- Legal: ${legalCount} cards\n`;
    result += `- Banned: ${bannedCount} cards\n`;
    result += `- Restricted: ${restrictedCount} cards\n`;
    result += `- Not Legal: ${notLegalCount} cards\n\n`;

    if (bannedCards.length > 0) {
      result += `**Banned Cards:**\n`;
      bannedCards.forEach(card => { result += `- ${card.name}\n`; });
      result += '\n';
    }

    if (restrictedCards.length > 0) {
      result += `**Restricted Cards:**\n`;
      restrictedCards.forEach(card => { result += `- ${card.name}\n`; });
      result += '\n';
    }
  } else {
    const formats: NonNullable<ValidatedBatchCardAnalysisParams['format']>[] = [
      'standard', 'modern', 'legacy', 'vintage', 'commander', 'pioneer'
    ];
    const legalCounts = new Map<NonNullable<ValidatedBatchCardAnalysisParams['format']>, number>(
      formats.map(fmt => [fmt, 0])
    );

    for (const card of cards) {
      for (const fmt of formats) {
        if (card.legalities[fmt] === 'legal') {
          legalCounts.set(fmt, (legalCounts.get(fmt) || 0) + 1);
        }
      }
    }

    result += `**Format Legality Summary:**\n`;

    for (const fmt of formats) {
      result += `- ${fmt.charAt(0).toUpperCase() + fmt.slice(1)}: ${legalCounts.get(fmt) || 0}/${cards.length} legal\n`;
    }
  }

  return result;
}

export function analyzePrices(cards: ScryfallCard[], currency: string): string {
  let result = `# Price Analysis (${currency.toUpperCase()})\n\n`;

  const pricedCards: Array<{ card: ScryfallCard; price: number; priceLabel: string }> = [];
  let totalValue = 0;
  let minPrice = Number.POSITIVE_INFINITY;
  let maxPrice = Number.NEGATIVE_INFINITY;
  let expensiveCount = 0;
  let moderateCount = 0;
  let budgetCount = 0;

  for (const card of cards) {
    const priceLabel = getPriceForCurrency(card.prices, currency);
    if (!priceLabel) {
      continue;
    }

    const price = parseFloat(priceLabel);
    if (Number.isNaN(price)) {
      continue;
    }

    pricedCards.push({ card, price, priceLabel });
    totalValue += price;
    minPrice = Math.min(minPrice, price);
    maxPrice = Math.max(maxPrice, price);

    if (price >= 10) {
      expensiveCount += 1;
    } else if (price >= 1) {
      moderateCount += 1;
    } else {
      budgetCount += 1;
    }
  }

  if (pricedCards.length === 0) {
    return result + 'No price data available for the specified currency.\n';
  }

  const averagePrice = totalValue / pricedCards.length;

  result += `**Summary:**\n`;
  result += `- Total Value: ${currency.toUpperCase()} ${totalValue.toFixed(2)}\n`;
  result += `- Average Price: ${currency.toUpperCase()} ${averagePrice.toFixed(2)}\n`;
  result += `- Price Range: ${currency.toUpperCase()} ${minPrice.toFixed(2)} - ${currency.toUpperCase()} ${maxPrice.toFixed(2)}\n`;
  result += `- Cards with Prices: ${pricedCards.length}/${cards.length}\n\n`;

  result += `**Price Categories:**\n`;
  result += `- Expensive (≥$10): ${expensiveCount} cards\n`;
  result += `- Moderate ($1-$10): ${moderateCount} cards\n`;
  result += `- Budget (<$1): ${budgetCount} cards\n\n`;

  if (expensiveCount > 0) {
    result += `**Most Expensive Cards:**\n`;
    pricedCards
      .filter(entry => entry.price >= 10)
      .sort((a, b) => b.price - a.price)
      .slice(0, 5)
      .forEach(({ card, priceLabel }) => {
        result += `- ${card.name}: ${currency.toUpperCase()} ${priceLabel}\n`;
      });
  }

  return result;
}

export function analyzeSynergy(cards: ScryfallCard[]): string {
  let result = `# Synergy Analysis\n\n`;

  const types = new Map<string, number>();
  const keywords = new Map<string, number>();
  const mechanics = new Map<string, number>();

  cards.forEach(card => {
    const cardTypes = card.type_line.toLowerCase().split(/[\s—]+/);
    cardTypes.forEach(type => {
      if (type && type !== '—') {
        types.set(type, (types.get(type) || 0) + 1);
      }
    });

    if (card.oracle_text) {
      const text = card.oracle_text.toLowerCase();
      const keywordList = ['flying', 'trample', 'haste', 'vigilance', 'lifelink', 'deathtouch', 'first strike', 'double strike'];
      keywordList.forEach(keyword => {
        if (text.includes(keyword)) {
          keywords.set(keyword, (keywords.get(keyword) || 0) + 1);
        }
      });

      const mechanicList = ['proliferate', 'scry', 'surveil', 'explore', 'convoke', 'delve'];
      mechanicList.forEach(mechanic => {
        if (text.includes(mechanic)) {
          mechanics.set(mechanic, (mechanics.get(mechanic) || 0) + 1);
        }
      });
    }
  });

  result += `**Common Types:**\n`;
  Array.from(types.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([type, count]) => {
      result += `- ${type.charAt(0).toUpperCase() + type.slice(1)}: ${count} cards\n`;
    });

  if (keywords.size > 0) {
    result += `\n**Common Keywords:**\n`;
    Array.from(keywords.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .forEach(([keyword, count]) => {
        result += `- ${keyword.charAt(0).toUpperCase() + keyword.slice(1)}: ${count} cards\n`;
      });
  }

  if (mechanics.size > 0) {
    result += `\n**Common Mechanics:**\n`;
    Array.from(mechanics.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .forEach(([mechanic, count]) => {
        result += `- ${mechanic.charAt(0).toUpperCase() + mechanic.slice(1)}: ${count} cards\n`;
      });
  }

  return result;
}

export function analyzeComposition(cards: ScryfallCard[]): string {
  let result = `# Composition Analysis\n\n`;
  result += `**Total Cards:** ${cards.length}\n\n`;

  const manaCurve = new Map<number, number>();
  cards.forEach(card => {
    const cmc = card.cmc || 0;
    manaCurve.set(cmc, (manaCurve.get(cmc) || 0) + 1);
  });

  result += `**Mana Curve:**\n`;
  for (let i = 0; i <= 10; i++) {
    const count = manaCurve.get(i) || 0;
    if (count > 0 || i <= 7) {
      result += `- ${i}${i >= 7 ? '+' : ''}: ${count} cards\n`;
    }
  }

  const colors = new Map<string, number>();
  const colorIdentity = new Map<string, number>();

  cards.forEach(card => {
    if (card.mana_cost) {
      const colorMatches = card.mana_cost.match(/[WUBRG]/g) || [];
      colorMatches.forEach(color => {
        colors.set(color, (colors.get(color) || 0) + 1);
      });
    }

    if (card.color_identity && card.color_identity.length > 0) {
      const identity = [...card.color_identity].sort().join('');
      colorIdentity.set(identity, (colorIdentity.get(identity) || 0) + 1);
    } else {
      colorIdentity.set('Colorless', (colorIdentity.get('Colorless') || 0) + 1);
    }
  });

  result += `\n**Color Distribution:**\n`;
  const colorNames = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' };
  Object.entries(colorNames).forEach(([symbol, name]) => {
    const count = colors.get(symbol) || 0;
    result += `- ${name}: ${count} symbols\n`;
  });

  result += `\n**Color Identity:**\n`;
  Array.from(colorIdentity.entries())
    .sort((a, b) => b[1] - a[1])
    .forEach(([identity, count]) => {
      result += `- ${identity || 'Colorless'}: ${count} cards\n`;
    });

  return result;
}

export function analyzeComprehensive(
  cards: ScryfallCard[],
  params: ValidatedBatchCardAnalysisParams
): string {
  let result = `# Comprehensive Analysis\n\n`;
  result += analyzeLegality(cards, params.format);
  result += '\n---\n\n';
  result += analyzePrices(cards, params.currency);
  result += '\n---\n\n';
  result += analyzeComposition(cards);
  result += '\n---\n\n';
  result += analyzeSynergy(cards);
  return result;
}

export function generateSuggestions(
  cards: ScryfallCard[],
  params: ValidatedBatchCardAnalysisParams
): string {
  let suggestions = `\n\n# Suggestions\n\n`;

  if (params.format) {
    const illegal = cards.filter(card => card.legalities[params.format!] !== 'legal');
    if (illegal.length > 0) {
      suggestions += `**Format Compliance:**\n`;
      suggestions += `- Consider replacing ${illegal.length} cards that are not legal in ${params.format}\n`;
    }
  }

  const expensiveCards = cards.filter(card => {
    const price = parseFloat(getPriceForCurrency(card.prices, params.currency || 'usd') || '0');
    return price >= 20;
  });

  if (expensiveCards.length > 0) {
    suggestions += `**Budget Optimization:**\n`;
    suggestions += `- Consider finding alternatives for ${expensiveCards.length} expensive cards (≥$20)\n`;
  }

  const highCmc = cards.filter(card => (card.cmc || 0) >= 6).length;
  const lowCmc = cards.filter(card => (card.cmc || 0) <= 2).length;

  if (highCmc > cards.length * 0.2) {
    suggestions += `**Mana Curve:**\n`;
    suggestions += `- Consider reducing high-cost cards (${highCmc} cards with CMC ≥6)\n`;
  }

  if (lowCmc < cards.length * 0.3) {
    suggestions += `**Early Game:**\n`;
    suggestions += `- Consider adding more low-cost cards for early game presence\n`;
  }

  return suggestions;
}
