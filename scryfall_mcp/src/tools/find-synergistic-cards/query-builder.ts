import { ScryfallCard } from '../../types/scryfall-api.js';
import { SynergyParams } from './types.js';

function extractCreatureTypes(typeLine: string): string[] {
  const commonTypes = [
    'human', 'elf', 'goblin', 'zombie', 'spirit', 'angel', 'demon', 'dragon',
    'wizard', 'warrior', 'knight', 'soldier', 'beast', 'elemental', 'vampire',
    'merfolk', 'pirate', 'dinosaur', 'cat', 'bird', 'horror', 'construct',
    'artifact', 'enchantment', 'planeswalker', 'giant', 'dwarf', 'troll',
    'ogre', 'orc', 'minotaur', 'centaur', 'sphinx', 'hydra', 'phoenix'
  ];

  return commonTypes.filter(type => typeLine.includes(type));
}

function extractKeywords(oracleText: string): string[] {
  const keywords = [
    'flying', 'trample', 'haste', 'vigilance', 'lifelink', 'deathtouch',
    'first strike', 'double strike', 'hexproof', 'indestructible',
    'flash', 'prowess', 'menace', 'reach', 'defender', 'ward', 'protection',
    'shroud', 'fear', 'intimidate', 'landwalk', 'horsemanship', 'shadow',
    'banding', 'rampage', 'bushido', 'ninjutsu', 'splice', 'affinity',
    'convoke', 'delve', 'emerge', 'improvise', 'undaunted'
  ];

  return keywords.filter(keyword => oracleText.includes(keyword));
}

