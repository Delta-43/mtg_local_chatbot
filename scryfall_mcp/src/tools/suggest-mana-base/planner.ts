import {
  DualCyclePlan,
  LandRecommendation,
  ManaBaseParams,
  ManaBaseRecommendations,
} from './types.js';

const BASIC_NAMES = {
  W: 'Plains',
  U: 'Island',
  B: 'Swamp',
  R: 'Mountain',
  G: 'Forest',
} as const;

function distributeCycleCounts(
  total: number,
  cycles: DualCyclePlan[],
  maxPerCycle: number
): LandRecommendation[] {
  if (total <= 0 || cycles.length === 0) {
    return [];
  }

  const recommendations: LandRecommendation[] = [];
  let remaining = total;

  for (let index = 0; index < cycles.length; index++) {
    const cycle = cycles[index];
    const cyclesLeft = cycles.length - index;
    const count = Math.min(maxPerCycle, Math.ceil(remaining / cyclesLeft));

    if (count > 0) {
      recommendations.push({
        name: cycle.name,
        count,
        reason: cycle.reason,
        example: cycle.example,
      });
      remaining -= count;
    }
  }

  return recommendations;
}

export function calculateLandCount(params: ManaBaseParams): number {
  const { deck_size, strategy, average_cmc } = params;

  const baseRatios = {
    aggro: 0.35,
    midrange: 0.4,
    control: 0.42,
    combo: 0.38,
    ramp: 0.45,
  };

  let baseCount = Math.round(deck_size * baseRatios[strategy as keyof typeof baseRatios]);

  if (average_cmc !== undefined) {
    if (average_cmc > 4) {
      baseCount += Math.round((average_cmc - 4) * 2);
    } else if (average_cmc < 2.5) {
      baseCount -= Math.round((2.5 - average_cmc) * 2);
    }
  }

  if (params.format === 'commander' || (params.format === 'brawl' && deck_size >= 90)) {
    baseCount = Math.max(36, Math.min(40, baseCount));
  } else if (params.format === 'brawl' || params.format === 'standardbrawl') {
    baseCount = Math.max(22, Math.min(26, baseCount));
  }

  return Math.max(Math.round(deck_size * 0.3), Math.min(Math.round(deck_size * 0.5), baseCount));
}

export function calculateColorDistribution(
  params: ManaBaseParams,
  landCount: number
): Record<string, number> {
  const { color_requirements, color_intensity } = params;
  const colors = color_requirements.split('');

  if (colors.length === 1) {
    return { [colors[0]]: landCount, colorless: 0 };
  }

  const distribution: Record<string, number> = {};
  let totalIntensity = 0;

  for (const color of colors) {
    const intensity = color_intensity?.[color] || 5;
    distribution[color] = intensity;
    totalIntensity += intensity;
  }

  const reservedSlots = Math.min(Math.floor(landCount * 0.3), colors.length * 2);
  const availableSlots = landCount - reservedSlots;
  const exactAllocations = colors.map((color) => {
    const ratio = distribution[color] / totalIntensity;
    const exact = availableSlots * ratio;
    return {
      color,
      exact,
      base: Math.floor(exact),
      fraction: exact - Math.floor(exact),
    };
  });

  let assignedSlots = 0;
  for (const allocation of exactAllocations) {
    distribution[allocation.color] = allocation.base;
    assignedSlots += allocation.base;
  }

  const remainingSlots = availableSlots - assignedSlots;
  exactAllocations
    .sort((a, b) => b.fraction - a.fraction)
    .slice(0, remainingSlots)
    .forEach((allocation) => {
      distribution[allocation.color] += 1;
    });

  distribution.dual = reservedSlots;
  distribution.utility = Math.max(
    0,
    landCount - Object.values(distribution).reduce((sum, value) => sum + value, 0)
  );

  return distribution;
}

export async function generateLandRecommendations(
  params: ManaBaseParams,
  colorDistribution: Record<string, number>
): Promise<ManaBaseRecommendations> {
  const { format, budget, color_requirements, special_requirements } = params;
  const colors = color_requirements.split('');

  const recommendations: ManaBaseRecommendations = {
    basics: [],
    duals: [],
    utility: [],
    budget_alternatives: [],
  };

  for (const color of colors) {
    const count = colorDistribution[color] || 0;
    if (count > 0) {
      recommendations.basics.push({
        name: BASIC_NAMES[color as keyof typeof BASIC_NAMES],
        count,
        reason: `Primary ${color} source`,
      });
    }
  }

  if (colors.length > 1) {
    const dualCount = colorDistribution.dual || 0;

    if (budget === 'budget') {
      recommendations.budget_alternatives = distributeCycleCounts(
        dualCount,
        [
          {
            name: 'Taplands',
            reason: 'Budget-friendly fixing',
            example: 'Temple of Epiphany, Tranquil Cove',
          },
        ],
        dualCount
      );
      return recommendations;
    }

    const dualCycles: DualCyclePlan[] = [];

    if (format === 'legacy' || format === 'vintage') {
      if (budget === 'no_limit' || budget === 'expensive') {
        dualCycles.push({
          name: 'Original Dual Lands',
          reason: 'Best fixing available',
          example: `Tundra (${colors.includes('W') && colors.includes('U') ? 'W/U' : 'etc'})`,
        });
      }
    }

    if (format === 'modern' || format === 'legacy' || format === 'vintage') {
      dualCycles.push({
        name: 'Fetchlands',
        reason: 'Perfect mana fixing',
        example: 'Polluted Delta, Scalding Tarn',
      });

      dualCycles.push({
        name: 'Shocklands',
        reason: 'Fetchable duals',
        example: 'Steam Vents, Hallowed Fountain',
      });
    }

    if (format === 'standard' || format === 'pioneer') {
      dualCycles.push({
        name: 'Painlands',
        reason: 'Immediate access',
        example: 'Shivan Reef, Adarkar Wastes',
      });

      dualCycles.push({
        name: 'Checklands',
        reason: 'Untapped mid-game',
        example: 'Drowned Catacomb, Glacial Fortress',
      });
    }

    recommendations.duals = distributeCycleCounts(dualCount, dualCycles, 4);
  }

  const utilityCount = colorDistribution.utility || 0;
  if (utilityCount > 0 && special_requirements.includes('utility_lands')) {
    recommendations.utility.push({
      name: 'Utility Lands',
      count: utilityCount,
      reason: 'Additional value',
      example: 'Ghost Quarter, Mutavault',
    });
  }

  return recommendations;
}
