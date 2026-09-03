import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ScryfallClient } from '../services/scryfall-client.js';
import { CacheService } from '../services/cache-service.js';
import { BulkDataInfo, ScryfallCard } from '../types/scryfall-api.js';
import { ScryfallAPIError } from '../types/mcp-types.js';
import { mcpLogger } from '../services/logger.js';

type BulkSnapshotMetadata = {
  updatedAt: string;
  totalCards: number;
};

type BulkBuildDiagnostics = {
  totalCards: number;
  retainedChunks: number;
  payloadBytes: number;
  cached: boolean;
  oversizeReason?: string;
};

type DiskBulkSnapshot = {
  updatedAt: string;
  totalCards: number;
  payloadBytes: number;
  path: string;
};

const BULK_PAYLOAD_KEY = CacheService.createBulkKey('cards:serialized');
const BULK_METADATA_KEY = CacheService.createBulkKey('cards:metadata');

type SerializedSnapshotFile = {
  path: string;
  totalCards: number;
  payloadBytes: number;
};

/**
 * MCP Resource for accessing bulk card database
 */
export class CardDatabaseResource {
  readonly uri = 'card-database://bulk';
  readonly name = 'Card Database';
  readonly description = 'Complete Scryfall bulk card database with daily updates';
  readonly mimeType = 'application/json';

  private lastUpdateCheck = 0;
  private readonly updateCheckInterval = 24 * 60 * 60 * 1000; // 24 hours
  private rebuildInFlight?: Promise<string>;
  private diskSnapshot?: DiskBulkSnapshot;
  private readonly diskCacheDir = join(tmpdir(), 'scryfall-mcp');
  private lastBuildDiagnostics: BulkBuildDiagnostics = {
    totalCards: 0,
    retainedChunks: 0,
    payloadBytes: 0,
    cached: false,
  };

  constructor(
    private readonly scryfallClient: ScryfallClient,
    private readonly cache: CacheService
  ) {}

  /**
   * Gets the bulk card data, checking for updates if needed
   */
  async getData(): Promise<string> {
    try {
      const bulkInfo = await this.getBulkInfoIfUpdateCheckDue();
      const cachedPayload = this.cache.getWithStats<string>(BULK_PAYLOAD_KEY);
      const cachedMetadata = this.cache.get<BulkSnapshotMetadata>(BULK_METADATA_KEY);
      const diskPayload = await this.getDiskSnapshotIfCurrent(bulkInfo);
      const cachedIsCurrent = Boolean(
        cachedPayload &&
        cachedMetadata &&
        (!bulkInfo || cachedMetadata.updatedAt === bulkInfo.updated_at)
      );

      if (cachedPayload && cachedIsCurrent) {
        return cachedPayload;
      }

      if (diskPayload) {
        return diskPayload;
      }

      try {
        return await this.rebuildSerializedSnapshotOnce(bulkInfo);
      } catch (error) {
        if (cachedPayload) {
          mcpLogger.warn(
            { operation: 'bulk_snapshot_refresh', error },
            'Serving stale bulk snapshot after refresh failure'
          );
          return cachedPayload;
        }

        const staleDiskPayload = await this.getDiskSnapshotIfCurrent();
        if (staleDiskPayload) {
          mcpLogger.warn(
            { operation: 'bulk_snapshot_refresh', error },
            'Serving stale disk bulk snapshot after refresh failure'
          );
          return staleDiskPayload;
        }

        throw error;
      }
    } catch (error) {
      throw new ScryfallAPIError(
        `Failed to retrieve card database: ${error instanceof Error ? error.message : 'Unknown error'}`,
        500,
        'resource_error'
      );
    }
  }

  /**
   * Returns remote bulk metadata when the update check interval has elapsed.
   */
  private async getBulkInfoIfUpdateCheckDue(): Promise<BulkDataInfo | undefined> {
    const now = Date.now();
    if (now - this.lastUpdateCheck <= this.updateCheckInterval) {
      return undefined;
    }

    this.lastUpdateCheck = now;

    try {
      return await this.getOracleCardsBulkInfo();
    } catch (error) {
      mcpLogger.warn({ operation: 'bulk_update_check', error }, 'Failed to check for bulk data updates');
      return undefined;
    }
  }

  /**
   * Returns the oracle cards bulk metadata entry from Scryfall.
   */
  private async getOracleCardsBulkInfo(): Promise<BulkDataInfo> {
    const bulkDataInfo = await this.scryfallClient.getBulkDataInfo();
    const oracleCards = bulkDataInfo.find(item => item.type === 'oracle_cards');

    if (!oracleCards) {
      throw new Error('Oracle cards bulk data not found');
    }

    return oracleCards;
  }