function extractMechanics(oracleText: string): string[] {
  const mechanics = [
    'proliferate', 'scry', 'surveil', 'explore', 'adapt', 'amass',
    'convoke', 'delve', 'emerge', 'escape', 'flashback', 'madness',
    'morph', 'suspend', 'unearth', 'cycling', 'kicker', 'multikicker',
    'cascade', 'storm', 'dredge', 'buyback', 'echo', 'evoke',
    'splice', 'ripple', 'rebound', 'retrace', 'overload', 'cipher',
    'populate', 'scavenge', 'unleash', 'detain', 'extort', 'evolve',
    'bloodrush', 'battalion', 'devotion', 'inspired', 'tribute',
    'dash', 'exploit', 'manifest', 'bolster', 'support', 'surge',
    'awaken', 'devoid', 'ingest', 'myriad', 'crew', 'fabricate',
    'energy', 'revolt', 'improvise', 'aftermath', 'embalm', 'eternalize',
    'afflict', 'exert', 'explore', 'enrage', 'raid', 'ascend',
    'assist', 'jump-start', 'mentor', 'undergrowth', 'spectacle',
    'riot', 'addendum', 'afterlife', 'amass', 'proliferate', 'adapt',
    'escape', 'mutate', 'companion', 'cycling', 'keyword counter',
    'foretell', 'boast', 'disturb', 'daybound', 'nightbound',
    'cleave', 'training', 'channel', 'ninjutsu', 'reconfigure',
    'compleated', 'casualty', 'connive', 'hideaway', 'blitz',
    'prototype', 'unearth', 'powerstone', 'enlist', 'domain',
    'kicker', 'toxic', 'corrupted', 'backup', 'bargain', 'craft'
  ];

  const foundMechanics: string[] = [];

  for (const mechanic of mechanics) {
    const regex = new RegExp(`\\b${mechanic}(?:\\s|\\d|$)`, 'i');
    if (regex.test(oracleText)) {
      foundMechanics.push(mechanic);
    }
  }

  const mechanicPatterns = [
    { pattern: /\+1\/\+1 counter/i, mechanic: '+1/+1 counters' },
    { pattern: /enters the battlefield/i, mechanic: 'enters the battlefield' },
    { pattern: /leaves the battlefield/i, mechanic: 'leaves the battlefield' },
    { pattern: /sacrifice.*creature/i, mechanic: 'sacrifice creatures' },
    { pattern: /whenever.*dies/i, mechanic: 'death triggers' },
    { pattern: /whenever.*attacks/i, mechanic: 'attack triggers' },
    { pattern: /whenever.*deals damage/i, mechanic: 'damage triggers' },
    { pattern: /whenever you cast/i, mechanic: 'spell triggers' },
    { pattern: /draw.*cards?/i, mechanic: 'card draw' },
    { pattern: /discard.*cards?/i, mechanic: 'discard' },
    { pattern: /mill.*cards?/i, mechanic: 'mill' },
    { pattern: /create.*token/i, mechanic: 'token creation' },
    { pattern: /return.*from.*graveyard/i, mechanic: 'graveyard recursion' },
    { pattern: /costs.*less/i, mechanic: 'cost reduction' },
    { pattern: /add.*mana/i, mechanic: 'mana generation' },
    { pattern: /destroy target/i, mechanic: 'destruction' },
    { pattern: /exile.*until/i, mechanic: 'temporary exile' },
    { pattern: /double.*damage/i, mechanic: 'damage doubling' },
    { pattern: /prevent.*damage/i, mechanic: 'damage prevention' },
    { pattern: /can't be blocked/i, mechanic: 'evasion' },
    { pattern: /flying/i, mechanic: 'flying' },
    { pattern: /trample/i, mechanic: 'trample' },
    { pattern: /haste/i, mechanic: 'haste' },
    { pattern: /vigilance/i, mechanic: 'vigilance' },
    { pattern: /lifelink/i, mechanic: 'lifelink' },
    { pattern: /deathtouch/i, mechanic: 'deathtouch' },
    { pattern: /first strike/i, mechanic: 'first strike' },
    { pattern: /double strike/i, mechanic: 'double strike' },
    { pattern: /hexproof/i, mechanic: 'hexproof' },
    { pattern: /indestructible/i, mechanic: 'indestructible' },
    { pattern: /flash/i, mechanic: 'flash' },
    { pattern: /prowess/i, mechanic: 'prowess' },
    { pattern: /menace/i, mechanic: 'menace' },
    { pattern: /reach/i, mechanic: 'reach' },
    { pattern: /defender/i, mechanic: 'defender' },
    { pattern: /ward/i, mechanic: 'ward' }
  ];

  for (const { pattern, mechanic } of mechanicPatterns) {
    if (pattern.test(oracleText) && !foundMechanics.includes(mechanic)) {
      foundMechanics.push(mechanic);
    }
  }

  return foundMechanics;
}

function getColorName(colorCode: string): string {
  const colorMap: Record<string, string> = {
    W: 'white',
    U: 'blue',
    B: 'black',
    R: 'red',
    G: 'green'
  };

  return colorMap[colorCode.toUpperCase()] || colorCode;
}

export function normalizeColorIdentity(value: string | undefined): string | undefined {
  if (!value?.trim()) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  const namedIdentities: Record<string, string> = {
    white: 'w',
    blue: 'u',
    black: 'b',
    red: 'r',
    green: 'g',
    azorius: 'wu',
    dimir: 'ub',
    rakdos: 'br',
    gruul: 'rg',
    selesnya: 'gw',
    orzhov: 'wb',
    izzet: 'ur',
    golgari: 'bg',
    boros: 'rw',
    simic: 'gu',
    esper: 'wub',
    grixis: 'ubr',
    jund: 'brg',
    naya: 'rgw',
    bant: 'gwu',
    abzan: 'wbg',
    jeskai: 'urw',
    sultai: 'bgu',
    mardu: 'rwb',
    temur: 'gur',
  };

  const colors = new Set<string>();
  const words = normalized.split(/[^a-z]+/).filter(Boolean);
  for (const word of words) {
    const named = namedIdentities[word];
    if (named) {
      for (const color of named) {
        colors.add(color);
      }
      continue;
    }

    if (/^[wubrg]+$/.test(word)) {
      for (const color of word) {
        colors.add(color);
      }
    }
  }

  if (colors.size === 0 && /^[wubrg\s,]+$/i.test(value)) {
    for (const color of normalized) {
      if ('wubrg'.includes(color)) {
        colors.add(color);
      }
    }
  }

  return colors.size > 0
    ? [...colors].sort((a, b) => 'wubrg'.indexOf(a) - 'wubrg'.indexOf(b)).join('')
    : undefined;
}

function getCardColorIdentity(card: ScryfallCard): string | undefined {
  return normalizeColorIdentity((card.color_identity || []).join(''));
}

function getSemanticSynergies(focusCard: ScryfallCard, baseQuery: string): string[] {
  const queries: string[] = [];
  const oracleText = focusCard.oracle_text?.toLowerCase() || '';
  const name = focusCard.name.toLowerCase();

  const synergyPatterns = [
    {
      triggers: ['extra upkeep', 'additional upkeep', 'extra turn', 'additional turn', 'upkeep step'],
      synergizes_with: ['beginning of your upkeep', 'at the beginning of your upkeep', 'during your upkeep']
    },
    {
      triggers: ['extra combat', 'additional combat', 'extra attack', 'additional attack phase'],
      synergizes_with: ['whenever ~ attacks', 'whenever ~ deals combat damage', 'combat damage to a player']
    },
    {
      triggers: ['extra end step', 'additional end step', 'end step'],
      synergizes_with: ['at the beginning of your end step', 'at the beginning of the end step']
    },
    {
      triggers: ['create.*token', 'token.*creature', 'populate', 'amass'],
      synergizes_with: ['whenever a creature enters', 'creature tokens you control', 'token creatures', 'creatures you control']
    },
    {
      triggers: ['enters the battlefield', 'enters tapped', 'when.*enters'],
      synergizes_with: ['whenever a creature enters', 'whenever.*enters the battlefield', 'creature entering']
    },
    {
      triggers: ['leaves the battlefield', 'dies', 'when.*dies'],
      synergizes_with: ['whenever a creature dies', 'whenever.*leaves the battlefield', 'creature dying']
    },
    {
      triggers: ['whenever you cast', 'instant or sorcery', 'noncreature spell'],
      synergizes_with: ['prowess', 'magecraft', 'whenever you cast an instant or sorcery']
    },
    {
      triggers: ['sacrifice', 'sacrificed', 'sacrifice.*creature'],
      synergizes_with: ['whenever.*is sacrificed', 'sacrifice.*creature', 'aristocrats']
    },
    {
      triggers: ['you gain life', 'whenever you gain life', 'lifelink'],
      synergizes_with: ['whenever you gain life', 'lifegain', 'lifelink']
    },
    {
      triggers: ['draw.*card', 'whenever you draw', 'card draw'],
      synergizes_with: ['whenever you draw', 'draw additional', 'card advantage']
    },
    {
      triggers: ['add.*mana', 'mana.*to your mana pool', 'treasure', 'ritual'],
      synergizes_with: ['x spell', 'costs.*less', 'mana value', 'expensive spell']
    },
    {
      triggers: ['enters your graveyard', 'creature.*graveyard', 'mill'],
      synergizes_with: ['from your graveyard', 'graveyard.*battlefield', 'flashback', 'unearth']
    },
    {
      triggers: ['\\+1/\\+1 counter', 'put.*counter', 'counter.*creature'],
      synergizes_with: ['\\+1/\\+1 counter', 'proliferate', 'counter.*creature', 'adapt', 'evolve']
    }
  ];

  for (const pattern of synergyPatterns) {
    const matchesTrigger = pattern.triggers.some(trigger =>
      new RegExp(trigger, 'i').test(oracleText) || new RegExp(trigger, 'i').test(name)
    );

    if (matchesTrigger) {
      for (const synergy of pattern.synergizes_with) {
        queries.push(`${baseQuery}o:"${synergy}"`);
      }
    }
  }

  if (name.includes('obeka')) {
    queries.push(`${baseQuery}o:"beginning of your upkeep"`);
    queries.push(`${baseQuery}o:"at the beginning of your upkeep"`);
    queries.push(`${baseQuery}o:"during your upkeep"`);
    queries.push(`${baseQuery}o:"upkeep, "`);
  }

  return queries.filter(q => q.trim().length > 0);
}

function getThemeBasedSynergies(theme: string, baseQuery: string, synergyType?: string): string[] {
  const queries: string[] = [];
  const normalizedTheme = theme.toLowerCase();
  const words = normalizedTheme.split(/\s+/);

  if (normalizedTheme.includes('tribal') || synergyType === 'tribal') {
    const creatureType = words.find(word =>
      !['tribal', 'deck', 'theme', 'synergy'].includes(word)
    );
    if (creatureType) {
      queries.push(`${baseQuery}t:${creatureType}`);
      queries.push(`${baseQuery}o:"${creatureType}"`);
      queries.push(`${baseQuery}o:"${creatureType}s you control"`);
    }
  }

  if (theme.length <= 20) {
    queries.push(`${baseQuery}o:"${theme}"`);
  }

  for (const word of words) {
    if (word.length >= 4 && !['tribal', 'deck', 'theme', 'synergy', 'cards'].includes(word)) {
      queries.push(`${baseQuery}o:"${word}"`);
      queries.push(`${baseQuery}t:"${word}"`);
    }
  }

  if (normalizedTheme.includes('counter')) {
    queries.push(`${baseQuery}(o:"counter" OR o:"+1/+1" OR o:"proliferate")`);
  }

  if (normalizedTheme.includes('artifact')) {
    queries.push(`${baseQuery}t:artifact`);
    queries.push(`${baseQuery}(o:"artifact" OR o:"metalcraft" OR o:"affinity")`);
    queries.push(`${baseQuery}(o:"equipment" OR o:"attach" OR o:"equip")`);
    queries.push(`${baseQuery}(o:"construct" OR o:"golem" OR o:"thopter")`);
    queries.push(`${baseQuery}(t:"artifact creature" OR o:"fabricate")`);
  }

  if (normalizedTheme.includes('graveyard')) {
    queries.push(`${baseQuery}(o:"graveyard" OR o:"from your graveyard" OR o:"flashback" OR o:"unearth")`);
  }

  if (normalizedTheme.includes('token')) {
    queries.push(`${baseQuery}(o:"token" OR o:"create" OR o:"populate")`);
  }

  if (normalizedTheme.includes('burn') || normalizedTheme.includes('damage')) {
    queries.push(`${baseQuery}(o:"damage" OR o:"burn" OR o:"deals damage")`);
  }

  if (normalizedTheme.includes('lifegain') || normalizedTheme.includes('life')) {
    queries.push(`${baseQuery}(o:"gain life" OR o:"lifelink" OR o:"life")`);
  }

  return queries.filter(q => q.trim().length > 0);
}

function getArchetypeSynergies(focusCard: ScryfallCard, baseQuery: string): string[] {
  const queries: string[] = [];
  const oracleText = focusCard.oracle_text?.toLowerCase() || '';
  const types = focusCard.type_line?.toLowerCase() || '';
  const colors = focusCard.color_identity || [];

  if (types.includes('instant') || types.includes('sorcery')) {
    if (oracleText.includes('damage')) {
      queries.push(`${baseQuery}(o:"damage" OR o:"burn" OR o:"direct damage")`);
      queries.push(`${baseQuery}(o:"prowess" OR o:"magecraft" OR o:"whenever you cast")`);
    }
    if (oracleText.includes('counter')) {
      queries.push(`${baseQuery}(o:"counter" OR o:"counterspell")`);
    }
    if (oracleText.includes('draw')) {
      queries.push(`${baseQuery}(o:"draw" OR o:"card advantage")`);
    }
  }

  if (types.includes('creature')) {
    const power = parseInt(focusCard.power || '0', 10) || 0;
    const toughness = parseInt(focusCard.toughness || '0', 10) || 0;

    if (power >= 3 && focusCard.cmc <= 3) {
      queries.push(`${baseQuery}(o:"haste" OR o:"attack" OR o:"combat")`);
    }

    if (toughness >= 4) {
      queries.push(`${baseQuery}(o:"defender" OR o:"vigilance" OR o:"prevent")`);
    }

    if (oracleText.includes('when') || oracleText.includes('whenever')) {
      queries.push(`${baseQuery}(o:"enters" OR o:"leaves" OR o:"sacrifice")`);
    }
  }

  if (types.includes('enchantment')) {
    queries.push(`${baseQuery}(t:enchantment OR o:"enchantment")`);
    if (types.includes('aura')) {
      queries.push(`${baseQuery}(o:"attach" OR o:"equipped" OR o:"enchant")`);
    }
  }

  if (types.includes('artifact')) {
    queries.push(`${baseQuery}(t:artifact OR o:"artifact" OR o:"metalcraft")`);
  }

  if (colors.length === 1) {
    const color = colors[0];
    queries.push(`${baseQuery}(c:${color.toLowerCase()} OR o:"${getColorName(color)}")`);
  }

  return queries;
}

function buildOracleBaseQuery(card: ScryfallCard, baseQuery: string): string {
  const trimmedBaseQuery = baseQuery.trim();

  return trimmedBaseQuery;
}

function buildOracleDerivedQueries(card: ScryfallCard, baseQuery: string): string[] {
  const oracle = card.oracle_text?.toLowerCase() ?? '';
  const typeLine = card.type_line?.toLowerCase() ?? '';
  const queryBase = buildOracleBaseQuery(card, baseQuery);
  const prefix = queryBase ? `${queryBase} ` : '';
  const queries: string[] = [];

  if (oracle.includes('instant or sorcery')) {
    queries.push(`${prefix}o:"instant or sorcery"`);
    queries.push(`${prefix}(t:instant or t:sorcery)`);
  }

  if (oracle.includes('treasure')) {
    queries.push(`${prefix}o:Treasure`);
  }

  if (typeLine.includes('goblin')) {
    queries.push(`${prefix}t:goblin`);
  }

  if (typeLine.includes('wizard') || typeLine.includes('sorcerer')) {
    queries.push(`${prefix}t:wizard`);
    queries.push(`${prefix}(t:wizard or t:sorcerer or t:warlock or t:shaman)`);
  }

  return queries;
}

export function buildBaseQuery(params: Omit<SynergyParams, 'limit'>): string {
  const queryParts: string[] = [];

  if (params.format) {
    queryParts.push(`legal:${params.format}`);
  }

  if (params.exclude_colors) {
    for (const color of params.exclude_colors.toLowerCase()) {
      if ('wubrg'.includes(color)) {
        queryParts.push(`-c:${color}`);
      }
    }
  }

  if (params.max_cmc !== undefined) {
    queryParts.push(`cmc<=${params.max_cmc}`);
  }

  if (!params.include_lands) {
    queryParts.push('-t:land');
  }

  if (params.arena_only) {
    queryParts.push('game:arena');
  }

  const colorIdentity = normalizeColorIdentity(params.color_identity);
  if (colorIdentity) {
    queryParts.push(`ci<=${colorIdentity}`);
  }

  return queryParts.length > 0 ? `${queryParts.join(' ')} ` : '';
}

export function buildSynergyQueries(
  focusCard: ScryfallCard | null,
  params: Omit<SynergyParams, 'limit'>
): string[] {
  const queries: string[] = [];
  const effectiveParams = {
    ...params,
    color_identity: params.color_identity ?? (focusCard ? getCardColorIdentity(focusCard) : undefined),
  };
  const baseQuery = buildBaseQuery(effectiveParams);

  if (focusCard) {
    queries.push(...getCardBasedSynergies(focusCard, baseQuery, params.synergy_type, params.focus_card));
    queries.push(...buildOracleDerivedQueries(focusCard, baseQuery));
  } else {
    queries.push(...getThemeBasedSynergies(params.focus_card, baseQuery, params.synergy_type));
  }

  return queries.filter(q => q.trim().length > 0);
}

function getCardBasedSynergies(
  focusCard: ScryfallCard,
  baseQuery: string,
  synergyType?: string,
  originalSearchTerm?: string
): string[] {
  const queries: string[] = [];

  if (
    synergyType === 'theme' &&
    originalSearchTerm &&
    originalSearchTerm.toLowerCase() !== focusCard.name.toLowerCase()
  ) {
    const themeQueries = getThemeBasedSynergies(originalSearchTerm, baseQuery, synergyType);
    queries.push(...themeQueries);
    return queries;
  }

  const types = focusCard.type_line.toLowerCase();
  const oracleText = focusCard.oracle_text?.toLowerCase() || '';
  const keywords = extractKeywords(oracleText);

  queries.push(...getSemanticSynergies(focusCard, baseQuery));

  if (!synergyType || synergyType === 'tribal') {
    const creatureTypes = extractCreatureTypes(types);
    for (const type of creatureTypes) {
      queries.push(`${baseQuery}(o:"${type}" OR t:"${type}")`);
    }
  }

  if (!synergyType || synergyType === 'keyword') {
    for (const keyword of keywords) {
      queries.push(`${baseQuery}o:"${keyword}"`);
    }
  }

  if (!synergyType || synergyType === 'mechanic') {
    const mechanics = extractMechanics(oracleText);
    for (const mechanic of mechanics) {
      queries.push(`${baseQuery}o:"${mechanic}"`);
    }
  }

  if (!synergyType || synergyType === 'archetype') {
    queries.push(...getArchetypeSynergies(focusCard, baseQuery));
  }

  if (synergyType === 'theme' && originalSearchTerm) {
    queries.push(...getThemeBasedSynergies(originalSearchTerm, baseQuery, synergyType));
  }

  return queries;
}

export function getFallbackQueries(theme: string, baseQuery: string): string[] {
  const queries: string[] = [];
  const normalizedTheme = theme.toLowerCase();

  const words = normalizedTheme.split(/\s+/);
  for (const word of words) {
    if (word.length >= 3) {
      queries.push(`${baseQuery}t:${word}`);
      queries.push(`${baseQuery}o:${word}`);
    }
  }

  if (normalizedTheme.includes('artifact')) {
    queries.push(`${baseQuery}t:artifact`);
    queries.push(`${baseQuery}o:"artifact"`);
    queries.push(`${baseQuery}(o:"metalcraft" OR o:"affinity" OR o:"improvise")`);
    queries.push(`${baseQuery}t:equipment`);
  }

  if (normalizedTheme.includes('enchantment')) {
    queries.push(`${baseQuery}t:enchantment`);
    queries.push(`${baseQuery}o:enchantment`);
  }

  if (normalizedTheme.includes('token')) {
    queries.push(`${baseQuery}o:token`);
    queries.push(`${baseQuery}o:create`);
  }

  return queries;
}
