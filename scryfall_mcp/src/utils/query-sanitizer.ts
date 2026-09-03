import { ValidationError } from '../types/mcp-types.js';

/**
 * Maximum allowed query length to prevent excessively long queries
 */
const MAX_QUERY_LENGTH = 2000;

/**
 * Allowed characters in search queries (basic ASCII + common symbols used in Scryfall)
 */
const ALLOWED_QUERY_CHARS = /^[\w\s\-:;,.()[\]"'>=<!+*&|]+$/;

/**
 * Control characters that should be removed from queries
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_REGEX = /[\x00-\x1F\x7F-\x9F]/g;

/**
 * Sanitizes user-provided search queries
 */
export function sanitizeQuery(query: string): string {
  if (!query || typeof query !== 'string') {
    throw new ValidationError('Query must be a non-empty string');
  }

  // Remove leading/trailing whitespace
  let sanitized = query.trim();

  // Check length before processing
  if (sanitized.length === 0) {
    throw new ValidationError('Query cannot be empty after trimming');
  }

  if (sanitized.length > MAX_QUERY_LENGTH) {
    throw new ValidationError(`Query is too long (max ${MAX_QUERY_LENGTH} characters)`);
  }

  // Remove control characters
  sanitized = sanitized.replace(CONTROL_CHARS_REGEX, '');

  // Check for allowed characters
  if (!ALLOWED_QUERY_CHARS.test(sanitized)) {
    throw new ValidationError('Query contains invalid characters. Only alphanumeric characters, spaces, and common search operators are allowed');
  }

  // Additional validation for potentially problematic patterns
  validateQueryStructure(sanitized);

  return sanitized;
}

/**
 * Validates the structure of a sanitized query
 */
function validateQueryStructure(query: string): void {
  // Check for excessive repeated characters (potential DoS)
  if (/(.)\1{50,}/.test(query)) {
    throw new ValidationError('Query contains excessive repeated characters');
  }

  // Check for excessively nested parentheses
  let maxNesting = 0;
  let currentNesting = 0;
  for (const char of query) {
    if (char === '(') {
      currentNesting++;
      maxNesting = Math.max(maxNesting, currentNesting);
    } else if (char === ')') {
      currentNesting--;
    }
  }
  
  if (maxNesting > 10) {
    throw new ValidationError('Query has too many nested parentheses (max 10 levels)');
  }

  // Check for balanced parentheses
  if (currentNesting !== 0) {
    throw new ValidationError('Query has unbalanced parentheses');
  }

  // Check for excessive boolean operators in sequence
  if (/\b(AND|OR|NOT)\s+(AND|OR|NOT)\s+(AND|OR|NOT)\b/i.test(query)) {
    throw new ValidationError('Query has too many consecutive boolean operators');
  }
}

/**
 * Sanitizes and validates format-specific query modifications
 */
export function sanitizeQueryModification(modification: string): string {
  if (!modification || typeof modification !== 'string') {
    throw new ValidationError('Query modification must be a non-empty string');
  }

  const sanitized = modification.trim();
  
  // Allow only specific game formats and simple operators
  const allowedModifications = /^(game:arena|game:paper|game:mtgo|f:[a-z]+|\s)+$/i;
  
  if (!allowedModifications.test(sanitized)) {
    throw new ValidationError('Invalid query modification format');
  }

  return sanitized;
}

/**
 * Sanitizes card identifier inputs
 */
export function sanitizeCardIdentifier(identifier: string): string {
  if (!identifier || typeof identifier !== 'string') {
    throw new ValidationError('Card identifier must be a non-empty string');
  }

  let sanitized = identifier.trim();

  if (sanitized.length === 0) {
    throw new ValidationError('Card identifier cannot be empty');
  }

  if (sanitized.length > 200) {
    throw new ValidationError('Card identifier is too long (max 200 characters)');
  }

  // Remove control characters
  sanitized = sanitized.replace(CONTROL_CHARS_REGEX, '');

  // For card names, be more restrictive about allowed characters
  const cardNameChars = /^[\w\s\-,.'"/!?&()]+$/;
  
  // Check if it's a UUID (more permissive)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  
  // Check if it's set/collector format (SET/NUMBER)
  const setCollectorRegex = /^[a-z0-9]{3,4}\/\d+[a-z]?$/i;

  if (!uuidRegex.test(sanitized) && !setCollectorRegex.test(sanitized) && !cardNameChars.test(sanitized)) {
    throw new ValidationError('Card identifier contains invalid characters');
  }

  return sanitized;
}