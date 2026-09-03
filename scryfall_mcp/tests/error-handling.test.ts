import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { 
  MCPError, 
  ToolExecutionError, 
  ResourceError, 
  PromptError, 
  generateRequestId,
  wrapError,
  isMCPError 
} from '../src/types/mcp-errors.js';
import { 
  ScryfallAPIError, 
  RateLimitError, 
  ValidationError 
} from '../src/types/mcp-types.js';
import { 
  mcpLogger, 
  ErrorMonitor, 
  measureTimeWithMonitoring 
} from '../src/services/logger.js';

describe('Error Handling System', () => {
  beforeEach(() => {
    // Reset error monitoring before each test
    ErrorMonitor.reset();
  });

  describe('MCPError Base Class', () => {
    it('should create MCPError with all properties', () => {
      const requestId = generateRequestId();
      const error = new MCPError(
        'Test error',
        'TEST_ERROR',
        500,
        { test: 'data' },
        requestId
      );

      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_ERROR');
      expect(error.statusCode).toBe(500);
      expect(error.details).toEqual({ test: 'data' });
      expect(error.requestId).toBe(requestId);
      expect(error.timestamp).toBeDefined();
      expect(error.name).toBe('MCPError');
    });

    it('should convert to log format', () => {
      const error = new MCPError('Test error', 'TEST_ERROR', 500);
      const logFormat = error.toLogFormat();

      expect(logFormat).toHaveProperty('name', 'MCPError');
      expect(logFormat).toHaveProperty('message', 'Test error');
      expect(logFormat).toHaveProperty('code', 'TEST_ERROR');
      expect(logFormat).toHaveProperty('statusCode', 500);
      expect(logFormat).toHaveProperty('timestamp');
      expect(logFormat).toHaveProperty('stack');
    });

    it('should convert to JSON format', () => {
      const error = new MCPError('Test error', 'TEST_ERROR', 500);
      const jsonFormat = error.toJSON();

      expect(jsonFormat).toHaveProperty('error');
      expect(jsonFormat.error).toHaveProperty('name', 'MCPError');
      expect(jsonFormat.error).toHaveProperty('message', 'Test error');
      expect(jsonFormat.error).toHaveProperty('code', 'TEST_ERROR');
    });
  });

  describe('Specialized Error Classes', () => {
    it('should create ToolExecutionError correctly', () => {
      const originalError = new Error('Original error');
      const requestId = generateRequestId();
      const toolError = new ToolExecutionError(
        'test_tool',
        originalError,
        { args: { test: 'value' } },
        requestId
      );

      expect(toolError.message).toBe('Tool execution failed: test_tool');
      expect(toolError.code).toBe('TOOL_EXECUTION_ERROR');
      expect(toolError.statusCode).toBe(500);
      expect(toolError.details?.toolName).toBe('test_tool');
      expect(toolError.details?.originalError).toEqual({
        name: 'Error',
        message: 'Original error',
        stack: originalError.stack
      });
    });

    it('should create ResourceError correctly', () => {
      const originalError = new Error('Resource not found');
      const requestId = generateRequestId();
      const resourceError = new ResourceError(
        'test://resource',
        'read',
        originalError,
        {},
        requestId
      );

      expect(resourceError.message).toBe('Resource read failed: test://resource');
      expect(resourceError.code).toBe('RESOURCE_ERROR');
      expect(resourceError.statusCode).toBe(404);
      expect(resourceError.details?.resourceUri).toBe('test://resource');
      expect(resourceError.details?.operation).toBe('read');
    });

    it('should create PromptError correctly', () => {
      const originalError = new Error('Prompt generation failed');
      const requestId = generateRequestId();
      const promptError = new PromptError(
        'test_prompt',
        'generate',
        originalError,
        {},
        requestId
      );

      expect(promptError.message).toBe('Prompt generate failed: test_prompt');
      expect(promptError.code).toBe('PROMPT_ERROR');
      expect(promptError.statusCode).toBe(500);
      expect(promptError.details?.promptName).toBe('test_prompt');
      expect(promptError.details?.operation).toBe('generate');
    });
  });

  describe('Domain-Specific Error Classes', () => {
    it('should create ScryfallAPIError correctly', () => {
      const requestId = generateRequestId();
      const apiError = new ScryfallAPIError(
        'API error',
        404,
        'not_found',
        'Card not found',
        requestId
      );

      expect(apiError.message).toBe('API error');
      expect(apiError.status).toBe(404);
      expect(apiError.apiCode).toBe('not_found');
      expect(apiError.apiDetails).toBe('Card not found');
      expect(apiError.code).toBe('not_found'); // MCPError code
      expect(apiError.statusCode).toBe(404);
      expect(isMCPError(apiError)).toBe(true);
    });

    it('should create RateLimitError correctly', () => {
      const requestId = generateRequestId();
      const rateLimitError = new RateLimitError(
        'Rate limit exceeded',
        60,
        requestId
      );

      expect(rateLimitError.message).toBe('Rate limit exceeded');
      expect(rateLimitError.retryAfter).toBe(60);
      expect(rateLimitError.code).toBe('RATE_LIMIT_ERROR');
      expect(rateLimitError.statusCode).toBe(429);
      expect(isMCPError(rateLimitError)).toBe(true);
    });

    it('should create ValidationError correctly', () => {
      const requestId = generateRequestId();
      const validationError = new ValidationError(
        'Invalid field value',
        'test_field',
        requestId
      );

      expect(validationError.message).toBe('Invalid field value');
      expect(validationError.field).toBe('test_field');
      expect(validationError.code).toBe('VALIDATION_ERROR');
      expect(validationError.statusCode).toBe(400);
      expect(isMCPError(validationError)).toBe(true);
    });
  });

  describe('Utility Functions', () => {
    it('should generate unique request IDs', () => {
      const id1 = generateRequestId();
      const id2 = generateRequestId();

      expect(id1).toMatch(/^req_\d+_[a-z0-9]+$/);
      expect(id2).toMatch(/^req_\d+_[a-z0-9]+$/);
      expect(id1).not.toBe(id2);
    });

    it('should wrap unknown errors', () => {
      const requestId = generateRequestId();
      const wrappedError = wrapError('string error', 'test context', requestId);

      expect(wrappedError).toBeInstanceOf(MCPError);
      expect(wrappedError.message).toBe('test context: Unknown error');
      expect(wrappedError.code).toBe('UNKNOWN_ERROR');
      expect(wrappedError.details?.originalError).toBe('string error');
    });

    it('should wrap Error objects', () => {
      const originalError = new Error('Original error');
      const requestId = generateRequestId();
      const wrappedError = wrapError(originalError, 'test context', requestId);

      expect(wrappedError).toBeInstanceOf(MCPError);
      expect(wrappedError.message).toBe('test context: Original error');
      expect(wrappedError.code).toBe('WRAPPED_ERROR');
      expect(wrappedError.details?.originalError).toEqual({
        name: 'Error',
        message: 'Original error',
        stack: originalError.stack
      });
    });

    it('should not wrap MCPError objects', () => {
      const originalError = new MCPError('Original MCP error', 'ORIGINAL_ERROR', 500);
      const wrappedError = wrapError(originalError, 'test context');

      expect(wrappedError).toBe(originalError); // Should return the same instance
    });

    it('should identify MCPError instances', () => {
      const mcpError = new MCPError('Test', 'TEST', 500);
      const regularError = new Error('Test');
      const scryfallError = new ScryfallAPIError('Test', 404);

      expect(isMCPError(mcpError)).toBe(true);
      expect(isMCPError(scryfallError)).toBe(true);
      expect(isMCPError(regularError)).toBe(false);
      expect(isMCPError('string')).toBe(false);
      expect(isMCPError(null)).toBe(false);
    });
  });

  describe('Error Monitoring', () => {
    it('should track errors', () => {
      const requestId = generateRequestId();
      
      ErrorMonitor.trackError('TEST_ERROR', requestId);
      ErrorMonitor.trackError('TEST_ERROR', requestId);
      ErrorMonitor.trackError('OTHER_ERROR');

      const stats = ErrorMonitor.getErrorStats();
      expect(stats['TEST_ERROR']).toBe(2);
      expect(stats['OTHER_ERROR']).toBe(1);
    });

    it('should track performance metrics', () => {
      const requestId = generateRequestId();
      
      ErrorMonitor.trackPerformance('test_operation', 100, requestId);
      ErrorMonitor.trackPerformance('test_operation', 200, requestId);

      const stats = ErrorMonitor.getPerformanceStats();
      expect(stats['test_operation']).toEqual({
        count: 2,
        totalTime: 300,
        avgTime: 150
      });
    });

    it('should track request correlations', () => {
      const requestId = generateRequestId();
      
      ErrorMonitor.trackError('TEST_ERROR', requestId);
      ErrorMonitor.trackPerformance('test_operation', 100, requestId);

      const correlations = ErrorMonitor.getRequestCorrelations(requestId);
      expect(correlations).toContain('error:TEST_ERROR');
      expect(correlations).toContain('perf:test_operation:100ms');
    });

    it('should bound request correlations for arbitrary request IDs', () => {
      for (let index = 0; index < 1100; index += 1) {
        ErrorMonitor.trackError('TEST_ERROR', `external-${index}`);
      }

      expect(Object.keys(ErrorMonitor.getAllCorrelations()).length).toBeLessThanOrEqual(1000);
      expect(ErrorMonitor.getRequestCorrelations('external-0')).toEqual([]);
      expect(ErrorMonitor.getRequestCorrelations('external-1099')).toContain('error:TEST_ERROR');
    });

    it('should generate monitoring report', () => {
      ErrorMonitor.trackError('TEST_ERROR');
      ErrorMonitor.trackPerformance('test_operation', 100);

      const report = ErrorMonitor.getMonitoringReport();
      expect(report).toHaveProperty('errors');
      expect(report).toHaveProperty('performance');
      expect(report).toHaveProperty('correlationCount');
      expect(report).toHaveProperty('timestamp');
      expect(report.errors['TEST_ERROR']).toBe(1);
    });

    it('should reset monitoring data', () => {
      ErrorMonitor.trackError('TEST_ERROR');
      ErrorMonitor.trackPerformance('test_operation', 100);
      
      ErrorMonitor.reset();
      
      const stats = ErrorMonitor.getErrorStats();
      const perfStats = ErrorMonitor.getPerformanceStats();
      expect(Object.keys(stats)).toHaveLength(0);
      expect(Object.keys(perfStats)).toHaveLength(0);
    });
  });

  describe('Performance Monitoring', () => {
    it('should measure time with monitoring for successful operations', async () => {
      const requestId = generateRequestId();
      const operation = 'test_operation';
      
      const result = await measureTimeWithMonitoring(
        operation,
        requestId,
        async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return 'success';
        }
      );

      expect(result).toBe('success');
      
      const perfStats = ErrorMonitor.getPerformanceStats();
      expect(perfStats[operation]).toBeDefined();
      expect(perfStats[operation].count).toBe(1);
      expect(perfStats[operation].avgTime).toBeGreaterThan(0);
    });

    it('should measure time with monitoring for failed operations', async () => {
      const requestId = generateRequestId();
      const operation = 'test_operation';
      
      await expect(
        measureTimeWithMonitoring(
          operation,
          requestId,
          async () => {
            await new Promise(resolve => setTimeout(resolve, 10));
            throw new Error('Test error');
          }
        )
      ).rejects.toThrow('Test error');

      const errorStats = ErrorMonitor.getErrorStats();
      const perfStats = ErrorMonitor.getPerformanceStats();
      
      expect(errorStats['Error']).toBe(1);
      expect(perfStats[`${operation}_failed`]).toBeDefined();
      expect(perfStats[`${operation}_failed`].count).toBe(1);
    });
  });
});