  private rebuildSerializedSnapshotOnce(knownBulkInfo?: BulkDataInfo): Promise<string> {
    if (!this.rebuildInFlight) {
      this.rebuildInFlight = this.rebuildSerializedSnapshot(knownBulkInfo)
        .finally(() => {
          this.rebuildInFlight = undefined;
        });
    }

    return this.rebuildInFlight;
  }

  /**
   * Downloads fresh bulk card data and stores the serialized resource snapshot.
   */
  private async rebuildSerializedSnapshot(knownBulkInfo?: BulkDataInfo): Promise<string> {
    const oracleCards = knownBulkInfo ?? await this.getOracleCardsBulkInfo();
    const snapshotFile = await this.writeSerializedSnapshotFile(oracleCards);
    const payload = await readFile(snapshotFile.path, 'utf-8');
    const { totalCards, payloadBytes } = snapshotFile;
    const maxMemoryBytes = this.cache.getStats().maxMemoryBytes;

    this.lastBuildDiagnostics = {
      totalCards,
      retainedChunks: 0,
      payloadBytes,
      cached: false,
    };

    if (payloadBytes > maxMemoryBytes) {
      const oversizeReason = `Payload size ${payloadBytes} bytes exceeds cache memory limit ${maxMemoryBytes} bytes`;
      this.lastBuildDiagnostics = {
        ...this.lastBuildDiagnostics,
        oversizeReason,
      };
      mcpLogger.warn(
        {
          operation: 'bulk_snapshot_cache',
          payloadBytes,
          maxMemoryBytes,
          totalCards,
        },
        'Bulk snapshot exceeds in-memory cache limit'
      );
      await this.retainDiskSnapshot(snapshotFile.path, oracleCards.updated_at, totalCards, payloadBytes);
    } else {
      this.cache.setWithType(BULK_PAYLOAD_KEY, payload, 'bulk_data', { sizeBytes: payloadBytes });
      await this.clearDiskSnapshot();
      await this.deleteFile(snapshotFile.path);
      this.lastBuildDiagnostics = {
        ...this.lastBuildDiagnostics,
        cached: this.cache.get<string>(BULK_PAYLOAD_KEY) === payload,
      };
    }

    this.cache.setWithType(BULK_METADATA_KEY, {
      updatedAt: oracleCards.updated_at,
      totalCards,
    }, 'bulk_data');

    return payload;
  }

  private async writeSerializedSnapshotFile(oracleCards: BulkDataInfo): Promise<SerializedSnapshotFile> {
    await mkdir(this.diskCacheDir, { recursive: true });
    const safeUpdatedAt = oracleCards.updated_at.replace(/[^a-zA-Z0-9.-]/g, '-');
    const finalPath = join(this.diskCacheDir, `oracle-cards-${safeUpdatedAt}.json`);
    const tempPath = join(
      this.diskCacheDir,
      `oracle-cards-${safeUpdatedAt}-${process.pid}-${Date.now()}.tmp`
    );
    const handle = await open(tempPath, 'w');
    let totalCards = 0;
    let payloadChars = 0;
    let hasItems = false;

    const writePart = async (part: string): Promise<void> => {
      await handle.write(part, null, 'utf-8');
      payloadChars += part.length;
    };

    try {
      await writePart(
        `{"object":"bulk_data","type":"oracle_cards","updated_at":${JSON.stringify(oracleCards.updated_at)},"data":[`
      );

      for await (const card of this.scryfallClient.streamBulkData(oracleCards.download_uri)) {
        const serializedCard = JSON.stringify(this.filterCardFields(card));
        await writePart(`${hasItems ? ',' : ''}${serializedCard}`);
        hasItems = true;
        totalCards++;
      }

      await writePart(`],"total_cards":${totalCards}}`);
    } catch (error) {
      await handle.close().catch(() => undefined);
      await this.deleteFile(tempPath);
      throw error;
    }

    await handle.close();
    await rename(tempPath, finalPath);

    return {
      path: finalPath,
      totalCards,
      payloadBytes: payloadChars * 2,
    };
  }

