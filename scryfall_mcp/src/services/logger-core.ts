/**
 * Structured logging service using Pino for MCP server
 * Provides high-performance JSON logging with correlation IDs and contextual information
 */

import pino from 'pino';
import { APP_VERSION } from '../version.js';
import { MCPError } from '../types/mcp-errors.js';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogContext {
  requestId?: string;
  toolName?: string;
  resourceUri?: string;
  promptName?: string;
  userId?: string;
  sessionId?: string;
  [key: string]: unknown;
}

export interface PerformanceContext extends LogContext {
  startTime?: number;
  duration?: number;
  operation?: string;
}

export interface ErrorContext extends LogContext {
  error?: Error | MCPError;
  errorCode?: string;
  statusCode?: number;
  stack?: string;
}

function parseNodeEnv(value: string | undefined): 'development' | 'production' | 'test' {
  const normalized = value?.trim();
  if (normalized === 'production' || normalized === 'test') {
    return normalized;
  }
  return 'development';
}

function parseLogLevel(value: string | undefined): LogLevel {
  const normalized = value?.trim() as LogLevel | undefined;
  const validLevels: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
  return normalized && validLevels.includes(normalized) ? normalized : 'info';
}

function createLogger() {
  const isDevelopment = parseNodeEnv(process.env.NODE_ENV) === 'development';
  const logLevel = parseLogLevel(process.env.LOG_LEVEL);

  const baseConfig: pino.LoggerOptions = {
    level: logLevel,
    formatters: {
      level: label => ({ level: label }),
      bindings: bindings => ({
        pid: bindings.pid,
        hostname: bindings.hostname,
        service: 'scryfall-mcp',
        version: APP_VERSION,
      }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: {
      error: (error: Error | MCPError) => {
        if (error instanceof MCPError) {
          return error.toLogFormat();
        }
        return pino.stdSerializers.err(error);
      },
    },
  };

  const destination = pino.destination({ dest: 2 });

  if (isDevelopment) {
    return pino({
      ...baseConfig,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss.l Z',
          ignore: 'pid,hostname,service,version',
          messageFormat: '{requestId} [{toolName}] {msg}',
          destination: 2,
        },
      },
    });
  }

  return pino(baseConfig, destination);
}

export const logger = createLogger();

export class MCPLogger {
  private baseLogger: pino.Logger;

  constructor(baseLogger: pino.Logger = logger) {
    this.baseLogger = baseLogger;
  }

  child(context: LogContext): MCPLogger {
    return new MCPLogger(this.baseLogger.child(context));
  }

  info(context: LogContext, message: string): void {
    this.baseLogger.info(context, message);
  }

  warn(context: LogContext, message: string): void {
    this.baseLogger.warn(context, message);
  }

  error(context: ErrorContext, message: string): void {
    const errorContext = this.enhanceErrorContext(context);
    this.baseLogger.error(errorContext, message);
  }

  debug(context: LogContext, message: string): void {
    this.baseLogger.debug(context, message);
  }

  trace(context: LogContext, message: string): void {
    this.baseLogger.trace(context, message);
  }

  fatal(context: ErrorContext, message: string): void {
    const errorContext = this.enhanceErrorContext(context);
    this.baseLogger.fatal(errorContext, message);
  }

  toolStart(requestId: string, toolName: string, args?: Record<string, unknown>): void {
    this.info(
      {
        requestId,
        toolName,
        args: args ? this.sanitizeArgs(args) : undefined,
        phase: 'start',
      },
      'Tool execution started'
    );
  }

  toolComplete(requestId: string, toolName: string, duration?: number): void {
    this.info(
      {
        requestId,
        toolName,
        duration,
        phase: 'complete',
      },
      'Tool execution completed'
    );
  }

  toolError(requestId: string, toolName: string, error: Error | MCPError, args?: Record<string, unknown>): void {
    this.error(
      {
        requestId,
        toolName,
        error,
        args: args ? this.sanitizeArgs(args) : undefined,
        phase: 'error',
      },
      'Tool execution failed'
    );
  }

  performance(context: PerformanceContext, message: string): void {
    const perfContext = {
      ...context,
      duration:
        context.duration || (context.startTime ? Date.now() - context.startTime : undefined),
    };
    this.info(perfContext, message);
  }

  healthCheck(requestId: string, status: string, services?: Record<string, string>): void {
    this.info(
      {
        requestId,
        status,
        services,
        operation: 'health_check',
      },
      `Health check ${status}`
    );
  }

  request(requestId: string, operation: string, context?: LogContext): void {
    this.info(
      {
        requestId,
        operation,
        ...context,
      },
      `Request ${operation}`
    );
  }

  private enhanceErrorContext(context: ErrorContext): ErrorContext {
    if (!context.error) {
      return context;
    }

    const enhanced: ErrorContext = { ...context };

    if (context.error instanceof MCPError) {
      enhanced.errorCode = context.error.code;
      enhanced.statusCode = context.error.statusCode;
    }

    return enhanced;
  }

  private sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
    const sensitiveKeys = ['password', 'token', 'secret', 'key', 'auth', 'authorization'];

    const redact = (value: unknown, depth = 0, seen = new WeakSet<object>()): unknown => {
      if (depth > 4) return '[REDACTED]';
      if (value === null || value === undefined) return value;
      if (typeof value !== 'object') return value;
      if (seen.has(value as object)) return '[REDACTED]';
      seen.add(value as object);

      if (Array.isArray(value)) {
        return value.slice(0, 50).map(v => redact(v, depth + 1, seen));
      }

      const obj = value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        if (sensitiveKeys.some(s => k.toLowerCase().includes(s))) {
          out[k] = '[REDACTED]';
        } else {
          out[k] = redact(v, depth + 1, seen);
        }
      }
      return out;
    };

    return redact(args) as Record<string, unknown>;
  }
}

export const mcpLogger = new MCPLogger(logger);
export { logger as baseLogger };
