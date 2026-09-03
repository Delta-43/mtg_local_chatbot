import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ScryfallClient } from "./services/scryfall-client.js";
import { RateLimiter } from "./services/rate-limiter.js";
import { CacheService } from "./services/cache-service.js";
import { mcpLogger, ErrorMonitor } from "./services/logger.js";
import {
  ToolExecutionError,
  ResourceError,
  PromptError,
  generateRequestId,
  wrapError,
} from "./types/mcp-errors.js";
import {
  createNamedRegistry,
  createUriRegistry,
  PromptContract,
  ResourceContract,
  ToolContract,
} from "./types/mcp-registry.js";
import { EnvValidators } from "./utils/env-parser.js";
import { APP_VERSION } from "./version.js";

// Tools
import { SearchCardsTool } from "./tools/search-cards.js";
import { GetCardTool } from "./tools/get-card.js";
import { GetCardRulingsTool } from "./tools/get-card-rulings.js";
import { GetCardPricesTool } from "./tools/get-card-prices.js";
import { RandomCardTool } from "./tools/random-card.js";
import { SearchSetsTool } from "./tools/search-sets.js";
import { QueryRulesTool } from "./tools/query-rules.js";
import { SearchFormatStaplesTool } from "./tools/search-format-staples.js";
import { SearchAlternativesTool } from "./tools/search-alternatives.js";
import { FindSynergisticCardsTool } from "./tools/find-synergistic-cards.js";
import { BatchCardAnalysisTool } from "./tools/batch-card-analysis.js";
import { ValidateBrawlCommanderTool } from "./tools/validate-brawl-commander.js";
import { BuildScryfallQueryTool } from "./tools/build-scryfall-query.js";
import { AnalyzeDeckCompositionTool } from "./tools/analyze-deck-composition.js";
import { SuggestManaBaseTool } from "./tools/suggest-mana-base.js";
import { ShowCardSearchTool } from "./tools/show-card-search.js";

// Resources
import { CardDatabaseResource } from "./resources/card-database.js";
import { SetDatabaseResource } from "./resources/set-database.js";
import { CardSearchWidgetResource } from "./resources/card-search-widget.js";

// Prompts
import { AnalyzeCardPrompt } from "./prompts/analyze-card.js";
import { BuildDeckPrompt } from "./prompts/build-deck.js";

export const MCP_SERVER_INFO = {
  name: "scryfall-mcp-server",
  version: APP_VERSION,
} as const;

export const MCP_SERVER_CAPABILITIES = {
  tools: {},
  resources: {},
  prompts: {},
} as const;

export function createSdkServer(
  serverInfo: { name: string; version: string } = MCP_SERVER_INFO
): Server {
  return new Server(serverInfo, {
    capabilities: {
      ...MCP_SERVER_CAPABILITIES,
    },
  });
}

export async function createConfiguredServer(
  serverInfo: { name: string; version: string } = MCP_SERVER_INFO
): Promise<{ sdkServer: Server; appServer: ScryfallMCPServer }> {
  const sdkServer = createSdkServer(serverInfo);
  const appServer = new ScryfallMCPServer();
  await appServer.setupHandlers(sdkServer);

  return { sdkServer, appServer };
}

/**
 * Main MCP Server for Scryfall integration
 */
export class ScryfallMCPServer {
  private readonly scryfallClient: ScryfallClient;
  private readonly rateLimiter: RateLimiter;
  private readonly cache: CacheService;
  private readonly tools: Map<string, ToolContract>;
  private readonly resources: Map<string, ResourceContract>;
  private readonly prompts: Map<string, PromptContract>;

  constructor() {
    // Initialize core services
    this.rateLimiter = new RateLimiter();
    this.cache = new CacheService();
    this.scryfallClient = new ScryfallClient(this.rateLimiter, this.cache);

    this.tools = createNamedRegistry<ToolContract>([
      new SearchCardsTool(this.scryfallClient),
      new GetCardTool(this.scryfallClient),
      new GetCardRulingsTool(this.scryfallClient),
      new GetCardPricesTool(this.scryfallClient),
      new RandomCardTool(this.scryfallClient),
      new SearchSetsTool(this.scryfallClient),
      new QueryRulesTool(),
      new SearchFormatStaplesTool(this.scryfallClient),
      new SearchAlternativesTool(this.scryfallClient),
      new FindSynergisticCardsTool(this.scryfallClient),
      new BatchCardAnalysisTool(this.scryfallClient),
      new ValidateBrawlCommanderTool(this.scryfallClient),
      new BuildScryfallQueryTool(this.scryfallClient),
      new AnalyzeDeckCompositionTool(this.scryfallClient),
      new SuggestManaBaseTool(this.scryfallClient),
      new ShowCardSearchTool(this.scryfallClient),
    ]);

    this.resources = createUriRegistry<ResourceContract>([
      new CardDatabaseResource(this.scryfallClient, this.cache),
      new SetDatabaseResource(this.scryfallClient, this.cache),
      new CardSearchWidgetResource(),
    ]);

    this.prompts = createNamedRegistry<PromptContract>([
      new AnalyzeCardPrompt(this.scryfallClient),
      new BuildDeckPrompt(this.scryfallClient),
    ]);
  }

