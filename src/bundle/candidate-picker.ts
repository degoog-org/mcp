import type { ShapedResult } from "../search/shape.ts";

export interface Candidate {
  url: string;
  title: string;
  domain: string;
  reason: string;
  degoogScore: number;
}

const reasonFor = (result: ShapedResult): string => {
  if (result.engines.length > 1) return `${result.engines.length} engines agree`;
  if (result.reasons.length) return result.reasons[0] as string;
  return "next in Degoog order";
};

export const pickCandidates = (
  results: ShapedResult[],
  max: number,
  perRoot = 1,
): Candidate[] => {
  const used = new Map<string, number>();
  const picked: Candidate[] = [];

  for (const result of results) {
    if (picked.length >= max) break;

    const key = result.root || result.domain;
    const count = used.get(key) ?? 0;
    if (count >= perRoot) continue;
    used.set(key, count + 1);

    picked.push({
      url: result.url,
      title: result.title,
      domain: result.domain,
      reason: reasonFor(result),
      degoogScore: result.degoogScore,
    });
  }

  return picked;
};
