// Scryfall API Response Types
export interface ScryfallCard {
  object: 'card';
  id: string;
  oracle_id?: string;
  multiverse_ids?: number[];
  mtgo_id?: number;
  mtgo_foil_id?: number;
  tcgplayer_id?: number;
  cardmarket_id?: number;
  name: string;
  lang: string;
  released_at: string;
  uri: string;
  scryfall_uri: string;
  layout: CardLayout;
  highres_image: boolean;
  image_status: ImageStatus;
  image_uris?: ImageUris;
  mana_cost?: string;
  cmc: number;
  type_line: string;
  oracle_text?: string;
  power?: string;
  toughness?: string;
  colors?: Color[];
  color_identity: Color[];
  keywords: string[];
  legalities: Legalities;
  games: Game[];
  reserved: boolean;
  foil: boolean;
  nonfoil: boolean;
  finishes: Finish[];
  oversized: boolean;
  promo: boolean;
  reprint: boolean;
  variation: boolean;
  set_id: string;
  set: string;
  set_name: string;
  set_type: string;
  set_uri: string;
  set_search_uri: string;
  scryfall_set_uri: string;
  rulings_uri: string;
  prints_search_uri: string;
  collector_number: string;
  digital: boolean;
  rarity: Rarity;
  card_back_id?: string;
  artist?: string;
  artist_ids?: string[];
  illustration_id?: string;
  border_color: BorderColor;
  frame: string;
  frame_effects?: FrameEffect[];
  full_art: boolean;
  textless: boolean;
  booster: boolean;
  story_spotlight: boolean;
  edhrec_rank?: number;
  penny_rank?: number;
  prices: Prices;
  related_uris: RelatedUris;
  purchase_uris?: PurchaseUris;
  // Multi-faced card properties
  card_faces?: CardFace[];
  // Transform/Modal DFC properties
  all_parts?: RelatedCard[];
  // Preview properties
  preview?: Preview;
}

export interface CardFace {
  object: 'card_face';
  name: string;
  mana_cost?: string;
  type_line: string;
  oracle_text?: string;
  colors?: Color[];
  color_indicator?: Color[];
  power?: string;
  toughness?: string;
  loyalty?: string;
  illustration_id?: string;
  image_uris?: ImageUris;
  artist?: string;
  artist_id?: string;
}

export interface ImageUris {
  small: string;
  normal: string;
  large: string;
  png: string;
  art_crop: string;
  border_crop: string;
}

export interface Legalities {
  standard: Legality;
  future: Legality;
  historic: Legality;
  timeless: Legality;
  gladiator: Legality;
  pioneer: Legality;
  modern: Legality;
  legacy: Legality;
  pauper: Legality;
  vintage: Legality;
  penny: Legality;
  commander: Legality;
  oathbreaker: Legality;
  standardbrawl: Legality;
  brawl: Legality;
  competitivebrawl: Legality;
  tlr: Legality;
  alchemy: Legality;
  paupercommander: Legality;
  duel: Legality;
  oldschool: Legality;
  premodern: Legality;
  predh: Legality;
}

export interface Prices {
  usd?: string;
  usd_foil?: string;
  usd_etched?: string;
  eur?: string;
  eur_foil?: string;
  tix?: string;
}

export interface RelatedUris {
  gatherer?: string;
  tcgplayer_infinite_articles?: string;
  tcgplayer_infinite_decks?: string;
  edhrec?: string;
}

export interface PurchaseUris {
  tcgplayer?: string;
  cardmarket?: string;
  cardhoarder?: string;
}

export interface RelatedCard {
  object: 'related_card';
  id: string;
  component: Component;
  name: string;
  type_line: string;
  uri: string;
}

export interface Preview {
  source: string;
  source_uri: string;
  previewed_at: string;
}

// Search Response Types
export interface ScryfallSearchResponse {
  object: 'list';
  total_cards?: number;
  has_more: boolean;
  next_page?: string;
  data: ScryfallCard[];
  warnings?: string[];
}

