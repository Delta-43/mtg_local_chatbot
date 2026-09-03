/**
 * Utility functions for safely parsing environment variables
 */

import { mcpLogger } from "../services/logger.js";
import { DEFAULT_SCRYFALL_USER_AGENT } from "../version.js";

function logEnvFallback(kind: string, details: Record<string, unknown>, message: string): void {
  mcpLogger.warn(
    {
      operation: "env_validation",
      envValueKind: kind,
      ...details,
    },
    message
  );
}

/**
 * Safely parses an integer from an environment variable
 */
export function parseEnvInt(envVar: string | undefined, defaultValue: number, min?: number, max?: number): number {
  if (!envVar || envVar.trim() === '') {
    return defaultValue;
  }

  const parsed = parseInt(envVar.trim(), 10);
  
  if (isNaN(parsed)) {
    logEnvFallback("int", { envVar, defaultValue }, `Invalid integer value for environment variable. Using default: ${defaultValue}`);
    return defaultValue;
  }

  if (min !== undefined && parsed < min) {
    logEnvFallback("int", { parsed, min }, `Environment variable value ${parsed} is below minimum ${min}. Using minimum value.`);
    return min;
  }

  if (max !== undefined && parsed > max) {
    logEnvFallback("int", { parsed, max }, `Environment variable value ${parsed} is above maximum ${max}. Using maximum value.`);
    return max;
  }

  return parsed;
}

/**
 * Safely parses a float from an environment variable
 */
export function parseEnvFloat(envVar: string | undefined, defaultValue: number, min?: number, max?: number): number {
  if (!envVar || envVar.trim() === '') {
    return defaultValue;
  }

  const parsed = parseFloat(envVar.trim());
  
  if (isNaN(parsed)) {
    logEnvFallback("float", { envVar, defaultValue }, `Invalid float value for environment variable. Using default: ${defaultValue}`);
    return defaultValue;
  }

  if (min !== undefined && parsed < min) {
    logEnvFallback("float", { parsed, min }, `Environment variable value ${parsed} is below minimum ${min}. Using minimum value.`);
    return min;
  }

  if (max !== undefined && parsed > max) {
    logEnvFallback("float", { parsed, max }, `Environment variable value ${parsed} is above maximum ${max}. Using maximum value.`);
    return max;
  }

  return parsed;
}

/**
 * Safely parses a boolean from an environment variable
 */
export function parseEnvBoolean(envVar: string | undefined, defaultValue: boolean): boolean {
  if (!envVar || envVar.trim() === '') {
    return defaultValue;
  }

  const trimmed = envVar.trim().toLowerCase();
  
  if (trimmed === 'true' || trimmed === '1' || trimmed === 'yes' || trimmed === 'on') {
    return true;
  }
  
  if (trimmed === 'false' || trimmed === '0' || trimmed === 'no' || trimmed === 'off') {
    return false;
  }

  logEnvFallback("boolean", { envVar, defaultValue }, `Invalid boolean value for environment variable. Using default: ${defaultValue}`);
  return defaultValue;
}

/**
 * Safely parses a string from an environment variable with validation
 */
export function parseEnvString(
  envVar: string | undefined, 
  defaultValue: string, 
  allowedValues?: string[],
  minLength?: number,
  maxLength?: number
): string {
  if (!envVar || envVar.trim() === '') {
    return defaultValue;
  }

  const trimmed = envVar.trim();

  if (minLength !== undefined && trimmed.length < minLength) {
    logEnvFallback("string", { envVar: trimmed, minLength, defaultValue }, `Environment variable value is too short (min ${minLength}). Using default.`);
    return defaultValue;
  }

  if (maxLength !== undefined && trimmed.length > maxLength) {
    logEnvFallback("string", { envVar: trimmed, maxLength, defaultValue }, `Environment variable value is too long (max ${maxLength}). Using default.`);
    return defaultValue;
  }

  if (allowedValues && !allowedValues.includes(trimmed)) {
    logEnvFallback(
      "string",
      { envVar: trimmed, allowedValues, defaultValue },
      `Environment variable value is not in allowed values: ${allowedValues.join(", ")}. Using default.`
    );
    return defaultValue;
  }

  return trimmed;
}

/**
 * Configuration validation helpers
 */
export const EnvValidators = {
  /**
   * Rate limiter configuration
   */
  rateLimitMs: (value?: string) => parseEnvInt(value, 100, 50, 5000),
  rateLimitQueueMax: (value?: string) => parseEnvInt(value, 500, 10, 50000),
  
  /**
   * Cache configuration
   */
  cacheMaxSize: (value?: string) => parseEnvInt(value, 10000, 100, 1000000),
  cacheMaxMemoryMB: (value?: string) => parseEnvInt(value, 100, 10, 10000),
  
  /**
   * Timeout configuration
   */
  scryfallTimeoutMs: (value?: string) => parseEnvInt(value, 15000, 1000, 300000),

  /**
   * HTTP transport configuration
   */
  httpMaxBodyBytes: (value?: string) => parseEnvInt(value, 1_048_576, 1024, 10 * 1024 * 1024),
  httpSessionIdleMs: (value?: string) => parseEnvInt(value, 30 * 60 * 1000, 1, 24 * 60 * 60 * 1000),
  httpSessionCleanupIntervalMs: (value?: string) => parseEnvInt(value, 60_000, 1, 60 * 60 * 1000),
  
  /**
   * Log level configuration
   */
  logLevel: (value?: string) => parseEnvString(
    value, 
    'info', 
    ['error', 'warn', 'info', 'debug', 'trace']
  ),
  
  /**
   * Node environment
   */
  nodeEnv: (value?: string) => parseEnvString(
    value,
    'development',
    ['development', 'production', 'test']
  ),
  
  /**
   * Health check configuration
   */
  healthCheckDeep: (value?: string) => parseEnvBoolean(value, false),
  
  /**
   * User agent validation
   */
  userAgent: (value?: string) => parseEnvString(
    value,
    DEFAULT_SCRYFALL_USER_AGENT,
    undefined,
    5,
    200
  )
};
