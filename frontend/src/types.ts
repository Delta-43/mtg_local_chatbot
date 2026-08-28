export interface Sources {
  rules: string[];
  rulings: string[];
  web_links: string[];
}

export interface ChatResponse {
  answer: string;
  sources: Sources;
  conversation_id: string;
}

export type SseEvent =
  | { event: "token"; data: { text: string } }
  | { event: "sources"; data: Sources }
  | { event: "done"; data: { conversation_id: string } }
  | { event: "error"; data: { message: string } };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  sources?: Sources;
  isError?: boolean;
  pending?: boolean;
}