// Set Types
export interface ScryfallSet {
  object: 'set';
  id: string;
  code: string;
  mtgo_code?: string;
  arena_code?: string;
  tcgplayer_id?: number;
  name: string;
  set_type: SetType;
  released_at?: string;
  block_code?: string;
  block?: string;
  parent_set_code?: string;
  card_count: number;
  printed_size?: number;
  digital: boolean;
  foil_only: boolean;
  nonfoil_only: boolean;
  scryfall_uri: string;
  uri: string;
  icon_svg_uri: string;
  search_uri: string;
}

// Enums and Union Types
export type CardLayout = 
  | 'normal' | 'split' | 'flip' | 'transform' | 'modal_dfc' | 'meld' 
  | 'leveler' | 'class' | 'case' | 'saga' | 'adventure' | 'mutate' 
  | 'prototype' | 'battle' | 'planar' | 'scheme' | 'vanguard' 
  | 'token' | 'double_faced_token' | 'emblem' | 'augment' | 'host' | 'art_series' | 'reversible_card';

export type ImageStatus = 'missing' | 'placeholder' | 'lowres' | 'highres_scan';

export type Color = 'W' | 'U' | 'B' | 'R' | 'G';

export type Game = 'paper' | 'arena' | 'mtgo';

export type Finish = 'foil' | 'nonfoil' | 'etched' | 'glossy';

export type Rarity = 'common' | 'uncommon' | 'rare' | 'special' | 'mythic' | 'bonus';

export type BorderColor = 'black' | 'white' | 'borderless' | 'silver' | 'gold';

export type FrameEffect = 
  | 'legendary' | 'miracle' | 'nyxtouched' | 'draft' | 'devoid' | 'tombstone' 
  | 'colorshifted' | 'inverted' | 'sunmoondfc' | 'compasslanddfc' | 'originpwdfc' 
  | 'mooneldrazidfc' | 'waxingandwaningmoondfc' | 'showcase' | 'extendedart' 
  | 'companion' | 'etched' | 'snow' | 'lesson' | 'shatteredglass' | 'convertdfc' 
  | 'fandfc' | 'upsidedowndfc';

export type Legality = 'legal' | 'not_legal' | 'restricted' | 'banned';

export type Component = 'token' | 'meld_part' | 'meld_result' | 'combo_piece';

export type SetType = 
  | 'core' | 'expansion' | 'masters' | 'alchemy' | 'masterpiece' | 'arsenal' 
  | 'from_the_vault' | 'spellbook' | 'premium_deck' | 'duel_deck' | 'draft_innovation' 
  | 'treasure_chest' | 'commander' | 'planechase' | 'archenemy' | 'vanguard' 
  | 'funny' | 'starter' | 'box' | 'promo' | 'token' | 'memorabilia' | 'minigame'
  | 'eternal';

// Array of all set types for use in tool schemas
export const SET_TYPES = [
  'core', 'expansion', 'masters', 'alchemy', 'masterpiece', 'arsenal',
  'from_the_vault', 'spellbook', 'premium_deck', 'duel_deck', 'draft_innovation',
  'treasure_chest', 'commander', 'planechase', 'archenemy', 'vanguard',
  'funny', 'starter', 'box', 'promo', 'token', 'memorabilia', 'minigame', 'eternal'
] as const satisfies readonly SetType[];

// Error Response Types
export interface ScryfallError {
  object: 'error';
  code: string;
  status: number;
  warnings?: string[];
  details: string;
}

// Bulk Data Types
export interface BulkDataInfo {
  object: 'bulk_data';
  id: string;
  type: BulkDataType;
  updated_at: string;
  uri: string;
  name: string;
  description: string;
  size: number;
  download_uri: string;
  content_type: string;
  content_encoding: string;
}

export type BulkDataType = 
  | 'oracle_cards' | 'unique_artwork' | 'default_cards' | 'all_cards' | 'rulings';

// Magic: The Gathering Formats (derived from Legalities interface)
export type MagicFormat = keyof Legalities;

// Generic List Response
export interface ScryfallListResponse<T> {
  object: 'list';
  data: T[];
  has_more?: boolean;
  next_page?: string;
  total_cards?: number;
  warnings?: string[];
}

// https://scryfall.com/docs/api/rulings
export interface ScryfallRuling {
  object: 'ruling';
  oracle_id: string;
  source: 'wotc' | 'scryfall';
  published_at: string;
  comment: string;
}
