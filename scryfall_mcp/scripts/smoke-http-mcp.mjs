import { parseSseMessage } from "./http-mcp-smoke-lib.mjs";

const endpoint = process.env.MCP_HTTP_URL || "http://127.0.0.1:3000/mcp";
const healthUrl = endpoint.replace(/\/mcp$/, "/health");

let sessionId;
let requestId = 1;

async function postJsonRpc(payload) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };

  if (sessionId) {
    headers["mcp-session-id"] = sessionId;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  const returnedSessionId = response.headers.get("mcp-session-id");
  if (returnedSessionId) {
    sessionId = returnedSessionId;
  }

  if (response.status === 202) {
    return null;
  }

  const text = await response.text();
  const parsed = response.headers.get("content-type")?.includes("text/event-stream")
    ? parseSseMessage(text)
    : JSON.parse(text);

  if (!response.ok || parsed?.error) {
    throw new Error(`MCP request failed: ${response.status} ${JSON.stringify(parsed?.error)}`);
  }

  return parsed.result;
}

const health = await fetch(healthUrl).then((response) => response.json());
if (health.status !== "healthy") {
  throw new Error(`Health check failed: ${JSON.stringify(health)}`);
}

const initialize = await postJsonRpc({
  jsonrpc: "2.0",
  id: requestId++,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "scryfall-mcp-smoke", version: "0.1.0" },
  },
});

await postJsonRpc({
  jsonrpc: "2.0",
  method: "notifications/initialized",
});

const tools = await postJsonRpc({
  jsonrpc: "2.0",
  id: requestId++,
  method: "tools/list",
  params: {},
});

const commanderValidation = await postJsonRpc({
  jsonrpc: "2.0",
  id: requestId++,
  method: "tools/call",
  params: {
    name: "validate_brawl_commander",
    arguments: {
      card_identifier: "sos/223",
      format: "brawl",
    },
  },
});

if (commanderValidation?.isError) {
  throw new Error(`validate_brawl_commander failed: ${JSON.stringify(commanderValidation)}`);
}

const arenaSearch = await postJsonRpc({
  jsonrpc: "2.0",
  id: requestId++,
  method: "tools/call",
  params: {
    name: "search_cards",
    arguments: {
      query: "Opt",
      limit: 1,
      arena_only: true,
    },
  },
});

if (arenaSearch?.isError) {
  throw new Error(`search_cards failed: ${JSON.stringify(arenaSearch)}`);
}

console.log(JSON.stringify({
  endpoint,
  health: health.status,
  server: initialize.serverInfo,
  toolCount: tools.tools.length,
  tools: tools.tools.map((tool) => tool.name),
  exercisedTools: ["validate_brawl_commander", "search_cards"],
}, null, 2));
