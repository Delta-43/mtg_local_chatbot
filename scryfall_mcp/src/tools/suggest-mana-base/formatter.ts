import {
  ManaBaseParams,
  ManaBaseRecommendations,
} from './types.js';

const COLOR_NAMES: Record<string, string> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
};

export function formatManaBaseResponse(
  params: ManaBaseParams,
  landCount: number,
  colorDistribution: Record<string, number>,
  recommendations: ManaBaseRecommendations
): string {
  let response = `**Mana Base Suggestion**\n\n`;

  response += `🎯 **Overview:**\n`;
  response += `• Colors: ${params.color_requirements}\n`;
  response += `• Strategy: ${params.strategy}\n`;
  response += `• Total Lands: ${landCount}/${params.deck_size}\n`;
  if (params.format) {
    response += `• Format: ${params.format}\n`;
  }
  response += `• Budget: ${params.budget}\n\n`;

  response += `📊 **Land Distribution:**\n`;
  for (const [color, count] of Object.entries(colorDistribution)) {
    if (count > 0 && color !== 'dual' && color !== 'utility') {
      response += `• ${COLOR_NAMES[color] || color}: ${count} lands\n`;
    }
  }
  if (colorDistribution.dual) {
    response += `• Dual/Fixing: ${colorDistribution.dual} lands\n`;
  }
  if (colorDistribution.utility) {
    response += `• Utility: ${colorDistribution.utility} lands\n`;
  }
  response += '\n';

  appendRecommendationGroup(response, recommendations.basics, '🏔️ **Basic Lands:**');
  response = appendRecommendationGroup(response, recommendations.basics, '🏔️ **Basic Lands:**', false);
  response = appendRecommendationGroup(response, recommendations.duals, '🌈 **Dual Lands:**', true);
  response = appendRecommendationGroup(response, recommendations.utility, '🛠️ **Utility Lands:**', true);
  response = appendRecommendationGroup(response, recommendations.budget_alternatives, '💰 **Budget Alternatives:**', true);

  response += `💡 **Additional Tips:**\n`;

  if (params.strategy === 'aggro') {
    response += `• Prioritize lands that enter untapped\n`;
    response += `• Consider fewer utility lands for speed\n`;
  } else if (params.strategy === 'control') {
    response += `• Include more utility lands for late game\n`;
    response += `• Consider lands with card selection\n`;
  } else if (params.strategy === 'combo') {
    response += `• Focus on consistency over speed\n`;
    response += `• Include tutoring lands if available\n`;
  }

  if (params.color_requirements.length > 2) {
    response += `• Three+ color decks need excellent mana fixing\n`;
    response += `• Consider green ramp spells for color fixing\n`;
  }

  return response;
}

function appendRecommendationGroup(
  response: string,
  recommendations: ManaBaseRecommendations['basics'],
  heading: string,
  includeReasoning = false
): string {
  if (recommendations.length === 0) {
    return response;
  }

  response += `${heading}\n`;
  for (const recommendation of recommendations) {
    response += `• ${recommendation.count}x ${recommendation.name}\n`;
    if (includeReasoning) {
      response += `  💡 *${recommendation.reason}*\n`;
      if (recommendation.example) {
        response += `  📝 Example: ${recommendation.example}\n`;
      }
    }
  }
  response += '\n';

  return response;
}
