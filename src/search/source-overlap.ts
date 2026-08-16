import type { NormalResult } from "./normalize.ts";

export interface OverlapRow {
  url: string;
  engines: string[];
  count: number;
}

export const overlapRows = (results: NormalResult[]): OverlapRow[] =>
  results
    .filter((result) => result.engines.length > 1)
    .map((result) => ({
      url: result.url,
      engines: result.engines,
      count: result.engines.length,
    }))
    .sort((a, b) => b.count - a.count);

export const domainSpread = (results: NormalResult[]): number =>
  new Set(results.map((result) => result.domain)).size;

export const engineSpread = (results: NormalResult[]): number =>
  new Set(results.flatMap((result) => result.engines)).size;
