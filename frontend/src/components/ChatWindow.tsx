import { useState } from "react";
import { streamChat, HttpError } from "../api/client";
import { getConversationId, setConversationId, resetConversation } from "../state/conversation";
import type { ChatMessage } from "../types";
import { MessageBubble } from "./MessageBubble";
import { ThinkingIndicator } from "./ThinkingIndicator";
import { ChatInput } from "./ChatInput";

let nextId = 0;
const genId = () => `msg-${nextId++}`;

export function ChatWindow() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [awaitingFirstToken, setAwaitingFirstToken] = useState(false);

  const handleSubmit = async (query: string) => {
    const userMsg: ChatMessage = { id: genId(), role: "user", text: query };
    const assistantId = genId();
    setMessages((prev) => [...prev, userMsg, { id: assistantId, role: "assistant", text: "", pending: true }]);
    setBusy(true);
    setAwaitingFirstToken(true);

    try {
      for await (const evt of streamChat(query, getConversationId())) {
        if (evt.event === "token") {
          setAwaitingFirstToken(false);
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, text: m.text + evt.data.text } : m)),
          );
        } else if (evt.event === "sources") {
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, sources: evt.data } : m)),
          );
        } else if (evt.event === "done") {
          setConversationId(evt.data.conversation_id);
          setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, pending: false } : m)));
        } else if (evt.event === "error") {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, text: evt.data.message, isError: true, pending: false } : m,
            ),
          );
        }
      }
    } catch (err) {
      const text =
        err instanceof HttpError && err.status === 429
          ? "You've hit the request limit for now -- please wait a bit and try again."
          : "Couldn't reach the judge. Please try again.";
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, text, isError: true, pending: false } : m)),
      );
    } finally {
      setBusy(false);
      setAwaitingFirstToken(false);
    }
  };

  const handleNewChat = () => {
    resetConversation();
    setMessages([]);
  };

  return (
    <div className="chat-window">
      <header>
        <h1>MTG Judge</h1>
        <button className="new-chat" onClick={handleNewChat} disabled={busy}>
          New chat
        </button>
      </header>
      <div className="message-list">
        {messages
          .filter((m) => m.text || !m.pending)
          .map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
        {awaitingFirstToken && <ThinkingIndicator />}
      </div>
      <ChatInput onSubmit={handleSubmit} disabled={busy} />
    </div>
  );
}
