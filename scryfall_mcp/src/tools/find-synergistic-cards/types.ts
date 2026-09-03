import { ScryfallCard } from '../../types/scryfall-api.js';

export interface FindSynergisticCardsInput {
  focus_card: string;
  synergy_type?: string;
  format?: string;
  exclude_colors?: string;
  max_cmc?: number;
  include_lands?: boolean;
  limit?: number;
  arena_only?: boolean;
  color_identity?: string;
}

export interface SynergyParams {
  focus_card: string;
  synergy_type?: string;
  format?: string;
  exclude_colors?: string;
  max_cmc?: number;
  include_lands: boolean;
  limit: number;
  arena_only: boolean;
  color_identity?: string;
}

export type SynergyLayer = 'semantic' | 'exact' | 'thematic';

export type SynergyCard = ScryfallCard & {
  _synergy_layer?: SynergyLayer;
  _synergy_query?: string;
};
