import type { DegoogSearchResponse } from "../degoog/types.ts";
import { capList } from "./caps.ts";
import { spreadDomains } from "./cluster.ts";
import { dedupe, dupeCount } from "./dedupe.ts";
import { normalize } from "./normalize.ts";
import { shapeResults, type ShapedResult } from "./shape.ts";
import { domainSpread, engineSpread, overlapRows, type OverlapRow } from "./source-overlap.ts";
import { trimSnippet } from "./snippets.ts";

export interface PipelineInput {
  responses: Array<{ query: string; response: DegoogSearchResponse }>;
  rankQuery: string;
  maxResults: number;
  snippetChars: number;
  perDomain?: number;
}

export interface PipelineOutput {
  results: ShapedResult[];
  omitted: number;
  merged: number;
  domains: number;
  engines: number;
  overlap: OverlapRow[];
  related: string[];
}

export const runPipeline = (input: PipelineInput): PipelineOutput => {
  const flat = input.responses.flatMap(({ query, response }) =>
    normalize(response.results ?? [], query),
  );

  const unique = dedupe(flat);
  const shaped = shapeResults(unique);
  const spread = spreadDomains(shaped, input.perDomain ?? 2);
  const capped = capList(spread, input.maxResults);

  const results = capped.items.map((result) => ({
    ...result,
    snippet: trimSnippet(result.snippet, input.snippetChars),
  }));

  const related = [
    ...new Set(
      input.responses.flatMap(({ response }) => response.relatedSearches ?? []),
    ),
  ];

  return {
    results,
    omitted: capped.omitted + Math.max(0, shaped.length - spread.length),
    merged: dupeCount(flat, unique),
    domains: domainSpread(results),
    engines: engineSpread(results),
    overlap: overlapRows(results),
    related,
  };
};

export const pickScrapable = (
  results: ShapedResult[],
  max: number,
): ShapedResult[] => {
  const seen = new Set<string>();
  const picked: ShapedResult[] = [];

  for (const result of results) {
    if (picked.length >= max) break;
    const key = result.root || result.domain;
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(result);
  }

  return picked;
};
