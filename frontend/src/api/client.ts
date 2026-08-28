import type { ChatResponse, SseEvent } from "../types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

// Carries the HTTP status so callers can distinguish "rate limited / over
// quota" (429) from an actual network failure -- collapsing both into one
// generic message is misleading (found via a live test that hit the
// anonymous tier's daily quota and rendered "couldn't reach the judge").
export class HttpError extends Error {
  constructor(public status: number) {
    super(`Request failed: ${status}`);
  }
}

// No X-API-Key is sent -- a key baked into this bundle would be world-readable
// via devtools/network tab, so it wouldn't actually be secret. The backend's
// anonymous tier (IP-based rate limit + a lower daily quota) is what protects
// this path; see CLAUDE.md / the backend's _authenticate() for the full model.

export async function chatOnce(query: string, conversationId: string | null): Promise<ChatResponse> {
  const res = await fetch(`${API_BASE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, conversation_id: conversationId }),
  });
  if (!res.ok) {
    throw new HttpError(res.status);
  }
  return res.json();
}

function parseSseFrame(frame: string): SseEvent | null {
  let event = "message";
  let dataLine = "";
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLine = line.slice(5).trim();
  }
  if (!dataLine) return null;
  return { event, data: JSON.parse(dataLine) } as SseEvent;
}

// EventSource can't POST or set a body, and this endpoint needs both -- so we
// hand-roll SSE parsing over a plain fetch()'d streamed response body instead.
export async function* streamChat(
  query: string,
  conversationId: string | null,
): AsyncGenerator<SseEvent> {
  const res = await fetch(`${API_BASE}/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, conversation_id: conversationId }),
  });
  if (!res.ok || !res.body) {
    throw new HttpError(res.status);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const parsed = parseSseFrame(frame);
      if (parsed) yield parsed;
    }
  }
}
