type SearchWindowPage<T> = {
  data: T[];
  has_more?: boolean;
  warnings?: string[];
};

type SearchWindowResult<T> = {
  data: T[];
  warnings?: string[];
};

export function createSearchWindowCollector<T>(
  relativeOffset: number,
  requiredCount: number
): {
  addPage(page: SearchWindowPage<T>): void;
  isComplete(): boolean;
  finish(): SearchWindowResult<T>;
} {
  const data: T[] = [];
  const warningSet = new Set<string>();
  let remainingSkip = relativeOffset;

  return {
    addPage(page: SearchWindowPage<T>): void {
      page.warnings?.forEach((warning) => warningSet.add(warning));

      if (data.length >= requiredCount) {
        return;
      }

      const start = Math.min(remainingSkip, page.data.length);
      remainingSkip -= start;

      for (let index = start; index < page.data.length && data.length < requiredCount; index++) {
        data.push(page.data[index]);
      }
    },

    isComplete(): boolean {
      return data.length >= requiredCount;
    },

    finish(): SearchWindowResult<T> {
      return {
        data,
        warnings: warningSet.size > 0 ? Array.from(warningSet) : undefined,
      };
    },
  };
}

export function collectRequestedWindow<T>(
  pages: SearchWindowPage<T>[],
  relativeOffset: number,
  requiredCount: number
): SearchWindowResult<T> {
  const collector = createSearchWindowCollector<T>(relativeOffset, requiredCount);

  for (const page of pages) {
    collector.addPage(page);
    if (collector.isComplete()) {
      break;
    }
  }

  return collector.finish();
}
