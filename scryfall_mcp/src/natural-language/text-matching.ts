export function containsWholePhrase(text: string, phrase: string): boolean {
  const escapedPhrase = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^a-z0-9])${escapedPhrase}(?=$|[^a-z0-9])`, 'i').test(text);
}
