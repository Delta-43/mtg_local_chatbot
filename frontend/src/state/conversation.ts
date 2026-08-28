const STORAGE_KEY = "mtg-judge-conversation-id";

export function getConversationId(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export function setConversationId(id: string): void {
  localStorage.setItem(STORAGE_KEY, id);
}

export function resetConversation(): void {
  localStorage.removeItem(STORAGE_KEY);
}
