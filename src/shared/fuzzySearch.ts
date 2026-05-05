import { getItemValues, matchSorter, type KeyOption, type MatchSorterOptions } from "match-sorter";
import PinyinMatch from "pinyin-match";

type FuzzyKey<T> = KeyOption<T>;
type PinyinMatchRange = [number, number];

export interface FuzzySearchOptions<T> {
  keys?: FuzzyKey<T>[];
}

function normalizeQuery(query: string) {
  return query.trim();
}

function isPinyinQuery(query: string): boolean {
  return /^[a-zA-Z]+$/.test(query);
}

function resolveKeyValues<T>(item: T, keys: readonly FuzzyKey<T>[]): string[] {
  if (keys.length === 0) return [String(item)];
  return keys.flatMap((key) => getItemValues(item, key));
}

function comparePinyinMatches(left: PinyinMatchRange, right: PinyinMatchRange): number {
  const startDiff = left[0] - right[0];
  if (startDiff !== 0) return startDiff;

  const lengthDiff = left[1] - left[0] - (right[1] - right[0]);
  if (lengthDiff !== 0) return lengthDiff;

  return left[1] - right[1];
}

function findBestPinyinMatch<T>(
  item: T,
  normalizedQuery: string,
  keys: readonly FuzzyKey<T>[],
): PinyinMatchRange | null {
  const matches = resolveKeyValues(item, keys)
    .map((value) => PinyinMatch.match(value, normalizedQuery))
    .filter((match): match is PinyinMatchRange => match !== false);

  if (matches.length === 0) return null;
  return matches.sort(comparePinyinMatches)[0] ?? null;
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

  const pinyinMatches = items
    .map((item, index) => ({
      item,
      index,
      match: findBestPinyinMatch(item, normalizedQuery, keys),
    }))
    .filter(
      (result): result is { item: T; index: number; match: PinyinMatchRange } =>
        result.match !== null && !sorterSet.has(result.item),
    )
    .sort(
      (left, right) => comparePinyinMatches(left.match, right.match) || left.index - right.index,
    )
    .map((result) => result.item);

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
