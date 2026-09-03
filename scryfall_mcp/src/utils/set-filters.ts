import type { ScryfallSet } from "../types/scryfall-api.js";

export type SetFilters = {
  query?: string;
  type?: string;
  released_after?: string;
  released_before?: string;
  digital?: boolean;
};

export function filterSets(sets: ScryfallSet[], filters: SetFilters): ScryfallSet[] {
  const query = filters.query?.toLowerCase();

  return sets.filter((set) => {
    if (query && !set.name.toLowerCase().includes(query) && !set.code.toLowerCase().includes(query)) {
      return false;
    }

    if (filters.type && set.set_type !== filters.type) {
      return false;
    }

    if (filters.digital !== undefined && set.digital !== filters.digital) {
      return false;
    }

    if (filters.released_after && (!set.released_at || set.released_at < filters.released_after)) {
      return false;
    }

    if (filters.released_before && (!set.released_at || set.released_at > filters.released_before)) {
      return false;
    }

    return true;
  });
}
