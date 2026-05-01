import { matchSorter, type KeyOption, type MatchSorterOptions } from "match-sorter";
import PinyinMatch from "pinyin-match";

type FuzzyKey<T> = KeyOption<T>;

export interface FuzzySearchOptions<T> {
  keys?: FuzzyKey<T>[];
}

function normalizeQuery(query: string) {
  return query.trim();
}

function isPinyinQuery(query: string): boolean {
  return /^[a-zA-Z]+$/.test(query);
}

function resolveKeyValue<T>(item: T, key: FuzzyKey<T>): string {
  if (typeof key === "function") return String(key(item));
  if (typeof key === "string") return String((item as Record<string, unknown>)[key]);
  return String(item);
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

  const sorterResults = matchSorter(items, normalizedQuery, {
    keys: options.keys as MatchSorterOptions<T>["keys"],
  });

  if (!isPinyinQuery(normalizedQuery)) {
    return sorterResults;
  }

  const keys = options.keys ?? [];
  const sorterSet = new Set(sorterResults);

  const pinyinMatches = items.filter((item) => {
    if (sorterSet.has(item)) return false;
    if (keys.length === 0) {
      return PinyinMatch.match(String(item), normalizedQuery) !== false;
    }
    return keys.some((key) => {
      const value = resolveKeyValue(item, key);
      return PinyinMatch.match(value, normalizedQuery) !== false;
    });
  });

  return [...sorterResults, ...pinyinMatches];
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
