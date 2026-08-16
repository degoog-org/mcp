import type { NormalResult } from "./normalize.ts";

const mergePair = (base: NormalResult, next: NormalResult): NormalResult => ({
  ...base,
  title: base.title.length >= next.title.length ? base.title : next.title,
  snippet: base.snippet.length >= next.snippet.length ? base.snippet : next.snippet,
  engines: [...new Set([...base.engines, ...next.engines])],
  engineScore: Math.max(base.engineScore, next.engineScore),
  queries: [...new Set([...base.queries, ...next.queries])],
});

export const dedupe = (results: NormalResult[]): NormalResult[] => {
  const byUrl = new Map<string, NormalResult>();

  for (const result of results) {
    const existing = byUrl.get(result.url);
    byUrl.set(result.url, existing ? mergePair(existing, result) : result);
  }

  return [...byUrl.values()];
};

export const dupeCount = (
  before: NormalResult[],
  after: NormalResult[],
): number => Math.max(0, before.length - after.length);
