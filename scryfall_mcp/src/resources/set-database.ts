import { ScryfallClient } from '../services/scryfall-client.js';
import { CacheService } from '../services/cache-service.js';
import { ScryfallSet } from '../types/scryfall-api.js';
import { ScryfallAPIError } from '../types/mcp-types.js';
import { mcpLogger } from '../services/logger.js';
import { filterSets } from '../utils/set-filters.js';

type SetSnapshotMetadata = {
  updatedAt: string;
  totalSets: number;
};

type CachedSetData = ScryfallSet[] | { data: ScryfallSet[] };

const SET_DATA_KEY = CacheService.createSetKey();
const SET_PAYLOAD_KEY = CacheService.createSetKey('serialized');
const SET_METADATA_KEY = CacheService.createSetKey('metadata');
const SET_LAST_UPDATE_KEY = CacheService.createSetKey('last_update');
const SET_STALE_DATA_KEY = CacheService.createSetKey('stale');
const SET_STALE_RETENTION_MS = 4 * 7 * 24 * 60 * 60 * 1000;

/**
 * MCP Resource for accessing set database
 */
export class SetDatabaseResource {
  readonly uri = 'set-database://all';
  readonly name = 'Set Database';
  readonly description = 'Complete Magic: The Gathering sets database with metadata and icons';
  readonly mimeType = 'application/json';

  private lastUpdateCheck = 0;
  private nextUpdateCheckAt = 0;
  private readonly updateCheckInterval = 7 * 24 * 60 * 60 * 1000; // 1 week
  private readonly refreshFailureRetryInterval = 5 * 60 * 1000; // 5 minutes
  private loadInFlight?: Promise<ScryfallSet[]>;

  constructor(
    private readonly scryfallClient: ScryfallClient,
    private readonly cache: CacheService
  ) {}

  /**
   * Gets the set database, checking for updates if needed
   */
  async getData(): Promise<string> {
    try {
      const now = Date.now();
      const cachedPayload = this.cache.getWithStats<string>(SET_PAYLOAD_KEY);

      if (now >= this.nextUpdateCheckAt) {
        this.lastUpdateCheck = now;

        if (this.isRefreshDue()) {
          try {
            const sets = await this.getSetDataModel(true);
            const payload = this.storeSerializedSnapshot(sets);
            this.nextUpdateCheckAt = Date.now() + this.updateCheckInterval;
            return payload;
          } catch (error) {
            this.nextUpdateCheckAt = Date.now() + this.refreshFailureRetryInterval;
            if (cachedPayload) {
              mcpLogger.warn(
                { operation: 'set_snapshot_refresh', error },
                'Serving stale set snapshot after refresh failure'
              );
              return cachedPayload;
            }

            throw error;
          }
        }

        this.nextUpdateCheckAt = now + this.updateCheckInterval;
      }

      if (cachedPayload) {
        return cachedPayload;
      }

      const sets = await this.getSetDataModel();
      return this.storeSerializedSnapshot(sets);

    } catch (error) {
      throw new ScryfallAPIError(
        `Failed to retrieve set database: ${error instanceof Error ? error.message : 'Unknown error'}`,
        500,
        'resource_error'
      );
    }
  }

  private async getSetDataModel(forceRefresh = false): Promise<ScryfallSet[]> {
    if (!forceRefresh) {
      const cached = this.cache.getWithStats<CachedSetData>(SET_DATA_KEY);
      if (cached) {
        return this.normalizeCachedSetData(cached);
      }
    }

    if (!this.loadInFlight) {
      this.loadInFlight = this.downloadSetData()
        .then((sets) => {
          this.cache.setWithType(SET_DATA_KEY, { data: sets }, 'set_data');
          return sets;
        })
        .finally(() => {
          this.loadInFlight = undefined;
        });
    }

    try {
      return await this.loadInFlight;
    } catch (error) {
      if (!forceRefresh) {
        const stale = this.cache.get<CachedSetData>(SET_STALE_DATA_KEY);
        if (stale) {
          mcpLogger.warn(
            { operation: 'set_model_refresh', error },
            'Serving stale set model after refresh failure'
          );
          return this.normalizeCachedSetData(stale);
        }
      }

      throw error;
    }
  }

  private normalizeCachedSetData(cached: CachedSetData): ScryfallSet[] {
    if (!Array.isArray(cached)) {
      return cached.data;
    }

    this.cache.setWithType(SET_DATA_KEY, { data: cached }, 'set_data');
    return cached;
  }

