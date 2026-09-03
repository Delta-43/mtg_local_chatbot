import { ScryfallClient } from '../../services/scryfall-client.js';
import { RateLimitError, ScryfallAPIError, ValidationError } from '../../types/mcp-types.js';
import { ScryfallCard } from '../../types/scryfall-api.js';

// This bounds helper-level scheduling for injected clients. The production
// ScryfallClient still serializes upstream Scryfall request completion through
// its global RateLimiter.
const DEFAULT_CONCURRENCY = 4;

interface FetchCardsMapOptions {
  concurrency?: number;
  skipNotFound?: boolean;
  match?: 'fuzzy' | 'exact';
  fallbackToFuzzy?: boolean;
}

export interface FuzzyCardResolution {
  requestedName: string;
  resolvedName: string;
}

export interface FetchCardsMapResult {
  cards: Map<string, ScryfallCard>;
  notFound: string[];
  fuzzyResolutions: FuzzyCardResolution[];
  rateLimitError?: RateLimitError;
  fatalError?: unknown;
  attempted: number;
}

export function uniqueInOrder(values: string[]): string[] {
  return Array.from(new Set(values));
}

export async function fetchCardMapWithDiagnostics(
  scryfallClient: ScryfallClient,
  cardList: string[],
  options: FetchCardsMapOptions = {}
): Promise<FetchCardsMapResult> {
  const cards = new Map<string, ScryfallCard>();
  const notFound: string[] = [];
  const fuzzyResolutions: FuzzyCardResolution[] = [];
  let nextIndex = 0;
  let attempted = 0;
  let stopped = false;
  let rateLimitError: RateLimitError | undefined;
  let fatalError: unknown;
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const match = options.match ?? 'fuzzy';

  const workerCount = Math.min(Math.max(1, concurrency), cardList.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (!stopped && nextIndex < cardList.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      attempted += 1;
      const cardName = cardList[currentIndex];

      try {
        const lookupParams = match === 'exact'
          ? { identifier: cardName, match }
          : { identifier: cardName };
        const card = await scryfallClient.getCard(lookupParams);
        cards.set(cardName, card);
      } catch (error) {
        if (error instanceof ScryfallAPIError && error.status === 404) {
          if (match === 'exact' && options.fallbackToFuzzy) {
            try {
              const fuzzyCard = await scryfallClient.getCard({ identifier: cardName });
              cards.set(cardName, fuzzyCard);
              fuzzyResolutions.push({
                requestedName: cardName,
                resolvedName: fuzzyCard.name,
              });
              continue;
            } catch (fallbackError) {
              if (fallbackError instanceof ScryfallAPIError && fallbackError.status === 404) {
                notFound.push(cardName);
                continue;
              }

              if (fallbackError instanceof RateLimitError) {
                rateLimitError = fallbackError;
              } else {
                fatalError = fallbackError;
              }
              stopped = true;
              break;
            }
          }

          notFound.push(cardName);
          continue;
        }

        if (error instanceof RateLimitError) {
          rateLimitError = error;
        } else {
          fatalError = error;
        }
        stopped = true;
        break;
      }
    }
  });

  await Promise.all(workers);

  return {
    cards,
    notFound,
    fuzzyResolutions,
    rateLimitError,
    fatalError,
    attempted,
  };
}

export async function fetchCardMapWithConcurrency(
  scryfallClient: ScryfallClient,
  cardList: string[],
  options: FetchCardsMapOptions = {}
): Promise<Map<string, ScryfallCard>> {
  const result = await fetchCardMapWithDiagnostics(scryfallClient, cardList, options);

  if (result.rateLimitError) {
    throw result.rateLimitError;
  }

  if (result.fatalError) {
    throw result.fatalError;
  }

  const { cards, notFound } = result;

  if (notFound.length > 0 && !options.skipNotFound) {
    throw new ValidationError(`Cards not found: ${notFound.join(', ')}`);
  }

  return cards;
}

export async function fetchCardsWithConcurrency(
  scryfallClient: ScryfallClient,
  cardList: string[],
  concurrency = DEFAULT_CONCURRENCY
): Promise<ScryfallCard[]> {
  const uniqueCardList = uniqueInOrder(cardList);
  const cardMap = await fetchCardMapWithConcurrency(scryfallClient, uniqueCardList, { concurrency });

  return cardList.flatMap(cardName => {
    const card = cardMap.get(cardName);
    return card ? [card] : [];
  });
}
