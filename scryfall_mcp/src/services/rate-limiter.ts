import { RATE_LIMIT_CONFIG, RateLimitError } from '../types/mcp-types.js';
import { EnvValidators } from '../utils/env-parser.js';

interface QueuedRequest {
  run: () => Promise<unknown>;
  resolve: (value?: unknown) => void;
  reject: (error: Error) => void;
  timestamp: number;
  settled: boolean;
  minIntervalMs?: number;
}

export interface RateLimiterExecuteOptions {
  minIntervalMs?: number;
}

/**
 * Rate limiter that enforces minimum intervals between API calls
 * Implements queue-based system with exponential backoff for errors
 */
export class RateLimiter {
  private queue: QueuedRequest[] = [];
  private lastRequestTime = 0;
  private processing = false;
  private consecutiveErrors = 0;
  private readonly maxQueueSize: number;
  private activeTimeouts = new Set<NodeJS.Timeout>();
  private activeRequest: QueuedRequest | null = null;
  private activeSleepReject: ((error: Error) => void) | null = null;
  private resetGeneration = 0;
  private nextAllowedRequestTime = 0;
  private circuitOpenedAt: number | null = null;

  constructor(
    private minInterval: number = EnvValidators.rateLimitMs(process.env.RATE_LIMIT_MS),
    private maxRetries: number = RATE_LIMIT_CONFIG.maxRetries,
    private backoffMultiplier: number = RATE_LIMIT_CONFIG.backoffMultiplier,
    private maxBackoffMs: number = RATE_LIMIT_CONFIG.maxBackoffMs
  ) {
    this.maxQueueSize = EnvValidators.rateLimitQueueMax(process.env.RATE_LIMIT_QUEUE_MAX);
  }

  /**
   * Queues an operation so rate limiting and request completion stay serialized
   */
  async execute<T>(operation: () => Promise<T>, options: RateLimiterExecuteOptions = {}): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (this.queue.length >= this.maxQueueSize) {
        return reject(new RateLimitError('Queue capacity exceeded'));
      }
      this.queue.push({
        run: operation as () => Promise<unknown>,
        resolve: (value) => resolve(value as T),
        reject,
        timestamp: Date.now(),
        settled: false,
        minIntervalMs: options.minIntervalMs,
      });

