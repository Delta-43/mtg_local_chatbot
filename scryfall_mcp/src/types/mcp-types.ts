import { z } from "zod";
import { MagicFormat, SET_TYPES } from "./scryfall-api.js";
import { DEFAULT_SCRYFALL_USER_AGENT } from "../version.js";
import {
  trimmedString,
  normalizedEnum
} from "../utils/input-normalization.js";

// Tool Parameter Schemas
export const SearchCardsParamsSchema = z.object({
  query: trimmedString(1, "Query cannot be empty"),
  limit: z.number().int().min(1).max(175).optional().default(20),
  page: z.number().int().min(1).optional().default(1),
  format: normalizedEnum(["json", "text"]).optional().default("text"),
  include_extras: z.boolean().optional().default(false),
  order: normalizedEnum([
    "name",
    "released",
    "cmc",
    "power",
    "toughness",
    "artist",
    "set",
    "rarity",
    "color",
    "usd",
    "eur",
    "tix",
    "edhrec",
    "penny",
    "review",
  ]).optional(),
  unique: normalizedEnum(["cards", "art", "prints"]).optional().default("cards"),
  direction: normalizedEnum(["asc", "desc", "auto"]).optional().default("auto"),
  include_multilingual: z.boolean().optional().default(false),
  include_variations: z.boolean().optional().default(false),
  price_range: z
    .object({
      min: z.number().min(0).optional(),
      max: z.number().min(0).optional(),
      currency: normalizedEnum(["usd", "eur", "tix"]).optional().default("usd"),
    })
    .optional(),
  arena_only: z.boolean().optional().default(false),
});

export const GetCardParamsSchema = z.object({
  identifier: trimmedString(1, "Identifier cannot be empty"),
  set: z.preprocess(
    (value) => typeof value === "string" ? value.trim().toLowerCase() : value,
    z.string().regex(/^[a-z0-9]{3,8}$/i, "Expected a 3-8 character set code")
  ).optional(),
  lang: z.preprocess((value) => typeof value === "string" ? value.trim().toLowerCase() : value, z.string().length(2)).optional().default("en"),
  face: normalizedEnum(["front", "back"]).optional(),
  include_image: z.boolean().optional().default(true),
});

// TypeScript interfaces derived from Zod schemas (defined later in file)

// Batch Card Analysis Parameters
export interface BatchCardAnalysisParams {
  card_list: string[];
  analysis_type: "legality" | "prices" | "synergy" | "composition" | "comprehensive";
  format?: MagicFormat;
  currency?: "usd" | "eur" | "tix";
  include_images?: boolean;
  include_suggestions?: boolean;
}

export const GetCardPricesParamsSchema = z.object({
  card_identifier: trimmedString(1, "Card identifier cannot be empty"),
  currency: normalizedEnum(["usd", "eur", "tix"]).optional().default("usd"),
  format_context: normalizedEnum(["standard", "modern", "legacy", "vintage", "commander", "pioneer"]).optional(),
  include_alternatives: z.boolean().optional().default(false),
  include_history: z.boolean().optional().default(false),
});

export const RandomCardParamsSchema = z.object({
  query: z.preprocess((value) => typeof value === "string" ? value.trim() : value, z.string()).optional(),
  format: normalizedEnum(["standard", "modern", "legacy", "vintage", "commander", "pioneer"]).optional(),
  archetype: normalizedEnum(["aggro", "control", "combo", "midrange", "ramp", "tribal"]).optional(),
  price_range: z
    .object({
      min: z.number().min(0).optional(),
      max: z.number().min(0).optional(),
      currency: normalizedEnum(["usd", "eur", "tix"]).optional().default("usd"),
    })
    .optional(),
  exclude_reprints: z.boolean().optional().default(false),
  similar_to: z.preprocess((value) => typeof value === "string" ? value.trim() : value, z.string()).optional(),
  rarity_preference: normalizedEnum(["common", "uncommon", "rare", "mythic"]).optional(),
});

export const SearchSetsParamsSchema = z.object({
  query: z.preprocess((value) => typeof value === "string" ? value.trim() : value, z.string()).optional(),
  type: normalizedEnum(SET_TYPES).optional(),
  released_after: z.preprocess(
    (value) => typeof value === "string" ? value.trim() : value,
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD date format")
  ).optional(),
  released_before: z.preprocess(
    (value) => typeof value === "string" ? value.trim() : value,
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD date format")
  ).optional(),
});

// Inferred Types
export type SearchCardsParams = z.infer<typeof SearchCardsParamsSchema>;
export type GetCardParams = z.infer<typeof GetCardParamsSchema>;
export type GetCardPricesParams = z.infer<typeof GetCardPricesParamsSchema>;
export type RandomCardParams = z.infer<typeof RandomCardParamsSchema>;
export type SearchSetsParams = z.infer<typeof SearchSetsParamsSchema>;

