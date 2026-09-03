/**
 * Custom error classes for MCP server with structured error handling
 * Provides comprehensive error context for debugging and monitoring
 */

/**
 * Sanitizes a details object to prevent prototype pollution
 */
function sanitizeDetails(details?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!details || typeof details !== 'object') {
    return details;
  }

  // Create a clean object without prototype
  const sanitized = Object.create(null);
  
  // Copy safe properties
  for (const [key, value] of Object.entries(details)) {
    // Skip dangerous prototype pollution keys
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue;
    }
    
    // Recursively sanitize nested objects
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      sanitized[key] = sanitizeDetails(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }
  
  return sanitized;
}

/**
 * Base MCP error class with structured error data
 */
export class MCPError extends Error {
  public readonly timestamp: string;
  public readonly requestId?: string;

  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode = 500,
    details?: Record<string, unknown>,
    requestId?: string
  ) {
    super(message);
    this.name = "MCPError";
    this.timestamp = new Date().toISOString();
    this.requestId = requestId;

    // Sanitize details to prevent prototype pollution
    this.details = sanitizeDetails(details);

    // Ensure proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, MCPError.prototype);
  }

  public readonly details?: Record<string, unknown>;

  /**
   * Convert error to structured log format
   */
  toLogFormat(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      statusCode: this.statusCode,
      timestamp: this.timestamp,
      requestId: this.requestId,
      details: this.details,
      stack: this.stack,
    };
  }

  /**
   * Convert error to JSON for API responses
   */
  toJSON(): Record<string, unknown> {
    return {
      error: {
        name: this.name,
        message: this.message,
        code: this.code,
        statusCode: this.statusCode,
        timestamp: this.timestamp,
        requestId: this.requestId,
        details: this.details,
      },
    };
  }
}

/**
 * Error for tool execution failures
 */
export class ToolExecutionError extends MCPError {
  constructor(
    toolName: string,
    originalError: Error,
    details?: Record<string, unknown>,
    requestId?: string
  ) {
    const message = `Tool execution failed: ${toolName}`;
    const errorDetails = {
      toolName,
      originalError: {
        name: originalError.name,
        message: originalError.message,
        stack: originalError.stack,
      },
      ...sanitizeDetails(details),
    };

    super(message, "TOOL_EXECUTION_ERROR", 500, errorDetails, requestId);
    this.name = "ToolExecutionError";
    Object.setPrototypeOf(this, ToolExecutionError.prototype);
  }
}

/**
 * Error for validation failures with enhanced field-specific context
 * Note: The main ValidationError class is now in mcp-types.ts for backward compatibility
 * This is a specialized version for complex validation scenarios
 */
export class DetailedValidationError extends MCPError {
  constructor(
    field: string,
    value: unknown,
    reason: string,
    details?: Record<string, unknown>,
    requestId?: string
  ) {
    const message = `Validation failed for ${field}: ${reason}`;
    const errorDetails = {
      field,
      value: typeof value === "object" ? JSON.stringify(value) : value,
      reason,
      ...sanitizeDetails(details),
    };

    super(message, "DETAILED_VALIDATION_ERROR", 400, errorDetails, requestId);
    this.name = "DetailedValidationError";
    Object.setPrototypeOf(this, DetailedValidationError.prototype);
  }
}

/**
 * Error for resource access failures
 */
export class ResourceError extends MCPError {
  constructor(
    resourceUri: string,
    operation: string,
    originalError?: Error,
    details?: Record<string, unknown>,
    requestId?: string
  ) {
    const message = `Resource ${operation} failed: ${resourceUri}`;
    const errorDetails = {
      resourceUri,
      operation,
      originalError: originalError
        ? {
            name: originalError.name,
            message: originalError.message,
            stack: originalError.stack,
          }
        : undefined,
      ...sanitizeDetails(details),
    };

    super(message, "RESOURCE_ERROR", 404, errorDetails, requestId);
    this.name = "ResourceError";
    Object.setPrototypeOf(this, ResourceError.prototype);
  }
}

