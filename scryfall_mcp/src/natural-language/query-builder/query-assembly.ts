import { ConceptMapping } from '../types.js';

const NUMERIC_OPERATORS = new Set(['cmc', 'pow', 'tou', 'usd', 'eur', 'tix']);

export function buildBaseQuery(mappings: ConceptMapping[]): string {
  const queryParts: string[] = [];
  const grouped = groupMappingsByOperator(mappings);

  for (const [operator, operatorMappings] of grouped) {
    const part = buildOperatorQuery(operator, operatorMappings);
    if (part) {
      queryParts.push(part);
    }
  }

  return queryParts.join(' ');
}

function groupMappingsByOperator(mappings: ConceptMapping[]): Map<string, ConceptMapping[]> {
  const grouped = new Map<string, ConceptMapping[]>();

  for (const mapping of mappings) {
    const key = mapping.operator;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push(mapping);
  }

  return grouped;
}

export function formatQueryToken(
  operator: string,
  value: string,
  comparison?: string,
  negation = false
): string {
  const prefix = negation ? '-' : '';
  const normalizedComparison = comparison === '=' ? '' : (comparison || '');
  if (NUMERIC_OPERATORS.has(operator)) {
    return `${prefix}${operator}${normalizedComparison}${value}`;
  }
  return `${prefix}${operator}:${normalizedComparison}${value}`;
}

function buildOperatorQuery(operator: string, mappings: ConceptMapping[]): string {
  if (mappings.length === 0) return '';

  if (mappings.length === 1) {
    const mapping = mappings[0];
    return formatQueryToken(operator, mapping.value, mapping.comparison, mapping.negation);
  }

  if (operator === 'o') {
    const alternatives = mappings.filter(mapping => !mapping.conjunction);
    const conjunctive = mappings.filter(mapping => mapping.conjunction);
    const parts: string[] = [];

    if (alternatives.length === 1) {
      parts.push(`o:"${alternatives[0].value}"`);
    } else if (alternatives.length > 1) {
      parts.push(`(${alternatives.map(mapping => `o:"${mapping.value}"`).join(' OR ')})`);
    }

    parts.push(...conjunctive.map(mapping => `o:"${mapping.value}"`));
    return parts.join(' ');
  }

  if (operator === 't') {
    const positive = mappings.filter(mapping => !mapping.negation && !mapping.conjunction);
    const conjunctive = mappings.filter(mapping => !mapping.negation && mapping.conjunction);
    const negative = mappings.filter(mapping => mapping.negation);
    const parts: string[] = [];

    if (positive.length === 1) {
      parts.push(formatQueryToken(operator, positive[0].value));
    } else if (positive.length > 1) {
      parts.push(`(${positive.map(mapping => formatQueryToken(operator, mapping.value)).join(' OR ')})`);
    }

    parts.push(...conjunctive.map(mapping => formatQueryToken(operator, mapping.value)));
    parts.push(...negative.map(mapping => formatQueryToken(operator, mapping.value, undefined, true)));
    return parts.join(' ');
  }

  if (NUMERIC_OPERATORS.has(operator)) {
    return buildNumericRange(operator, mappings);
  }

  const best = mappings.reduce((a, b) => (a.confidence > b.confidence ? a : b), mappings[0]);
  return formatQueryToken(operator, best.value, best.comparison, best.negation);
}

function buildNumericRange(operator: string, mappings: ConceptMapping[]): string {
  let bestExact: ConceptMapping | null = null;
  let bestMin: ConceptMapping | null = null;
  let bestMax: ConceptMapping | null = null;

  for (const mapping of mappings) {
    if (!mapping.comparison || mapping.comparison === '=') {
      if (!bestExact || mapping.confidence > bestExact.confidence) {
        bestExact = mapping;
      }
      continue;
    }

    if (mapping.comparison === '>=' || mapping.comparison === '>') {
      if (!bestMin || mapping.confidence > bestMin.confidence) {
        bestMin = mapping;
      }
      continue;
    }

    if ((mapping.comparison === '<=' || mapping.comparison === '<') &&
      (!bestMax || mapping.confidence > bestMax.confidence)) {
      bestMax = mapping;
    }
  }

  if (bestExact) {
    return formatQueryToken(operator, bestExact.value, '=', bestExact.negation);
  }

  const parts: string[] = [];
  if (bestMin) {
    parts.push(formatQueryToken(operator, bestMin.value, bestMin.comparison, bestMin.negation));
  }
  if (bestMax) {
    parts.push(formatQueryToken(operator, bestMax.value, bestMax.comparison, bestMax.negation));
  }
  return parts.join(' ');
}

export function applyFormat(query: string, format?: string): string {
  if (!format) return query;
  const formatPart = `f:${format}`;
  if (new RegExp(`(?:^|\\s)${formatPart}(?:\\s|$)`).test(query)) return query;
  return query ? `${query} ${formatPart}` : formatPart;
}
