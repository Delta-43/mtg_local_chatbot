export interface SuggestManaBaseInput {
  color_requirements: string;
  deck_size?: number;
  format?: string;
  strategy?: string;
  average_cmc?: number;
  budget?: string;
  color_intensity?: Record<string, number>;
  special_requirements?: string[];
}

export interface ManaBaseParams {
  color_requirements: string;
  deck_size: number;
  format?: string;
  strategy: string;
  average_cmc?: number;
  budget: string;
  color_intensity?: Record<string, number>;
  special_requirements: string[];
}

export interface LandRecommendation {
  name: string;
  count: number;
  reason: string;
  example?: string;
}

export interface ManaBaseRecommendations {
  basics: LandRecommendation[];
  duals: LandRecommendation[];
  utility: LandRecommendation[];
  budget_alternatives: LandRecommendation[];
}

export interface DualCyclePlan {
  name: string;
  reason: string;
  example: string;
}
