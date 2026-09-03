// HTTP client for Scryfall API
import {
  ScryfallCard,
  ScryfallSearchResponse,
  ScryfallSet,
  ScryfallError,
  BulkDataInfo,
  ScryfallListResponse,
  ScryfallRuling,
} from "../types/scryfall-api.js";
import { REQUIRED_HEADERS, ScryfallAPIError, RateLimitError } from "../types/mcp-types.js";
import { RateLimiter } from "./rate-limiter.js";
import { CacheService } from "./cache-service.js";
import { mcpLogger } from "./logger.js";
import { generateRequestId } from "../types/mcp-errors.js";
import { EnvValidators } from "../utils/env-parser.js";
import { filterSets } from "../utils/set-filters.js";
import { iterateArrayStream } from "./bulk-json-stream.js";
import { createSearchWindowCollector } from "./search-window.js";

export interface CardLookupParams {
  identifier: string;
  set?: string;
  lang?: string;
  face?: "front" | "back";
  /**
   * Use exact for known deck-list names. Use fuzzy for discovery-oriented
   * user input. Cache and in-flight identity must include this mode.
   */
  match?: "fuzzy" | "exact";
}

interface SearchCardsParams {
  query: string;
  limit?: number;
  page?: number;
  include_extras?: boolean;
  order?: string;
  unique?: string;
  direction?: string;
  include_multilingual?: boolean;
  include_variations?: boolean;
  price_range?: {
    min?: number;
    max?: number;
    currency?: string;
  };
}

interface NormalizedSearchRequest {
  query: string;
  requestedPage: number;
  requestedLimit: number;
  include_extras?: boolean;
  order?: string;
  unique?: string;
  direction?: string;
  include_multilingual?: boolean;
  include_variations?: boolean;
}

export function canonicalCardCacheKey(params: CardLookupParams): string {
  const canonicalIdentifier = params.identifier.trim().toLowerCase();
  const set = params.set?.trim().toLowerCase();
  const lang = params.lang?.trim().toLowerCase();
  const match = params.match ?? "fuzzy";

  return CacheService.createCardKey(canonicalIdentifier, set, lang || "en", match);
}

/**
 * HTTP client for Scryfall API with rate limiting and caching
 */
export class ScryfallClient {
  private readonly baseUrl = "https://api.scryfall.com";
  private readonly searchApiPageSize = 175;
  private readonly inFlightCardLookups = new Map<string, Promise<ScryfallCard>>();
  private readonly inFlightSearches = new Map<string, Promise<ScryfallSearchResponse>>();
  private rateLimiter: RateLimiter;
  private cache: CacheService;
  private readonly ownsRateLimiter: boolean;
  private readonly ownsCache: boolean;
  private readonly timeoutMs = () =>
    EnvValidators.scryfallTimeoutMs(process.env.SCRYFALL_TIMEOUT_MS);

  constructor(
    rateLimiter?: RateLimiter,
    cache?: CacheService,
    private userAgent: string = EnvValidators.userAgent(process.env.SCRYFALL_USER_AGENT)
  ) {
    this.ownsRateLimiter = !rateLimiter;
    this.ownsCache = !cache;
    this.rateLimiter = rateLimiter || new RateLimiter();
    this.cache = cache || new CacheService();
  }

  /**
   * Makes a rate-limited HTTP request to Scryfall API with structured logging
   */
  private async makeRequest<T = unknown>(url: string, requestId?: string): Promise<T> {
    const reqId = requestId || generateRequestId();
    const startTime = Date.now();

    mcpLogger.debug(
      { requestId: reqId, url, operation: "scryfall_request" },
      "Scryfall API request started"
    );
    return this.rateLimiter.execute(async () => {
      // Check circuit breaker immediately before the request starts.
      this.assertCircuitClosed(url, reqId);

      try {
        const { response, data } = await this.fetchJsonResponse<T>(url);

        if (response.status >= 400) {
          throw await this.buildHttpError(response, data, url, reqId);
        }

        this.rateLimiter.recordSuccess();
        this.logRequestCompletion(url, reqId, response.status, startTime);

        return data;
      } catch (error) {
        if (error instanceof ScryfallAPIError || error instanceof RateLimitError) {
          throw error;
        }

        throw this.buildNetworkError(error, url, reqId);
      }
    }, {
      minIntervalMs: this.getMinimumRequestIntervalMs(url),
    });
  }

