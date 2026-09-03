import {
  AlternativeQuery,
  BuildOptions,
  ConceptMapping,
  ParsedQuery,
} from '../types.js';
import { applyOptimization } from './query-optimization.js';

export function generateExplanation(mappings: ConceptMapping[], options: BuildOptions): string {
  const explanations: string[] = [];

  const colorMappings = mappings.filter(m => m.operator === 'c' || m.operator === 'id');
  const typeMappings = mappings.filter(m => m.operator === 't');
  const functionMappings = mappings.filter(m => m.operator === 'function' || m.operator === 'o');
  const priceMappings = mappings.filter(m => ['usd', 'eur', 'tix'].includes(m.operator));
  const statMappings = mappings.filter(m => ['pow', 'tou', 'cmc'].includes(m.operator));

  if (colorMappings.length > 0) {
    explanations.push(explainColorConstraints(colorMappings));
  }

  if (typeMappings.length > 0) {
    explanations.push(explainTypeConstraints(typeMappings));
  }

  if (functionMappings.length > 0) {
    explanations.push(explainFunctionConstraints(functionMappings));
  }

  if (priceMappings.length > 0) {
    explanations.push(explainPriceConstraints(priceMappings));
  }

  if (statMappings.length > 0) {
    explanations.push(explainStatConstraints(statMappings));
  }

  if (options.format) {
    explanations.push(`legal in ${options.format} format`);
  }

  return explanations.join(', ');
}

function explainColorConstraints(mappings: ConceptMapping[]): string {
  const colorNames = mappings.map(m => getColorName(m.value)).join(' and ');
  return `Cards that are ${colorNames}`;
}

function explainTypeConstraints(mappings: ConceptMapping[]): string {
  const types = mappings.map(m => m.value).join(' or ');
  return `${types} cards`;
}

function explainFunctionConstraints(mappings: ConceptMapping[]): string {
  const functions = mappings.map(m => m.value).join(' or ');
  return `with ${functions} effects`;
}

function explainPriceConstraints(mappings: ConceptMapping[]): string {
  const prices = mappings.map(m => `${m.comparison}$${m.value}`).join(' and ');
  return `priced ${prices}`;
}

function explainStatConstraints(mappings: ConceptMapping[]): string {
  const stats = mappings.map(m => `${m.operator} ${m.comparison}${m.value}`).join(' and ');
  return `with ${stats}`;
}

function getColorName(code: string): string {
  const colorMap = new Map([
    ['w', 'white'], ['u', 'blue'], ['b', 'black'], ['r', 'red'], ['g', 'green'],
    ['c', 'colorless'], ['m', 'multicolor']
  ]);

  return colorMap.get(code) || code;
}

export function generateAlternatives(
  parsed: ParsedQuery,
  mappings: ConceptMapping[],
  options: BuildOptions,
  buildBaseQuery: (mappings: ConceptMapping[]) => string
): AlternativeQuery[] {
  const alternatives: AlternativeQuery[] = [];

  if (!options.format) {
    const popularFormats = ['standard', 'modern', 'commander', 'legacy'];
    for (const format of popularFormats) {
      const altQuery = buildBaseQuery(mappings) + ` f:${format}`;
      alternatives.push({
        query: altQuery,
        description: `Same search restricted to ${format} format`,
        type: 'format_restriction',
        confidence: 0.8
      });
    }
  }

  const strategies = ['precision', 'recall', 'discovery', 'budget'];
  for (const strategy of strategies) {
    if (strategy !== options.optimize_for) {
      const altQuery = applyOptimization(buildBaseQuery(mappings), strategy);
      alternatives.push({
        query: altQuery,
        description: `Optimized for ${strategy}`,
        type: 'optimization',
        confidence: 0.7
      });
    }
  }

  return alternatives.slice(0, 3);
}
