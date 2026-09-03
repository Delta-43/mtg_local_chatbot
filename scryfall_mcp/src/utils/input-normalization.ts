import { z } from 'zod';

export function normalizeTrimmedString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export function normalizeLowercaseString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

export function normalizeUppercaseString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().toUpperCase() : value;
}

export function normalizeStringArray(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return value;
  }

  return value.map(item => (typeof item === 'string' ? item.trim() : item));
}

export function normalizedEnum<const T extends readonly [string, ...string[]]>(values: T) {
  return z.preprocess(normalizeLowercaseString, z.enum(values));
}

export function trimmedString(minLength = 0, message?: string) {
  const schema = z.preprocess(normalizeTrimmedString, z.string());
  return minLength > 0 ? schema.pipe(z.string().min(minLength, message)) : schema;
}