  private async getDiskSnapshotIfCurrent(bulkInfo?: BulkDataInfo): Promise<string | undefined> {
    if (!this.diskSnapshot) {
      return undefined;
    }

    if (bulkInfo && this.diskSnapshot.updatedAt !== bulkInfo.updated_at) {
      return undefined;
    }

    try {
      return await readFile(this.diskSnapshot.path, 'utf-8');
    } catch (error) {
      mcpLogger.warn(
        { operation: 'bulk_snapshot_disk_cache', error },
        'Failed to read disk bulk snapshot'
      );
      this.diskSnapshot = undefined;
      return undefined;
    }
  }

  private async retainDiskSnapshot(
    path: string,
    updatedAt: string,
    totalCards: number,
    payloadBytes: number
  ): Promise<void> {
    await this.clearDiskSnapshot(path);
    this.diskSnapshot = { updatedAt, totalCards, payloadBytes, path };
  }

  private async clearDiskSnapshot(exceptPath?: string): Promise<void> {
    if (!this.diskSnapshot || this.diskSnapshot.path === exceptPath) {
      return;
    }

    const path = this.diskSnapshot.path;
    this.diskSnapshot = undefined;

    try {
      await unlink(path);
    } catch {
      // Best-effort cleanup of temp cache files.
    }
  }

  private async deleteFile(path: string): Promise<void> {
    try {
      await unlink(path);
    } catch {
      // Best-effort cleanup of temp cache files.
    }
  }

  /**
   * Filters card fields to reduce memory usage
   */
  private filterCardFields(card: ScryfallCard): ScryfallCard {
    // Keep only essential fields for most use cases
    const filtered: Partial<ScryfallCard> = {
      object: card.object,
      id: card.id,
      oracle_id: card.oracle_id,
      name: card.name,
      lang: card.lang,
      released_at: card.released_at,
      uri: card.uri,
      scryfall_uri: card.scryfall_uri,
      layout: card.layout,
      highres_image: card.highres_image,
      image_status: card.image_status,
      mana_cost: card.mana_cost,
      cmc: card.cmc,
      type_line: card.type_line,
      oracle_text: card.oracle_text,
      power: card.power,
      toughness: card.toughness,
      colors: card.colors,
      color_identity: card.color_identity,
      keywords: card.keywords,
      legalities: card.legalities,
      games: card.games,
      reserved: card.reserved,
      foil: card.foil,
      nonfoil: card.nonfoil,
      finishes: card.finishes,
      oversized: card.oversized,
      promo: card.promo,
      reprint: card.reprint,
      variation: card.variation,
      set_id: card.set_id,
      set: card.set,
      set_name: card.set_name,
      set_type: card.set_type,
      set_uri: card.set_uri,
      set_search_uri: card.set_search_uri,
      scryfall_set_uri: card.scryfall_set_uri,
      rulings_uri: card.rulings_uri,
      prints_search_uri: card.prints_search_uri,
      collector_number: card.collector_number,
      digital: card.digital,
      rarity: card.rarity,
      artist: card.artist,
      border_color: card.border_color,
      frame: card.frame,
      full_art: card.full_art,
      textless: card.textless,
      booster: card.booster,
      story_spotlight: card.story_spotlight,
      edhrec_rank: card.edhrec_rank,
      prices: card.prices,
      image_uris: card.image_uris,
      related_uris: card.related_uris,
      card_faces: card.card_faces
    };

    return filtered as ScryfallCard;
  }

  /**
   * Gets resource metadata
   */
  getMetadata() {
    const stats = this.cache.getStats();
    const ttl = this.cache.getTTL(BULK_PAYLOAD_KEY);
    
    return {
      uri: this.uri,
      name: this.name,
      description: this.description,
      mimeType: this.mimeType,
      cache_stats: stats,
      cache_ttl_remaining: ttl,
      last_build: this.lastBuildDiagnostics,
      last_update_check: new Date(this.lastUpdateCheck).toISOString(),
      next_update_check: new Date(this.lastUpdateCheck + this.updateCheckInterval).toISOString()
    };
  }

  /**
   * Forces a refresh of the bulk data
   */
  async forceRefresh(): Promise<void> {
    this.cache.delete(BULK_PAYLOAD_KEY);
    this.cache.delete(BULK_METADATA_KEY);
    await this.clearDiskSnapshot();
    this.lastUpdateCheck = 0;
    await this.getData(); // This will trigger a fresh download
  }

  async destroy(): Promise<void> {
    await this.clearDiskSnapshot();
  }

  /**
   * Gets cache statistics
   */
  getCacheStats() {
    return this.cache.getStats();
  }

  getLastBuildDiagnostics(): BulkBuildDiagnostics {
    return this.lastBuildDiagnostics;
  }
}
