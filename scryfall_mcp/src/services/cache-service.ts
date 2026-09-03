import { CacheEntry, CACHE_DURATIONS } from '../types/mcp-types.js';
import { EnvValidators } from '../utils/env-parser.js';

export interface SearchCacheKeyParams {
  query: string;
  page?: number;
  limit?: number;
  unique?: string;
  direction?: string;
  include_multilingual?: boolean;
  include_variations?: boolean;
  include_extras?: boolean;
  order?: string;
}

/**
 * In-memory cache service with TTL support and size limits
 */
export class CacheService {
  private cache = new Map<string, CacheEntry<unknown>>();
  private cleanupInterval: NodeJS.Timeout;
  private readonly maxSize: number;
  private readonly maxMemoryBytes: number;
  private currentMemoryUsage = 0;

  constructor(
    private cleanupIntervalMs: number = 5 * 60 * 1000, // 5 minutes
    maxSize: number = EnvValidators.cacheMaxSize(process.env.CACHE_MAX_SIZE),
    maxMemoryMB: number = EnvValidators.cacheMaxMemoryMB(process.env.CACHE_MAX_MEMORY_MB)
  ) {
    this.maxSize = maxSize;
    this.maxMemoryBytes = maxMemoryMB * 1024 * 1024;
    
    // Start periodic cleanup
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, this.cleanupIntervalMs);
  }

  // Large object producers may pass sizeBytes when they already know the payload size
  // or can compute it cheaply. Smaller caches can keep using the generic fallback.
  /**
   * Gets a value from cache if it exists and hasn't expired
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return null;
    }

    const now = Date.now();
    if (now - entry.timestamp > entry.ttl) {
      this.currentMemoryUsage -= this.getEntrySize(key, entry);
      this.cache.delete(key);
      return null;
    }

    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.data as T;
  }

  /**
   * Sets a value in cache with TTL and enforces size limits
   */
  set<T>(key: string, value: T, ttl: number, options?: { sizeBytes?: number }): void {
    const now = Date.now();
    const entry: CacheEntry<T> = {
      data: value,
      timestamp: now,
      ttl,
      sizeBytes: options?.sizeBytes,
    };

    const entrySize = entry.sizeBytes ?? this.calculateEntrySize(key, entry);
    entry.sizeBytes = entrySize;

    if (entrySize > this.maxMemoryBytes) {
      return;
    }

    // Remove existing entry if updating
    const existingEntry = this.cache.get(key);
    if (existingEntry) {
      this.currentMemoryUsage -= this.getEntrySize(key, existingEntry);
      this.cache.delete(key);
    }

    this.evictToFit(entrySize);
    this.cache.set(key, entry);
    this.currentMemoryUsage += entrySize;
  }

  /**
   * Sets a value with predefined TTL based on data type
   */
  setWithType<T>(
    key: string,
    value: T,
    type: keyof typeof CACHE_DURATIONS,
    options?: { sizeBytes?: number }
  ): void {
    const ttl = CACHE_DURATIONS[type];
    this.set(key, value, ttl, options);
  }

  /**
   * Checks if a key exists and hasn't expired
   */
  has(key: string): boolean {
    return this.get(key) !== null;
  }

  /**
   * Deletes a specific key from cache
   */
  delete(key: string): boolean {
    const entry = this.cache.get(key);
    if (entry) {
      this.currentMemoryUsage -= this.getEntrySize(key, entry);
    }
    return this.cache.delete(key);
  }

  /**
   * Clears all cache entries
   */
  clear(): void {
    this.cache.clear();
    this.currentMemoryUsage = 0;
  }

  /**
   * Gets cache statistics
   */
  getStats(): {
    size: number;
    hitRate: number;
    memoryUsage: number;
    oldestEntry: number | null;
    newestEntry: number | null;
    maxSize: number;
    maxMemoryBytes: number;
    memoryUtilization: number;
    sizeUtilization: number;
  } {
    let oldestTimestamp: number | null = null;
    let newestTimestamp: number | null = null;

    for (const [, entry] of this.cache.entries()) {
      if (oldestTimestamp === null || entry.timestamp < oldestTimestamp) {
        oldestTimestamp = entry.timestamp;
      }
      if (newestTimestamp === null || entry.timestamp > newestTimestamp) {
        newestTimestamp = entry.timestamp;
      }
    }

    return {
      size: this.cache.size,
      hitRate: this.hitRate,
      memoryUsage: this.currentMemoryUsage,
      oldestEntry: oldestTimestamp,
      newestEntry: newestTimestamp,
      maxSize: this.maxSize,
      maxMemoryBytes: this.maxMemoryBytes,
      memoryUtilization: this.maxMemoryBytes > 0 ? this.currentMemoryUsage / this.maxMemoryBytes : 0,
      sizeUtilization: this.maxSize > 0 ? this.cache.size / this.maxSize : 0
    };
  }

  /**
   * Removes expired entries from cache
   */
  private cleanup(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => {
      const entry = this.cache.get(key);
      if (entry) {
        this.currentMemoryUsage -= this.getEntrySize(key, entry);
      }
      this.cache.delete(key);
    });
  }

  /**
   * Gets all keys matching a pattern
   */
  getKeysMatching(pattern: RegExp): string[] {
    return Array.from(this.cache.keys()).filter(key => pattern.test(key));
  }

  /**
   * Invalidates all cache entries matching a pattern
   */
  invalidatePattern(pattern: RegExp): number {
    const keysToDelete = this.getKeysMatching(pattern);
    for (const key of keysToDelete) {
      const entry = this.cache.get(key);
      if (entry) {
        this.currentMemoryUsage -= this.getEntrySize(key, entry);
      }
      this.cache.delete(key);
    }
    return keysToDelete.length;
  }

  /**
   * Gets the remaining TTL for a key in milliseconds
   */
  getTTL(key: string): number | null {
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }

    const elapsed = Date.now() - entry.timestamp;
    const remaining = entry.ttl - elapsed;
    
    return remaining > 0 ? remaining : 0;
  }

  /**
   * Updates the TTL for an existing key
   */
  updateTTL(key: string, newTtl: number): boolean {
    const entry = this.cache.get(key);
    if (!entry) {
      return false;
    }

    const now = Date.now();
    entry.ttl = newTtl;
    entry.timestamp = now; // Reset timestamp
    this.cache.delete(key);
    this.cache.set(key, entry);
    return true;
  }

  /**
   * Gets cache hit rate (requires tracking hits/misses)
   */
  private hitCount = 0;
  private missCount = 0;

  private get hitRate(): number {
    const total = this.hitCount + this.missCount;
    return total > 0 ? this.hitCount / total : 0;
  }

  /**
   * Enhanced get method that tracks hit/miss statistics
   */
  getWithStats<T>(key: string): T | null {
    const result = this.get<T>(key);
    
    if (result !== null) {
      this.hitCount++;
    } else {
      this.missCount++;
    }

    return result;
  }

  /**
   * Resets hit/miss statistics
   */
  resetStats(): void {
    this.hitCount = 0;
    this.missCount = 0;
  }

  /**
   * Removed legacy persistence helpers (export/import/preload) as unused
   */

  /**
   * Cleanup on service destruction
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.clear();
  }

  /**
   * Creates a cache key for search queries.
   *
   * Cache identity must include every input that changes the upstream Scryfall
   * search URL or returned result ordering. Build this from the normalized final
   * request, not from raw tool input.
   */
  static createSearchKey({
    query,
    page = 1,
    limit = 20,
    unique,
    direction,
    include_multilingual,
    include_variations,
    include_extras,
    order,
  }: SearchCacheKeyParams): string {
    const params = [query, page, limit];
    if (unique && unique !== 'cards') params.push(`unique:${unique}`);
    if (direction && direction !== 'auto') params.push(`dir:${direction}`);
    if (include_multilingual) params.push('multilingual');
    if (include_variations) params.push('variations');
    if (include_extras) params.push('extras');
    if (order) params.push(`order:${order}`);
    return `search:${params.join(':')}`;
  }

  /**
   * Creates a cache key for card details
   */
  static createCardKey(identifier: string, set?: string, lang = 'en', match = 'fuzzy'): string {
    return `card:${identifier}:${set || 'any'}:${lang}:${match}`;
  }

  /**
   * Creates a cache key for card prices
   */
  static createPriceKey(cardId: string, currency = 'usd'): string {
    return `price:${cardId}:${currency}`;
  }

  /**
   * Creates a cache key for sets
   */
  static createSetKey(query?: string, type?: string): string {
    return `sets:${query || 'all'}:${type || 'all'}`;
  }

  /**
   * Creates a cache key for filtered set views and serialized payloads
   */
  static createSetFilterKey(filters: {
    query?: string;
    type?: string;
    released_after?: string;
    released_before?: string;
    digital?: boolean;
    serialized?: boolean;
  }): string {
    return [
      'sets',
      filters.serialized ? 'serialized' : 'data',
      filters.query || 'all',
      filters.type || 'all',
      filters.released_after || 'any',
      filters.released_before || 'any',
      filters.digital === undefined ? 'both' : filters.digital ? 'digital' : 'paper',
    ].join(':');
  }

  /**
   * Creates a cache key for bulk data
   */
  static createBulkKey(type: string): string {
    return `bulk:${type}`;
  }

  /**
   * Calculates the approximate size of a cache entry in bytes
   */
  private calculateEntrySize(key: string, entry: CacheEntry<unknown>): number {
    const dataSize =
      typeof entry.data === 'string'
        ? entry.data.length * 2
        : this.estimateValueSize(entry.data);
    const keySize = key.length * 2;
    const metadataSize = 24; // timestamp (8) + ttl (8) + overhead (8)
    return dataSize + keySize + metadataSize;
  }

  private getEntrySize(key: string, entry: CacheEntry<unknown>): number {
    return entry.sizeBytes ?? this.calculateEntrySize(key, entry);
  }

  private estimateValueSize(value: unknown, seen = new Set<unknown>()): number {
    if (value === null || value === undefined) {
      return 0;
    }
    if (typeof value === 'string') {
      return value.length * 2;
    }
    if (typeof value === 'number' || typeof value === 'bigint') {
      return 8;
    }
    if (typeof value === 'boolean') {
      return 4;
    }
    if (typeof value !== 'object') {
      return 16;
    }
    if (seen.has(value)) {
      return 0;
    }

    seen.add(value);

    if (Array.isArray(value)) {
      return value.reduce((sum, item) => sum + this.estimateValueSize(item, seen), 0);
    }

    if (value instanceof Date) {
      return 16;
    }

    let total = 0;
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      total += childKey.length * 2;
      total += this.estimateValueSize(childValue, seen);
    }

    return total;
  }

  /**
   * Evicts least recently used entries until the new entry fits.
   */
  private evictToFit(requiredBytes: number): void {
    if (
      this.cache.size === 0 ||
      (this.cache.size < this.maxSize && this.currentMemoryUsage + requiredBytes <= this.maxMemoryBytes)
    ) {
      return;
    }

    while (
      this.cache.size > 0 &&
      (this.cache.size >= this.maxSize || this.currentMemoryUsage + requiredBytes > this.maxMemoryBytes)
    ) {
      const key = this.cache.keys().next().value as string | undefined;
      if (!key) {
        break;
      }
      const entry = this.cache.get(key);
      if (!entry) {
        break;
      }

      this.currentMemoryUsage -= this.getEntrySize(key, entry);
      this.cache.delete(key);
    }
  }
}