/**
 * Error for prompt generation failures
 */
export class PromptError extends MCPError {
  constructor(
    promptName: string,
    operation: string,
    originalError?: Error,
    details?: Record<string, unknown>,
    requestId?: string
  ) {
    const message = `Prompt ${operation} failed: ${promptName}`;
    const errorDetails = {
      promptName,
      operation,
      originalError: originalError
        ? {
            name: originalError.name,
            message: originalError.message,
            stack: originalError.stack,
          }
        : undefined,
      ...sanitizeDetails(details),
    };

    super(message, "PROMPT_ERROR", 500, errorDetails, requestId);
    this.name = "PromptError";
    Object.setPrototypeOf(this, PromptError.prototype);
  }
}

/**
 * Error for configuration issues
 */
export class ConfigurationError extends MCPError {
  constructor(
    configKey: string,
    reason: string,
    details?: Record<string, unknown>,
    requestId?: string
  ) {
    const message = `Configuration error for ${configKey}: ${reason}`;
    const errorDetails = {
      configKey,
      reason,
      ...sanitizeDetails(details),
    };

    super(message, "CONFIGURATION_ERROR", 500, errorDetails, requestId);
    this.name = "ConfigurationError";
    Object.setPrototypeOf(this, ConfigurationError.prototype);
  }
}

/**
 * Error for health check failures
 */
export class HealthCheckError extends MCPError {
  constructor(service: string, reason: string, details?: Record<string, unknown>, requestId?: string) {
    const message = `Health check failed for ${service}: ${reason}`;
    const errorDetails = {
      service,
      reason,
      ...sanitizeDetails(details),
    };

    super(message, "HEALTH_CHECK_ERROR", 503, errorDetails, requestId);
    this.name = "HealthCheckError";
    Object.setPrototypeOf(this, HealthCheckError.prototype);
  }
}

/**
 * Utility function to create request correlation ID
 */
export function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Utility function to wrap unknown errors in MCPError
 */
export function wrapError(error: unknown, context: string, requestId?: string): MCPError {
  if (error instanceof MCPError) {
    return error;
  }

  if (error instanceof Error) {
    return new MCPError(
      `${context}: ${error.message}`,
      "WRAPPED_ERROR",
      500,
      sanitizeDetails({
        originalError: {
          name: error.name,
          message: error.message,
          stack: error.stack,
        },
        context,
      }),
      requestId
    );
  }

  return new MCPError(
    `${context}: Unknown error`,
    "UNKNOWN_ERROR",
    500,
    sanitizeDetails({
      originalError: String(error),
      context,
    }),
    requestId
  );
}

/**
 * Type guard to check if error is an MCPError
 */
export function isMCPError(error: unknown): error is MCPError {
  return error instanceof MCPError;
}

/**
 * Error codes enum for consistent error handling
 */
export enum ErrorCodes {
  TOOL_EXECUTION_ERROR = "TOOL_EXECUTION_ERROR",
  DETAILED_VALIDATION_ERROR = "DETAILED_VALIDATION_ERROR",
  RESOURCE_ERROR = "RESOURCE_ERROR",
  PROMPT_ERROR = "PROMPT_ERROR",
  CONFIGURATION_ERROR = "CONFIGURATION_ERROR",
  HEALTH_CHECK_ERROR = "HEALTH_CHECK_ERROR",
  WRAPPED_ERROR = "WRAPPED_ERROR",
  UNKNOWN_ERROR = "UNKNOWN_ERROR",
  // Domain-specific errors (defined in mcp-types.ts)
  SCRYFALL_API_ERROR = "SCRYFALL_API_ERROR",
  RATE_LIMIT_ERROR = "RATE_LIMIT_ERROR",
  VALIDATION_ERROR = "VALIDATION_ERROR",
}
