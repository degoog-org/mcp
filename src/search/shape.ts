import type { NormalResult } from "./normalize.ts";

export interface ShapedResult extends NormalResult {
  degoogScore: number;
  reasons: string[];
}

const reasonsFor = (result: NormalResult): string[] =>
  result.engines.length > 1 ? [`${result.engines.length} engines agree`] : [];

export const shapeResults = (results: NormalResult[]): ShapedResult[] =>
  results.map((result) => ({
    ...result,
    degoogScore: result.engineScore,
    reasons: reasonsFor(result),
  }));