      if (!this.processing) {
        void this.processQueue();
      }
    });
  }

  /**
   * Processes the request queue with rate limiting
   */
  private async processQueue(): Promise<void> {
    // Use atomic check-and-set to prevent race conditions
    if (this.processing) {
      return;
    }

    this.processing = true;
    const generation = this.resetGeneration;

    try {
      while (this.queue.length > 0 && generation === this.resetGeneration) {
        const request = this.queue.shift()!;
        this.activeRequest = request;

        try {
          await this.enforceRateLimit(request.minIntervalMs);
          const result = await request.run();
          this.resolveRequest(request, result);
        } catch (error) {
          this.rejectRequest(
            request,
            error instanceof Error ? error : new Error('Unknown rate limit error')
          );
        } finally {
          if (this.activeRequest === request) {
            this.activeRequest = null;
          }
        }
      }
    } finally {
      this.processing = false;

      if (this.queue.length > 0) {
        void this.processQueue();
      }
    }
  }

  /**
   * Waits for rate limit clearance before proceeding
   */
  async waitForClearance(): Promise<void> {
    await this.execute(async () => undefined);
  }

  /**
   * Enforces the minimum interval between requests
   */
  private async enforceRateLimit(requestMinInterval?: number): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    const effectiveMinInterval = Math.max(this.minInterval, requestMinInterval ?? 0);
    
    // Calculate delay including exponential backoff for errors
    let delay = Math.max(0, effectiveMinInterval - timeSinceLastRequest);
    delay = Math.max(delay, this.nextAllowedRequestTime - now);
    
    if (this.consecutiveErrors > 0) {
      const backoffDelay = Math.min(
        effectiveMinInterval * Math.pow(this.backoffMultiplier, this.consecutiveErrors),
        this.maxBackoffMs
      );
      delay = Math.max(delay, backoffDelay);
    }

    if (delay > 0) {
      await this.sleep(delay);
    }

    this.lastRequestTime = Date.now();
  }

  /**
   * Records an error for backoff calculation
   */
  recordError(status?: number): void {
    if (status !== undefined && status !== 429 && status < 500) {
      return;
    }

    this.consecutiveErrors++;
    if (this.consecutiveErrors >= this.maxRetries) {
      this.circuitOpenedAt = Date.now();
    }
  }

  /**
   * Records a successful request
   */
  recordSuccess(): void {
    this.consecutiveErrors = 0;
    this.circuitOpenedAt = null;
  }

  /**
   * Gets the current backoff delay
   */
  getCurrentBackoffDelay(): number {
    if (this.consecutiveErrors === 0) {
      return 0;
    }
    
    return Math.min(
      this.minInterval * Math.pow(this.backoffMultiplier, this.consecutiveErrors),
      this.maxBackoffMs
    );
  }

  /**
   * Checks if we should retry based on error count
   */
  shouldRetry(): boolean {
    return this.consecutiveErrors < this.maxRetries;
  }

  /**
   * Gets queue status for monitoring
   */
  getStatus(): {
    queueLength: number;
    processing: boolean;
    consecutiveErrors: number;
    currentBackoffDelay: number;
    lastRequestTime: number;
    nextAllowedRequestTime: number;
  } {
    return {
      queueLength: this.queue.length,
      processing: this.processing,
      consecutiveErrors: this.consecutiveErrors,
      currentBackoffDelay: this.getCurrentBackoffDelay(),
      lastRequestTime: this.lastRequestTime,
      nextAllowedRequestTime: this.nextAllowedRequestTime
    };
  }

  /**
   * Clears the queue and resets state
   */
  reset(): void {
    // Clear all active timeouts to prevent memory leaks
    for (const timeout of this.activeTimeouts) {
      clearTimeout(timeout);
    }
    this.activeTimeouts.clear();

    this.resetGeneration++;
    const resetError = new RateLimitError('Rate limiter was reset');

    if (this.activeSleepReject) {
      this.activeSleepReject(resetError);
      this.activeSleepReject = null;
    }

    if (this.activeRequest) {
      this.rejectRequest(this.activeRequest, resetError);
      this.activeRequest = null;
    }

    // Reject all pending requests
    while (this.queue.length > 0) {
      const request = this.queue.shift()!;
      this.rejectRequest(request, resetError);
    }

    this.consecutiveErrors = 0;
    this.lastRequestTime = 0;
    this.nextAllowedRequestTime = 0;
    this.circuitOpenedAt = null;
  }

  /**
   * Utility method for sleeping with timeout tracking
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.activeTimeouts.delete(timeout);
        if (this.activeSleepReject === activeReject) {
          this.activeSleepReject = null;
        }
        resolve();
      }, ms);
      this.activeTimeouts.add(timeout);

      const activeReject = (error: Error) => {
        clearTimeout(timeout);
        this.activeTimeouts.delete(timeout);
        reject(error);
      };

      this.activeSleepReject = activeReject;
    });
  }

  private resolveRequest(request: QueuedRequest, value?: unknown): void {
    if (request.settled) {
      return;
    }
    request.settled = true;
    request.resolve(value);
  }

  private rejectRequest(request: QueuedRequest, error: Error): void {
    if (request.settled) {
      return;
    }
    request.settled = true;
    request.reject(error);
  }

  /**
   * Handles 429 responses with Retry-After header
   */
  handleRateLimitResponse(retryAfter?: string): void {
    if (this.consecutiveErrors === 0) {
      this.recordError(429);
    }

    let delay = this.getCurrentBackoffDelay();

    if (retryAfter) {
      const retryAfterMs = parseInt(retryAfter, 10) * 1000;
      if (!Number.isNaN(retryAfterMs)) {
        delay = Math.max(delay, retryAfterMs);
      }
    }

    this.nextAllowedRequestTime = Math.max(this.nextAllowedRequestTime, Date.now() + delay);
  }

  /**
   * Creates a circuit breaker pattern for API failures
   */
  isCircuitOpen(): boolean {
    if (this.consecutiveErrors < this.maxRetries) {
      return false;
    }

    if (this.circuitOpenedAt === null) {
      this.circuitOpenedAt = Date.now();
    }

    return Date.now() - this.circuitOpenedAt < this.maxBackoffMs;
  }

  /**
   * Gets estimated wait time for next request
   */
  getEstimatedWaitTime(): number {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    const baseDelay = Math.max(0, this.minInterval - timeSinceLastRequest);
    const backoffDelay = this.getCurrentBackoffDelay();
    const throttleDelay = Math.max(0, this.nextAllowedRequestTime - now);
    
    return Math.max(baseDelay, backoffDelay, throttleDelay);
  }
}
