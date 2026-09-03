/**
 * @fileoverview Simple Scryfall Query Validator
 * 
 * Lightweight replacement for the over-engineered validation system.
 * Provides basic validation for Scryfall queries with simple error messages.
 */

/**
 * Simple validation result interface
 */
export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  suggestions?: string[];
}

/**
 * Simple validation error
 */
export interface ValidationError {
  message: string;
  position?: number;
  severity: 'error';
}

/**
 * Simple validation warning
 */
export interface ValidationWarning {
  message: string;
  position?: number;
  severity: 'warning';
}

/**
 * Basic Scryfall operators for validation
 */
const KNOWN_OPERATORS = new Set([
  // Color/Mana
  'c', 'color', 'id', 'identity', 'm', 'mana', 'mv', 'manavalue', 'cmc', 'produces', 'devotion',
  // Text
  'name', 'n', 'oracle', 'o', 'flavor', 'ft',
  // Types
  'type', 't', 'subtype', 'supertype',
  // Stats
  'power', 'pow', 'toughness', 'tou', 'loyalty', 'loy',
  // Format/Legality
  'format', 'f', 'banned', 'restricted', 'legal',
  // Printing
  'set', 's', 'rarity', 'r', 'artist', 'a', 'year', 'block',
  // Properties
  'is', 'not', 'game',
  // Market
  'usd', 'eur', 'tix', 'price',
  // Other
  'cube', 'border', 'frame', 'watermark', 'language', 'lang'
]);

/**
 * Validates a Scryfall query string
 * 
 * @param query - The query string to validate
 * @returns Validation result with errors and warnings
 */
export function validateScryfallQuery(query: string): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  const suggestions: string[] = [];

  // Basic empty check
  if (!query || !query.trim()) {
    errors.push({
      message: 'Query cannot be empty',
      severity: 'error'
    });
    return { isValid: false, errors, warnings, suggestions };
  }

  const trimmedQuery = query.trim();

  // Check for balanced parentheses
  const openParens = (trimmedQuery.match(/\(/g) || []).length;
  const closeParens = (trimmedQuery.match(/\)/g) || []).length;
  if (openParens !== closeParens) {
    errors.push({
      message: 'Mismatched parentheses in query',
      severity: 'error'
    });
    if (openParens > closeParens) {
      suggestions.push('Add closing parenthesis ")"');
    } else {
      suggestions.push('Add opening parenthesis "("');
    }
  }

  // Check for balanced quotes
  const quotes = (trimmedQuery.match(/"/g) || []).length;
  if (quotes % 2 !== 0) {
    errors.push({
      message: 'Unmatched quotes in query',
      severity: 'error'
    });
    suggestions.push('Add closing quote "');
  }

  // Check for basic operator syntax
  const operatorPattern = /([a-zA-Z]+):/g;
  let match;
  while ((match = operatorPattern.exec(trimmedQuery)) !== null) {
    const operator = match[1].toLowerCase();
    if (!KNOWN_OPERATORS.has(operator)) {
      warnings.push({
        message: `Unknown operator "${operator}:" - may not be recognized by Scryfall`,
        position: match.index,
        severity: 'warning'
      });
      
      // Suggest similar operators
      const similar = findSimilarOperator(operator);
      if (similar) {
        suggestions.push(`Did you mean "${similar}:"?`);
      }
    }
  }

  // Check for common syntax errors
  if (trimmedQuery.includes('&&')) {
    warnings.push({
      message: 'Use "AND" instead of "&&" for boolean logic',
      severity: 'warning'
    });
    suggestions.push('Replace "&&" with "AND"');
  }

  if (trimmedQuery.includes('||')) {
    warnings.push({
      message: 'Use "OR" instead of "||" for boolean logic',
      severity: 'warning'
    });
    suggestions.push('Replace "||" with "OR"');
  }

  // Check for empty operators
  if (trimmedQuery.includes(':""') || trimmedQuery.includes(": ")) {
    warnings.push({
      message: 'Empty operator value detected',
      severity: 'warning'
    });
  }

  // Check for very long queries (performance warning)
  if (trimmedQuery.length > 500) {
    warnings.push({
      message: 'Very long query may impact search performance',
      severity: 'warning'
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    suggestions: suggestions.length > 0 ? suggestions : undefined
  };
}

/**
 * Find similar operator using simple string distance
 */
function findSimilarOperator(input: string): string | null {
  let bestMatch: string | null = null;
  let bestDistance = Infinity;

  for (const operator of KNOWN_OPERATORS) {
    const distance = levenshteinDistance(input, operator);
    if (distance < bestDistance && distance <= 2) {
      bestDistance = distance;
      bestMatch = operator;
    }
  }

  return bestMatch;
}

/**
 * Simple Levenshtein distance calculation
 */
function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));

  for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= b.length; j++) matrix[j][0] = j;

  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,     // deletion
        matrix[j - 1][i] + 1,     // insertion
        matrix[j - 1][i - 1] + indicator // substitution
      );
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Synchronous validation for backward compatibility
 */
export function validateScryfallQuerySync(query: string): ValidationResult {
  return validateScryfallQuery(query);
}

/**
 * Async validation for compatibility with existing interfaces
 */
export async function validateScryfallQueryAsync(query: string): Promise<ValidationResult> {
  return validateScryfallQuery(query);
}