// Build Scryfall Query Parameters
export const BuildQueryParamsSchema = z.object({
  natural_query: trimmedString(1, "Natural query cannot be empty")
    .pipe(z.string().max(500, "Natural query too long (max 500 characters)")),

  format: normalizedEnum([
    "standard",
    "modern",
    "legacy",
    "vintage",
    "commander",
    "pioneer",
    "brawl",
    "pauper",
    "penny",
    "historic",
    "alchemy",
  ]).optional(),

  optimize_for: normalizedEnum(["precision", "recall", "discovery", "budget"]).default("precision"),

  max_results: z
    .number()
    .min(1, "Max results must be at least 1")
    .max(175, "Max results cannot exceed 175")
    .default(20),

  price_budget: z
    .object({
      max: z.number().min(0, "Price budget cannot be negative"),
      currency: normalizedEnum(["usd", "eur", "tix"]).default("usd"),
    })
    .optional(),

  include_alternatives: z.boolean().default(true),

  explain_mapping: z.boolean().default(true),

  test_query: z.boolean().default(false),
});

export type BuildQueryParams = z.infer<typeof BuildQueryParamsSchema>;

// Cache Configuration
export const CACHE_DURATIONS = {
  card_search: 30 * 60 * 1000, // 30 minutes
  card_details: 24 * 60 * 60 * 1000, // 24 hours
  card_prices: 6 * 60 * 60 * 1000, // 6 hours
  set_data: 7 * 24 * 60 * 60 * 1000, // 1 week
  bulk_data: 24 * 60 * 60 * 1000, // 24 hours
  rulings: 24 * 60 * 60 * 1000, // 24 hours -- rulings are appended to, rarely edited/removed
} as const;

// HTTP Client Configuration
export const REQUIRED_HEADERS = {
  "User-Agent": process.env.SCRYFALL_USER_AGENT || DEFAULT_SCRYFALL_USER_AGENT,
  Accept: "application/json",
  // Note: Accept-Encoding removed to avoid gzip parsing issues in Node.js
} as const;

// Rate Limiting Configuration (Scryfall requires 50-100ms between requests)
export const RATE_LIMIT_CONFIG = {
  minInterval: 100, // 100ms minimum between requests (10 requests per second max)
  maxRetries: 3,
  backoffMultiplier: 2,
  maxBackoffMs: 5000,
} as const;

// MCP Tool Definitions
export interface ToolDefinition {
  name: string;
  title?: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<
      string,
      {
        type: string;
        description?: string;
        enum?: string[];
        default?: unknown;
      }
    >;
    required?: string[];
  };
  annotations?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
}

// MCP Resource Definitions
export interface ResourceDefinition {
  uri: string;
  name: string;
  description: string;
  mimeType?: string;
  _meta?: Record<string, unknown>;
}

// MCP Prompt Definitions
export interface PromptDefinition {
  name: string;
  description: string;
  arguments?: Array<{
    name: string;
    description: string;
    required?: boolean;
  }>;
}

// Import MCPError for inheritance
import { MCPError } from "./mcp-errors.js";

// Error Types - Enhanced with structured logging support
export class ScryfallAPIError extends MCPError {
  public readonly apiCode?: string; // Scryfall-specific error code
  public readonly apiDetails?: string; // Scryfall-specific error details

  constructor(
    message: string,
    public status: number,
    apiCode?: string,
    apiDetails?: string,
    requestId?: string
  ) {
    super(
      message,
      apiCode || "SCRYFALL_API_ERROR",
      status,
      { status, apiCode, apiDetails },
      requestId
    );
    this.name = "ScryfallAPIError";
    this.apiCode = apiCode;
    this.apiDetails = apiDetails;
    Object.setPrototypeOf(this, ScryfallAPIError.prototype);
  }
}

export class RateLimitError extends MCPError {
  constructor(message: string, public retryAfter?: number, requestId?: string) {
    super(message, "RATE_LIMIT_ERROR", 429, { retryAfter }, requestId);
    this.name = "RateLimitError";
    Object.setPrototypeOf(this, RateLimitError.prototype);
  }
}

export class ValidationError extends MCPError {
  constructor(message: string, public field?: string, requestId?: string) {
    super(message, "VALIDATION_ERROR", 400, { field }, requestId);
    this.name = "ValidationError";
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

// Cache Entry Interface
export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
  sizeBytes?: number;
  lastAccessedAt?: number;
}

// Formatted Response Types
export interface FormattedCard {
  name: string;
  mana_cost?: string;
  type_line: string;
  oracle_text?: string;
  power?: string;
  toughness?: string;
  set_name: string;
  set: string;
  collector_number: string;
  arena_id?: number;
  rarity: string;
  prices: {
    usd?: string;
    eur?: string;
    tix?: string;
  };
  legalities: Record<string, string>;
  image_url?: string;
  color_identity?: string[];
  games?: string[];
}

export interface FormattedSearchResult {
  total_cards: number;
  has_more: boolean;
  cards: FormattedCard[];
  warnings?: string[];
  page_info?: {
    current_page: number;
    total_pages?: number;
    next_page?: string;
  };
}

export interface FormattedSet {
  name: string;
  code: string;
  type: string;
  released_at?: string;
  card_count: number;
  digital: boolean;
  icon_url: string;
}
