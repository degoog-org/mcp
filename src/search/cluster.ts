import type { ShapedResult } from "./shape.ts";

export const spreadDomains = (
  results: ShapedResult[],
  perRoot: number,
): ShapedResult[] => {
  const seen = new Map<string, number>();
  const kept: ShapedResult[] = [];

  for (const result of results) {
    const key = result.root || result.domain;
    const used = seen.get(key) ?? 0;
    if (used >= perRoot) continue;
    seen.set(key, used + 1);
    kept.push(result);
  }

  return kept;
};
