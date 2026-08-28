import type { ChatMessage } from "../types";
import { SourcesPanel } from "./SourcesPanel";

export function MessageBubble({ message }: { message: ChatMessage }) {
  return (
    <div className={`message ${message.role} ${message.isError ? "error" : ""}`}>
      <div className="message-text">{message.text}</div>
      {message.sources && <SourcesPanel sources={message.sources} />}
    </div>
  );
}
