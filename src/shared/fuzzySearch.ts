import { matchSorter, type KeyOption, type MatchSorterOptions } from "match-sorter";

type FuzzyKey<T> = KeyOption<T>;

export interface FuzzySearchOptions<T> {
  keys?: FuzzyKey<T>[];
}

function normalizeQuery(query: string) {
  return query.trim();
}

export function fuzzySearchItems<T>(
  items: readonly T[],
  query: string,
  options: FuzzySearchOptions<T> = {},
): T[] {
  const normalizedQuery = normalizeQuery(query);
  if (!normalizedQuery) {
    return [...items];
  }

  return matchSorter(items, normalizedQuery, {
    keys: options.keys as MatchSorterOptions<T>["keys"],
  });
}

export function fuzzyMatches<T>(item: T, query: string, options: FuzzySearchOptions<T> = {}) {
  return fuzzySearchItems([item], query, options).length > 0;
}

export function filterFuzzyTree<T>(
  items: readonly T[],
  query: string,
  options: FuzzySearchOptions<T> & {
    getChildren: (item: T) => readonly T[];
    setChildren: (item: T, children: T[]) => T;
  },
): T[] {
  const normalizedQuery = normalizeQuery(query);
  if (!normalizedQuery) {
    return [...items];
  }

  return items.flatMap((item) => {
    const children = options.getChildren(item);
    const matches = fuzzyMatches(item, normalizedQuery, options);
    if (matches) {
      return [options.setChildren(item, [...children])];
    }

    const filteredChildren = filterFuzzyTree(children, normalizedQuery, options);
    if (filteredChildren.length === 0) {
      return [];
    }

    return [options.setChildren(item, filteredChildren)];
  });
}