  async setupHandlers(server: Server) {
    // List available tools
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: Array.from(this.tools.values()).map((tool) => ({
          name: tool.name,
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: tool.annotations,
          _meta: tool._meta,
        })),
      };
    });

    // Execute tools
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const requestId = generateRequestId();
      const tool = this.tools.get(name);

      mcpLogger.toolStart(requestId, name, args);

      if (!tool) {
        const error = new ToolExecutionError(
          name,
          new Error("Tool not found"),
          { args },
          requestId
        );
        mcpLogger.toolError(requestId, name, error, args);
        throw error;
      }

      try {
        const result = await tool.execute(args);
        mcpLogger.toolComplete(requestId, name);
        return result;
      } catch (error) {
        const toolError =
          error instanceof Error
            ? new ToolExecutionError(name, error, { args }, requestId)
            : wrapError(error, `Tool execution: ${name}`, requestId);

        ErrorMonitor.trackError(toolError.code, requestId);
        mcpLogger.toolError(requestId, name, toolError, args);
        throw toolError;
      }
    });

    // List resources
    server.setRequestHandler(ListResourcesRequestSchema, async () => {
      return {
        resources: Array.from(this.resources.values()).map((resource) => ({
          uri: resource.uri,
          name: resource.name,
          description: resource.description,
          mimeType: resource.mimeType,
          _meta: resource._meta,
        })),
      };
    });

    // Read resources
    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;
      const requestId = generateRequestId();
      const resource = this.resources.get(uri);

      mcpLogger.request(requestId, "read_resource", { resourceUri: uri });

      if (!resource) {
        const error = new ResourceError(
          uri,
          "read",
          new Error("Resource not found"),
          {},
          requestId
        );
        mcpLogger.error({ requestId, resourceUri: uri, error }, "Resource not found");
        throw error;
      }

      try {
        const data = await resource.getData();
        mcpLogger.info({ requestId, resourceUri: uri }, "Resource read completed");
        return {
          contents: [
            {
              uri,
              mimeType: resource.mimeType,
              text: data,
              _meta: resource._meta,
            },
          ],
        };
      } catch (error) {
        const resourceError =
          error instanceof Error
            ? new ResourceError(uri, "read", error, {}, requestId)
            : wrapError(error, `Resource read: ${uri}`, requestId);

        ErrorMonitor.trackError(resourceError.code, requestId);
        mcpLogger.error(
          { requestId, resourceUri: uri, error: resourceError },
          "Resource access failed"
        );
        throw resourceError;
      }
    });

    // List prompts
    server.setRequestHandler(ListPromptsRequestSchema, async () => {
      return {
        prompts: Array.from(this.prompts.values()).map((prompt) => ({
          name: prompt.name,
          description: prompt.description,
          arguments: prompt.arguments,
        })),
      };
    });

    // Get prompts
    server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const requestId = generateRequestId();
      const prompt = this.prompts.get(name);

      mcpLogger.request(requestId, "get_prompt", { promptName: name, args });

      if (!prompt) {
        const error = new PromptError(
          name,
          "get",
          new Error("Prompt not found"),
          { args },
          requestId
        );
        mcpLogger.error({ requestId, promptName: name, error }, "Prompt not found");
        throw error;
      }

      try {
        const promptText = await prompt.generatePrompt(args || {});
        mcpLogger.info({ requestId, promptName: name }, "Prompt generation completed");
        return {
          description: `${prompt.description} - ${Object.entries(args || {})
            .map(([k, v]) => `${k}: ${v}`)
            .join(", ")}`,
          messages: [
            {
              role: "user" as const,
              content: {
                type: "text" as const,
                text: promptText,
              },
            },
          ],
        };
      } catch (error) {
        const promptError =
          error instanceof Error
            ? new PromptError(name, "generate", error, { args }, requestId)
            : wrapError(error, `Prompt generation: ${name}`, requestId);

        ErrorMonitor.trackError(promptError.code, requestId);
        mcpLogger.error(
          { requestId, promptName: name, error: promptError },
          "Prompt generation failed"
        );
        throw promptError;
      }
    });
  }

  /**
   * Gets server statistics and status
   */
  getStatus() {
    return {
      cache: this.cache.getStats(),
      rateLimiter: this.rateLimiter.getStatus(),
      tools: Array.from(this.tools.keys()),
      resources: Array.from(this.resources.keys()),
      prompts: Array.from(this.prompts.keys()),
      monitoring: ErrorMonitor.getMonitoringReport(),
    };
  }

  /**
   * Clears all caches
   */
  clearCaches(): void {
    this.cache.clear();
  }

  /**
   * Resets rate limiter
   */
  resetRateLimiter(): void {
    this.rateLimiter.reset();
  }

  /**
   * Cleanup resources
   */
  async destroy(): Promise<void> {
    await Promise.all(
      Array.from(this.resources.values()).map(async (resource) => {
        await resource.destroy?.();
      })
    );
    this.cache.destroy();
    this.rateLimiter.reset();
    this.scryfallClient.destroy();
  }

  /**
   * Health check endpoint with structured logging
   */
  async healthCheck(): Promise<{
    status: string;
    timestamp: string;
    services: Record<string, string>;
    requestId: string;
  }> {
    const requestId = generateRequestId();
    const startTime = Date.now();

    mcpLogger.healthCheck(requestId, "started");

    const status = {
      status: "healthy",
      timestamp: new Date().toISOString(),
      requestId,
      services: {
        cache: "healthy",
        rateLimiter: "healthy",
        scryfallClient: "healthy",
      },
    };

    // Test cache service
    try {
      this.cache.set("health_check", "test", 1000);
      const cacheTest = this.cache.get("health_check");
      if (cacheTest !== "test") {
        status.services.cache = "unhealthy";
        status.status = "degraded";
        mcpLogger.warn({ requestId, service: "cache" }, "Cache health check failed");
      } else {
        mcpLogger.debug({ requestId, service: "cache" }, "Cache health check passed");
      }
    } catch (error) {
      status.services.cache = "unhealthy";
      status.status = "degraded";
      mcpLogger.error(
        {
          requestId,
          service: "cache",
          error: wrapError(error, "Cache health check", requestId),
        },
        "Cache health check error"
      );
    }

    // Test rate limiter service
    try {
      const rateLimiterStatus = this.rateLimiter.getStatus();
      if (rateLimiterStatus.consecutiveErrors > 5) {
        status.services.rateLimiter = "unhealthy";
        status.status = "degraded";
        mcpLogger.warn(
          {
            requestId,
            service: "rateLimiter",
            consecutiveErrors: rateLimiterStatus.consecutiveErrors,
          },
          "Rate limiter health check failed"
        );
      } else {
        mcpLogger.debug(
          {
            requestId,
            service: "rateLimiter",
            consecutiveErrors: rateLimiterStatus.consecutiveErrors,
          },
          "Rate limiter health check passed"
        );
      }
    } catch (error) {
      status.services.rateLimiter = "unhealthy";
      status.status = "degraded";
      mcpLogger.error(
        {
          requestId,
          service: "rateLimiter",
          error: wrapError(error, "Rate limiter health check", requestId),
        },
        "Rate limiter health check error"
      );
    }

    // Test Scryfall client service only on deep check
    const deepCheck = EnvValidators.healthCheckDeep(process.env.HEALTHCHECK_DEEP);
    if (deepCheck) {
      try {
        await this.scryfallClient.getRandomCard();
        mcpLogger.debug(
          { requestId, service: "scryfallClient" },
          "Scryfall client health check passed"
        );
      } catch (error) {
        status.services.scryfallClient = "unhealthy";
        status.status = "degraded";
        mcpLogger.error(
          {
            requestId,
            service: "scryfallClient",
            error: wrapError(error, "Scryfall client health check", requestId),
          },
          "Scryfall client health check failed"
        );
      }
    }

    const duration = Date.now() - startTime;
    mcpLogger.healthCheck(requestId, status.status, status.services);
    mcpLogger.performance(
      { requestId, operation: "health_check", duration },
      "Health check completed"
    );

    return status;
  }
}
