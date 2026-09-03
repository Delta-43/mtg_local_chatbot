import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createHttpAppServer, type HttpServerConfig } from "../src/http.js";

describe("HTTP transport entrypoint", () => {
  let server: Server;
  let baseUrl: URL;
  let closeRuntime: (() => Promise<void>) | undefined;

  beforeEach(async () => {
    const runtime = createHttpAppServer({
      host: "127.0.0.1",
      port: 0,
    });

    server = runtime.server;
    closeRuntime = runtime.close;

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    const address = server.address() as AddressInfo;
    const config = runtime.config as HttpServerConfig;
    baseUrl = new URL(`http://127.0.0.1:${address.port}${config.mcpPath}`);
  });

  afterEach(async () => {
    if (closeRuntime) {
      await closeRuntime();
    }
  });

  it("supports MCP initialization and tool discovery over Streamable HTTP", async () => {
    const client = new Client({
      name: "scryfall-http-test-client",
      version: "1.0.0",
    });
    const transport = new StreamableHTTPClientTransport(baseUrl);

    await client.connect(transport);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain("search_cards");
    expect(tools.tools.map((tool) => tool.name)).toContain("suggest_mana_base");

    await transport.close();
  });

  it("executes a representative tool over Streamable HTTP", async () => {
    const client = new Client({
      name: "scryfall-http-test-client",
      version: "1.0.0",
    });
    const transport = new StreamableHTTPClientTransport(baseUrl);

    await client.connect(transport);

    const result = await client.callTool({
      name: "suggest_mana_base",
      arguments: {
        color_requirements: "WU",
        deck_size: 60,
        format: "modern",
        strategy: "control",
        budget: "moderate",
      },
    });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].type).toBe("text");
    if (result.content[0].type === "text") {
      expect(result.content[0].text).toContain("**Mana Base Suggestion**");
      expect(result.content[0].text).toContain("• Colors: WU");
    }

    await transport.close();
  });

  it("rejects non-loopback browser origins by default", async () => {
    const response = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        origin: "https://example.com",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: {
            name: "bad-origin-client",
            version: "1.0.0",
          },
        },
      }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        message: "Forbidden: Origin is not allowed for this MCP endpoint",
      },
    });
  });

  it("rejects oversized JSON request bodies", async () => {
    const response = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: "x".repeat(2_000_000),
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        message: "Payload Too Large",
      },
    });
  });

  it("expires idle HTTP MCP sessions", async () => {
    await closeRuntime?.();

    const runtime = createHttpAppServer({
      host: "127.0.0.1",
      port: 0,
      sessionIdleMs: 5,
      sessionCleanupIntervalMs: 5,
    });
    server = runtime.server;
    closeRuntime = runtime.close;

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    const address = server.address() as AddressInfo;
    const config = runtime.config as HttpServerConfig;
    baseUrl = new URL(`http://127.0.0.1:${address.port}${config.mcpPath}`);

    const initialize = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: {
            name: "idle-session-test",
            version: "1.0.0",
          },
        },
      }),
    });
    const sessionId = initialize.headers.get("mcp-session-id");
    expect(sessionId).toBeTruthy();
    await initialize.text();

    await new Promise((resolve) => setTimeout(resolve, 20));

    const afterIdle = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-session-id": sessionId!,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
    });

    expect(afterIdle.status).toBe(400);
    await expect(afterIdle.json()).resolves.toMatchObject({
      error: {
        message: "Bad Request: No valid session ID provided",
      },
    });
  });
});
