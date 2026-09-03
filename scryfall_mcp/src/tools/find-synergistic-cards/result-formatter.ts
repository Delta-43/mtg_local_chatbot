import { ScryfallCard, ScryfallSearchResponse } from '../../types/scryfall-api.js';
import { SynergyCard } from './types.js';

function generateSynergyExplanation(
  card: SynergyCard,
  focusCard: ScryfallCard | null,
  focusCardName: string
): string {
  const cardOracle = card.oracle_text?.toLowerCase() || '';
  const focusOracle = focusCard?.oracle_text?.toLowerCase() || '';
  const focusName = focusCardName.toLowerCase();

  if (focusName.includes('obeka')) {
    if (cardOracle.includes('beginning of your upkeep') || cardOracle.includes('at the beginning of your upkeep')) {
      return 'Triggers during extra upkeep steps created by Obeka';
    }
  }

  if (focusOracle.includes('upkeep') || focusOracle.includes('extra turn')) {
    if (cardOracle.includes('beginning of your upkeep')) {
      return 'Benefits from extra upkeep steps';
    }
  }

  if (focusOracle.includes('combat') || focusOracle.includes('attack')) {
    if (cardOracle.includes('attacks') || cardOracle.includes('combat damage')) {
      return 'Synergizes with extra combat steps';
    }
  }

  if (focusOracle.includes('token') || focusOracle.includes('create')) {
    if (cardOracle.includes('creature enters') || cardOracle.includes('creatures you control')) {
      return 'Benefits from token generation';
    }
  }

  if (focusOracle.includes('enters the battlefield')) {
    if (cardOracle.includes('creature enters') || cardOracle.includes('enters the battlefield')) {
      return 'Creates ETB synergy chains';
    }
  }

  if (focusOracle.includes('instant') || focusOracle.includes('sorcery')) {
    if (cardOracle.includes('prowess') || cardOracle.includes('magecraft') || cardOracle.includes('whenever you cast')) {
      return 'Triggers from spell casting';
    }
  }

  if (focusOracle.includes('graveyard') || focusOracle.includes('dies')) {
    if (cardOracle.includes('graveyard') || cardOracle.includes('dies')) {
      return 'Graveyard value synergy';
    }
  }

  if (focusOracle.includes('sacrifice')) {
    if (cardOracle.includes('sacrifice') || cardOracle.includes('dies')) {
      return 'Sacrifice synergy engine';
    }
  }

  if (card._synergy_layer === 'semantic') {
    return 'Strategic synergy with focus card';
  }
  if (card._synergy_layer === 'exact') {
    return 'Mechanical synergy match';
  }
  if (card._synergy_layer === 'thematic') {
    return 'Thematic support card';
  }

  return '';
}

function formatCardWithSynergyExplanation(
  card: SynergyCard,
  focusCard: ScryfallCard | null,
  focusCardName: string
): string {
  const name = card.name;
  const manaCost = card.mana_cost || '';
  const typeLine = card.type_line || '';
  const oracleText = card.oracle_text || '';
  const prices = card.prices || {};

  let output = `• **${name}** ${manaCost}\n`;
  output += `  ${typeLine}\n`;

  const synergyExplanation = generateSynergyExplanation(card, focusCard, focusCardName);
  if (synergyExplanation) {
    output += `  💡 *${synergyExplanation}*\n`;
  }

  if (oracleText.length > 120) {
    output += `  ${oracleText.substring(0, 120)}...\n`;
  } else if (oracleText) {
    output += `  ${oracleText}\n`;
  }

  if (prices.usd) {
    output += `  💰 $${prices.usd}\n`;
  }

  output += '\n';
  return output;
}

export function formatResultsWithSynergyExplanations(
  searchResponse: ScryfallSearchResponse,
  focusCard: ScryfallCard | null,
  focusCardName: string
): string {
  let output = '';

  const resultsByLayer = {
    semantic: [] as SynergyCard[],
    exact: [] as SynergyCard[],
    thematic: [] as SynergyCard[],
  };

  for (const card of searchResponse.data as SynergyCard[]) {
    const layer = card._synergy_layer ?? 'thematic';
    resultsByLayer[layer].push(card);
  }

  if (resultsByLayer.semantic.length > 0) {
    output += '**🎯 Strategic Synergies:**\n';
    for (const card of resultsByLayer.semantic.slice(0, 8)) {
      output += formatCardWithSynergyExplanation(card, focusCard, focusCardName);
    }
    output += '\n';
  }

  if (resultsByLayer.exact.length > 0) {
    output += '**⚡ Mechanical Synergies:**\n';
    for (const card of resultsByLayer.exact.slice(0, 5)) {
      output += formatCardWithSynergyExplanation(card, focusCard, focusCardName);
    }
    output += '\n';
  }

  if (resultsByLayer.thematic.length > 0) {
    output += '**🌟 Thematic Support:**\n';
    for (const card of resultsByLayer.thematic.slice(0, 5)) {
      output += formatCardWithSynergyExplanation(card, focusCard, focusCardName);
    }
  }

  return output;
}

export function prioritizeResultsByLayer(results: SynergyCard[]): SynergyCard[] {
  const layerPriority = { semantic: 3, exact: 2, thematic: 1 };

  return results.sort((a, b) => {
    const aPriority = layerPriority[a._synergy_layer as keyof typeof layerPriority] || 0;
    const bPriority = layerPriority[b._synergy_layer as keyof typeof layerPriority] || 0;

    if (aPriority !== bPriority) {
      return bPriority - aPriority;
    }

    return (a.edhrec_rank || 999999) - (b.edhrec_rank || 999999);
  });
}

export function filterAndDeduplicateResults(
  results: SynergyCard[],
  focusCard: ScryfallCard | null,
  focusCardName: string
): SynergyCard[] {
  const seen = new Set<string>();
  const filtered: SynergyCard[] = [];
  const focusCardNameLower = focusCardName.toLowerCase();

  for (const card of results) {
    if (seen.has(card.id)) {
      continue;
    }
    seen.add(card.id);

    if (focusCard && card.id === focusCard.id) {
      continue;
    }

    if (card.name.toLowerCase() === focusCardNameLower) {
      continue;
    }

    filtered.push(card);
  }

  return filtered;
}