  private serializeSetPayload(
    sets: ScryfallSet[],
    updatedAt: string
  ): string {
    return JSON.stringify({
      object: 'list',
      type: 'sets',
      updated_at: updatedAt,
      total_sets: sets.length,
      data: sets
    });
  }

  private isRefreshDue(): boolean {
    const lastUpdate = this.cache.get<string>(SET_LAST_UPDATE_KEY);
    const weekAgo = new Date(Date.now() - this.updateCheckInterval).toISOString();
    return !lastUpdate || lastUpdate < weekAgo;
  }

  private storeSerializedSnapshot(sets: ScryfallSet[]): string {
    const updatedAt = new Date().toISOString();
    const payload = this.serializeSetPayload(sets, updatedAt);

    this.cache.set(SET_PAYLOAD_KEY, payload, SET_STALE_RETENTION_MS, { sizeBytes: payload.length * 2 });
    this.cache.set(SET_METADATA_KEY, {
      updatedAt,
      totalSets: sets.length,
    } satisfies SetSnapshotMetadata, SET_STALE_RETENTION_MS);
    this.cache.set(
      SET_STALE_DATA_KEY,
      { data: sets } satisfies Exclude<CachedSetData, ScryfallSet[]>,
      SET_STALE_RETENTION_MS
    );
    this.cache.set(SET_LAST_UPDATE_KEY, updatedAt, this.updateCheckInterval);

    return payload;
  }

  /**
   * Downloads fresh set data
   */
  private async downloadSetData(): Promise<ScryfallSet[]> {
    return this.scryfallClient.getSets();
  }

  /**
   * Gets sets filtered by criteria
   */
  async getFilteredSets(filters: {
    query?: string;
    type?: string;
    released_after?: string;
    released_before?: string;
    digital?: boolean;
  }): Promise<string> {
    const cacheKey = CacheService.createSetFilterKey({ ...filters, serialized: true });
    const cachedPayload = this.cache.getWithStats<string>(cacheKey);
    if (cachedPayload) {
      return cachedPayload;
    }

    const filteredSets = filterSets(await this.getSetDataModel(), filters);
    const payload = JSON.stringify({
      object: 'list',
      type: 'sets',
      total_sets: filteredSets.length,
      data: filteredSets,
      filters_applied: filters
    });

    this.cache.setWithType(cacheKey, payload, 'set_data', { sizeBytes: payload.length * 2 });
    return payload;
  }

  /**
   * Gets resource metadata
   */
  getMetadata() {
    const stats = this.cache.getStats();
    const ttl = this.cache.getTTL(SET_PAYLOAD_KEY);
    const snapshot = this.cache.get<SetSnapshotMetadata>(SET_METADATA_KEY);
    
    return {
      uri: this.uri,
      name: this.name,
      description: this.description,
      mimeType: this.mimeType,
      cache_stats: stats,
      cache_ttl_remaining: ttl,
      snapshot_updated_at: snapshot?.updatedAt,
      cached_total_sets: snapshot?.totalSets,
      last_update_check: new Date(this.lastUpdateCheck).toISOString(),
      next_update_check: new Date(this.nextUpdateCheckAt).toISOString()
    };
  }

  /**
   * Forces a refresh of the set data
   */
  async forceRefresh(): Promise<void> {
    if (this.loadInFlight) {
      try {
        await this.loadInFlight;
      } catch {
        // A force refresh still makes its own attempt after an in-flight failure.
      }
    }

    const now = Date.now();
    this.lastUpdateCheck = now;
    this.nextUpdateCheckAt = now + this.refreshFailureRetryInterval;

    try {
      const sets = await this.getSetDataModel(true);
      this.storeSerializedSnapshot(sets);
      this.nextUpdateCheckAt = Date.now() + this.updateCheckInterval;
    } catch (error) {
      throw new ScryfallAPIError(
        `Failed to refresh set database: ${error instanceof Error ? error.message : 'Unknown error'}`,
        500,
        'resource_error'
      );
    }
  }

  /**
   * Gets cache statistics
   */
  getCacheStats() {
    return this.cache.getStats();
  }

  /**
   * Gets available set types
   */
  async getSetTypes(): Promise<string[]> {
    const types = new Set<string>();
    (await this.getSetDataModel()).forEach(set => {
      types.add(set.set_type);
    });
    
    return Array.from(types).sort();
  }

  /**
   * Gets sets by release year
   */
  async getSetsByYear(year: number): Promise<string> {
    const startDate = `${year}-01-01`;
    const endDate = `${year}-12-31`;
    
    return this.getFilteredSets({
      released_after: startDate,
      released_before: endDate
    });
  }
}