  private getMinimumRequestIntervalMs(url: string): number | undefined {
    const twoPerSecondPaths = new Set([
      "/cards/search",
      "/cards/named",
      "/cards/random",
      "/cards/collection",
    ]);

    try {
      const parsedUrl = new URL(url);
      return twoPerSecondPaths.has(parsedUrl.pathname) ? 500 : undefined;
    } catch {
      return undefined;
    }
  }

  private assertCircuitClosed(url: string, requestId: string): void {
    if (!this.rateLimiter.isCircuitOpen()) {
      return;
    }

    const error = new ScryfallAPIError(
      "Circuit breaker is open due to consecutive failures",
      503,
      "circuit_breaker_open"
    );
    mcpLogger.error(
      {
        requestId,
        url,
        error,
        operation: "scryfall_request",
      },
      "Circuit breaker is open"
    );
    throw error;
  }

  private async fetchJsonResponse<T>(url: string): Promise<{ response: Response; data: T }> {
    return this.fetchWithTimeout(url, {
      ...REQUIRED_HEADERS,
      "User-Agent": this.userAgent,
    }, async (response) => ({
      response,
      data: await this.parseJsonResponse<T>(response),
    }));
  }

  private async fetchWithTimeout<T>(
    url: string,
    headers: Record<string, string>,
    consume: (response: Response) => Promise<T>,
    timeoutMs = this.timeoutMs()
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        headers,
        signal: controller.signal,
      });
      return await consume(response);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async parseJsonResponse<T>(response: Response): Promise<T> {
    try {
      return await response.json() as T;
    } catch (jsonError) {
      if (jsonError instanceof Error && jsonError.name === "AbortError") {
        throw jsonError;
      }

      const originalError = jsonError instanceof Error ? jsonError.message : "Unknown JSON error";

      throw new Error(
        `Failed to parse JSON response. Original error: ${originalError}.`
      );
    }
  }

  private async buildHttpError(
    response: Response,
    data: unknown,
    url: string,
    requestId: string
  ): Promise<ScryfallAPIError | RateLimitError> {
    if (this.shouldRecordHttpError(response.status)) {
      this.rateLimiter.recordError(response.status);
    } else {
      // A delivered non-transient response proves the upstream service is
      // reachable, even though the caller's request was unsuccessful.
      this.rateLimiter.recordSuccess();
    }

    if (response.status === 429) {
      const retryAfter = response.headers.get("retry-after");
      this.rateLimiter.handleRateLimitResponse(retryAfter || undefined);
      const rateLimitError = new RateLimitError(
        "Rate limit exceeded",
        retryAfter ? parseInt(retryAfter, 10) : undefined
      );
      mcpLogger.warn(
        {
          requestId,
          url,
          status: response.status,
          retryAfter,
          operation: "scryfall_request",
        },
        "Rate limit exceeded"
      );
      return rateLimitError;
    }

    const error = data as ScryfallError;
    const apiError = new ScryfallAPIError(
      error.details || `HTTP ${response.status}`,
      response.status,
      error.code,
      error.details
    );
    mcpLogger.error(
      {
        requestId,
        url,
        status: response.status,
        error: apiError,
        operation: "scryfall_request",
      },
      "Scryfall API error"
    );
    return apiError;
  }

  private shouldRecordHttpError(status: number): boolean {
    return status === 429 || status >= 500;
  }

  private buildNetworkError(error: unknown, url: string, requestId: string): ScryfallAPIError {
    this.rateLimiter.recordError();
    const isAbort = error instanceof Error && error.name === "AbortError";
    const networkError = new ScryfallAPIError(
      `Network error: ${error instanceof Error ? error.message : "Unknown error"}`,
      0,
      isAbort ? "timeout" : "network_error"
    );
    mcpLogger.error(
      {
        requestId,
        url,
        error: networkError,
        originalError: error instanceof Error ? error.message : String(error),
        operation: "scryfall_request",
      },
      "Network error during Scryfall request"
    );
    return networkError;
  }

  private logRequestCompletion(
    url: string,
    requestId: string,
    status: number,
    startTime: number
  ): void {
    const duration = Date.now() - startTime;
    mcpLogger.debug(
      {
        requestId,
        url,
        status,
        duration,
        operation: "scryfall_request",
      },
      "Scryfall API request completed"
    );
  }

  /**
   * Searches for cards using Scryfall search syntax
   */
  async searchCards(
    params: SearchCardsParams,
    requestId?: string
  ): Promise<ScryfallSearchResponse> {
    const reqId = requestId || generateRequestId();
    const searchRequest = this.normalizeSearchRequest(params);
    const cacheKey = CacheService.createSearchKey({
      query: searchRequest.query,
      page: searchRequest.requestedPage,
      limit: searchRequest.requestedLimit,
      unique: searchRequest.unique,
      direction: searchRequest.direction,
      include_multilingual: searchRequest.include_multilingual,
      include_variations: searchRequest.include_variations,
      include_extras: searchRequest.include_extras,
      order: searchRequest.order,
    });

    mcpLogger.debug(
      {
        requestId: reqId,
        operation: "search_cards",
        query: searchRequest.query,
        page: searchRequest.requestedPage,
        limit: searchRequest.requestedLimit,
      },
      "Card search started"
    );

    // Check cache first
    const cached = this.cache.getWithStats<ScryfallSearchResponse>(cacheKey);
    if (cached) {
      mcpLogger.debug(
        { requestId: reqId, operation: "search_cards", cacheHit: true },
        "Card search cache hit"
      );
      return cached;
    }

    const inFlight = this.inFlightSearches.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const searchPromise = this.fetchSearchResult(searchRequest, cacheKey, reqId)
      .finally(() => {
        this.inFlightSearches.delete(cacheKey);
      });
    this.inFlightSearches.set(cacheKey, searchPromise);

    return searchPromise;
  }

  private async fetchSearchResult(
    searchRequest: NormalizedSearchRequest,
    cacheKey: string,
    reqId: string
  ): Promise<ScryfallSearchResponse> {
    const requestedOffset = (searchRequest.requestedPage - 1) * searchRequest.requestedLimit;
    const startingApiPage = Math.floor(requestedOffset / this.searchApiPageSize) + 1;
    const relativeOffset = requestedOffset - ((startingApiPage - 1) * this.searchApiPageSize);

    const searchPageParams = {
      query: searchRequest.query,
      include_extras: searchRequest.include_extras,
      order: searchRequest.order,
      unique: searchRequest.unique,
      direction: searchRequest.direction,
      include_multilingual: searchRequest.include_multilingual,
      include_variations: searchRequest.include_variations,
    };

    const firstPage = await this.fetchSearchPage(searchPageParams, startingApiPage, reqId);
    const totalCards = firstPage.total_cards ?? firstPage.data.length;
    const requiredCount = Math.max(0, Math.min(searchRequest.requestedLimit, totalCards - requestedOffset));
    let fetchedCards = firstPage.data.length;
    const collector = createSearchWindowCollector<ScryfallCard>(relativeOffset, requiredCount);
    collector.addPage(firstPage);
    let currentPage = firstPage;
    let nextApiPage = startingApiPage + 1;

    while (
      !collector.isComplete() &&
      fetchedCards < relativeOffset + requiredCount &&
      currentPage.has_more
    ) {
      currentPage = await this.fetchSearchPage(searchPageParams, nextApiPage, reqId);
      collector.addPage(currentPage);
      fetchedCards += currentPage.data.length;
      nextApiPage++;
    }

    const window = collector.finish();
    const data: ScryfallSearchResponse = {
      object: firstPage.object,
      total_cards: totalCards,
      has_more: requestedOffset + window.data.length < totalCards,
      data: window.data,
      warnings: window.warnings,
    };

    // Cache the result
    this.cache.setWithType(cacheKey, data, "card_search");
    mcpLogger.debug(
      { requestId: reqId, operation: "search_cards", resultCount: data.data?.length },
      "Card search completed"
    );

    return data;
  }

  private normalizeSearchRequest(params: SearchCardsParams): NormalizedSearchRequest {
    const queryParts = [params.query];
    if (params.price_range) {
      const currency = params.price_range.currency || "usd";
      if (params.price_range.min !== undefined) {
        queryParts.push(`${currency}>=${params.price_range.min}`);
      }
      if (params.price_range.max !== undefined) {
        queryParts.push(`${currency}<=${params.price_range.max}`);
      }
    }

    return {
      query: queryParts.join(" "),
      requestedPage: params.page || 1,
      requestedLimit: params.limit || 20,
      include_extras: params.include_extras,
      order: params.order,
      unique: params.unique,
      direction: params.direction,
      include_multilingual: params.include_multilingual,
      include_variations: params.include_variations,
    };
  }

  private async fetchSearchPage(
    params: {
      query: string;
      include_extras?: boolean;
      order?: string;
      unique?: string;
      direction?: string;
      include_multilingual?: boolean;
      include_variations?: boolean;
    },
    apiPage: number,
    requestId: string
  ): Promise<ScryfallSearchResponse> {
    const url = new URL(`${this.baseUrl}/cards/search`);
    url.searchParams.set("q", params.query);

    if (apiPage > 1) {
      url.searchParams.set("page", apiPage.toString());
    }
    if (params.include_extras) {
      url.searchParams.set("include_extras", "true");
    }
    if (params.include_multilingual) {
      url.searchParams.set("include_multilingual", "true");
    }
    if (params.include_variations) {
      url.searchParams.set("include_variations", "true");
    }
    if (params.order) {
      url.searchParams.set("order", params.order);
    }
    if (params.unique && params.unique !== "cards") {
      url.searchParams.set("unique", params.unique);
    }
    if (params.direction && params.direction !== "auto") {
      url.searchParams.set("dir", params.direction);
    }

    return this.makeRequest<ScryfallSearchResponse>(url.toString(), requestId);
  }

  /**
   * Gets a card by name, set code+number, or Scryfall ID
   */
  async getCard(params: CardLookupParams): Promise<ScryfallCard> {
    const normalizedParams = this.normalizeCardLookupParams(params);
    const cacheKey = canonicalCardCacheKey(normalizedParams);

    // Check cache first
    const cached = this.cache.getWithStats<ScryfallCard>(cacheKey);
    if (cached) {
      return cached;
    }

    const inFlight = this.inFlightCardLookups.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const lookupPromise = this.fetchCard(normalizedParams)
      .then((data) => {
        // Cache the result
        this.cache.setWithType(cacheKey, data, "card_details");
        return data;
      })
      .finally(() => {
        this.inFlightCardLookups.delete(cacheKey);
      });

    this.inFlightCardLookups.set(cacheKey, lookupPromise);

    return lookupPromise;
  }

  private normalizeCardLookupParams(params: CardLookupParams): CardLookupParams {
    return {
      ...params,
      identifier: params.identifier.trim(),
      set: params.set?.trim().toLowerCase(),
      lang: params.lang?.trim().toLowerCase() || "en",
      match: params.match ?? "fuzzy",
    };
  }

  private async fetchCard(params: CardLookupParams): Promise<ScryfallCard> {
    let url: URL;

    // Check if identifier is a UUID (Scryfall ID)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(params.identifier)) {
      url = new URL(`${this.baseUrl}/cards/${params.identifier}`);
    }
    // Check if identifier is set code + collector number
    else if (/^[a-z0-9]{3,8}\/[^\s/]+$/i.test(params.identifier)) {
      const [setCode, collectorNumber] = params.identifier.split("/");
      url = new URL(`${this.baseUrl}/cards/${setCode}/${collectorNumber}`);
    }
    // Otherwise treat as card name
    else {
      url = new URL(`${this.baseUrl}/cards/named`);
      url.searchParams.set(params.match === "exact" ? "exact" : "fuzzy", params.identifier);
      if (params.set) {
        url.searchParams.set("set", params.set);
      }
    }

    if (params.lang && params.lang !== "en") {
      url.searchParams.set("lang", params.lang);
    }

    return this.makeRequest<ScryfallCard>(url.toString());
  }

  /**
   * Gets official rulings for a card, resolved the same way getCard() resolves
   * its identifier (name, set/collector-number, or Scryfall ID). See
   * https://scryfall.com/docs/api/rulings.
   */
  async getCardRulings(
    params: CardLookupParams
  ): Promise<{ card: ScryfallCard; rulings: ScryfallRuling[] }> {
    const card = await this.getCard(params);
    const cacheKey = `rulings:${card.id}`;

    const cached = this.cache.getWithStats<ScryfallRuling[]>(cacheKey);
    if (cached) {
      return { card, rulings: cached };
    }

    const response = await this.makeRequest<ScryfallListResponse<ScryfallRuling>>(
      card.rulings_uri
    );
    this.cache.setWithType(cacheKey, response.data, "rulings");
    return { card, rulings: response.data };
  }

  /**
   * Gets a random card with optional filters
   */
  async getRandomCard(query?: string): Promise<ScryfallCard> {
    const url = new URL(`${this.baseUrl}/cards/random`);
    if (query) {
      url.searchParams.set("q", query);
    }

    // Don't cache random cards as they should be different each time
    return this.makeRequest<ScryfallCard>(url.toString());
  }

  /**
   * Gets all Magic sets
   */
  async getSets(params?: {
    query?: string;
    type?: string;
    released_after?: string;
    released_before?: string;
    digital?: boolean;
  }): Promise<ScryfallSet[]> {
    const rawSetsKey = CacheService.createSetKey();

    const cachedRaw = this.cache.getWithStats<{ data: ScryfallSet[] } | ScryfallSet[]>(rawSetsKey);
    const cachedSets = cachedRaw
      ? Array.isArray(cachedRaw) ? cachedRaw : cachedRaw.data
      : undefined;
    const allSets = cachedSets ?? (
      await this.makeRequest<ScryfallListResponse<ScryfallSet>>(`${this.baseUrl}/sets`)
    ).data;

    if (!cachedRaw || Array.isArray(cachedRaw)) {
      this.cache.setWithType(rawSetsKey, { data: allSets }, "set_data");
    }

    const filters = params ?? {};
    if (Object.values(filters).every((value) => value === undefined)) {
      return allSets;
    }

    const filteredKey = CacheService.createSetFilterKey(filters);
    const cachedFiltered = this.cache.getWithStats<ScryfallSet[]>(filteredKey);
    if (cachedFiltered) {
      return cachedFiltered;
    }

    const filteredSets = filterSets(allSets, filters);
    this.cache.setWithType(filteredKey, filteredSets, "set_data");
    return filteredSets;
  }

  /**
   * Gets bulk card data information
   */
  async getBulkDataInfo(): Promise<BulkDataInfo[]> {
    const cacheKey = CacheService.createBulkKey("info");

    // Check cache first
    const cached = this.cache.getWithStats<{ data: BulkDataInfo[] }>(cacheKey);
    if (cached) {
      return cached.data;
    }

    const url = `${this.baseUrl}/bulk-data`;
    const data = await this.makeRequest<ScryfallListResponse<BulkDataInfo>>(url);

    // Cache bulk data info
    this.cache.setWithType(cacheKey, data, "bulk_data");

    return data.data;
  }

  /**
   * Downloads bulk card data (doesn't count against rate limits)
   */
  async downloadBulkData(downloadUri: string): Promise<ScryfallCard[]> {
    try {
      const response = await this.fetchWithTimeout(
        downloadUri,
        { "User-Agent": this.userAgent },
        async (bulkResponse) => {
          if (bulkResponse.status >= 400) {
            throw new ScryfallAPIError(
              `Failed to download bulk data: HTTP ${bulkResponse.status}`,
              bulkResponse.status
            );
          }

          return (await bulkResponse.json()) as ScryfallCard[];
        },
        this.timeoutMs() * 2
      );
      return response;
    } catch (error) {
      throw new ScryfallAPIError(
        `Bulk data download error: ${error instanceof Error ? error.message : "Unknown error"}`,
        0,
        (error instanceof Error && error.name === 'AbortError') ? "timeout" : "bulk_download_error"
      );
    }
  }

  /**
   * Streams bulk card data (doesn't count against rate limits)
   */
  async *streamBulkData(downloadUri: string): AsyncGenerator<ScryfallCard> {
    const controller = new AbortController();
    let timeout: NodeJS.Timeout | undefined;
    const armIdleTimeout = () => {
      if (timeout) {
        clearTimeout(timeout);
      }
      timeout = setTimeout(() => controller.abort(), this.timeoutMs() * 2);
    };

    try {
      armIdleTimeout();
      const response = await fetch(downloadUri, {
        headers: { "User-Agent": this.userAgent },
        signal: controller.signal,
      });

      if (response.status >= 400 || !response.body) {
        throw new ScryfallAPIError(
          `Failed to download bulk data: HTTP ${response.status}`,
          response.status
        );
      }

      for await (const card of iterateArrayStream<ScryfallCard>(response.body)) {
        if (timeout) {
          clearTimeout(timeout);
          timeout = undefined;
        }
        yield card;
        armIdleTimeout();
      }
    } catch (error) {
      if (error instanceof ScryfallAPIError) {
        throw error;
      }

      throw new ScryfallAPIError(
        `Bulk data download error: ${error instanceof Error ? error.message : "Unknown error"}`,
        0,
        (error instanceof Error && error.name === 'AbortError') ? "timeout" : "bulk_download_error"
      );
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
      controller.abort();
    }
  }

  /**
   * Clears all cached data
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Resets rate limiter state
   */
  resetRateLimiter(): void {
    this.rateLimiter.reset();
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.inFlightCardLookups.clear();
    this.inFlightSearches.clear();

    if (this.ownsCache) {
      this.cache.destroy();
    }

    if (this.ownsRateLimiter) {
      this.rateLimiter.reset();
    }
  }
}
