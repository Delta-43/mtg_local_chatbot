export function parseSseMessage(text) {
  const lines = text.split(/\r?\n/);
  const event = lines
    .filter((line) => line.startsWith("event:"))
    .map((line) => line.slice(6).trim())
    .find(Boolean);

  if (event !== "message") {
    throw new Error(`Expected SSE event "message", got ${event || "none"}`);
  }

  const data = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("\n");

  if (!data) {
    throw new Error("Expected SSE data payload");
  }

  return JSON.parse(data);
}
