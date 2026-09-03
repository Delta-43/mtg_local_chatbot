import { describe, it, expect, beforeEach, afterEach } from "vitest";
import packageJson from "../package.json" with { type: "json" };
import { MCP_SERVER_INFO, ScryfallMCPServer } from "../src/server.js";
import { EnvValidators } from "../src/utils/env-parser.js";

describe("Scryfall MCP Server", () => {
  let server: ScryfallMCPServer;

  beforeEach(() => {
    server = new ScryfallMCPServer();
  });

  afterEach(async () => {
    await server.destroy();
  });

  it("should initialize successfully", () => {
    expect(server).toBeDefined();
  });

  it("should derive server and default user-agent versions from the package", () => {
    expect(MCP_SERVER_INFO.version).toBe(packageJson.version);
    expect(EnvValidators.userAgent()).toBe(`ScryfallMCPServer/${packageJson.version}`);
    expect(EnvValidators.userAgent("CustomScryfallClient/2.0")).toBe("CustomScryfallClient/2.0");
  });

  it("should have correct tools", () => {
    const status = server.getStatus();
    expect(status.tools).toContain("search_cards");
    expect(status.tools).toContain("get_card");
    expect(status.tools).toContain("get_card_prices");
    expect(status.tools).toContain("random_card");
    expect(status.tools).toContain("search_sets");
    expect(status.tools).toContain("build_scryfall_query");
  });

  it("should have correct resources", () => {
    const status = server.getStatus();
    expect(status.resources).toContain("card-database://bulk");
    expect(status.resources).toContain("set-database://all");
  });

  it("should have correct prompts", () => {
    const status = server.getStatus();
    expect(status.prompts).toContain("analyze_card");
    expect(status.prompts).toContain("build_deck");
  });

  it("should clear caches", () => {
    server.clearCaches();
    const status = server.getStatus();
    expect(status.cache.size).toBe(0);
  });

  it("should reset rate limiter", () => {
    server.resetRateLimiter();
    const status = server.getStatus();
    expect(status.rateLimiter.consecutiveErrors).toBe(0);
  });

  it("should include monitoring data in status", () => {
    const status = server.getStatus();
    expect(status).toHaveProperty("monitoring");
    expect(status.monitoring).toHaveProperty("errors");
    expect(status.monitoring).toHaveProperty("performance");
    expect(status.monitoring).toHaveProperty("correlationCount");
    expect(status.monitoring).toHaveProperty("timestamp");
  });
});
