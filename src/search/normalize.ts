import type { DegoogResult } from "../degoog/types.ts";
import { cleanTitle, squashSpace, stripMarkup } from "../utils/text.ts";
import { canonicalUrl, domainOf, isHttpUrl, rootDomain } from "../utils/urls.ts";

export interface NormalResult {
  title: string;
  url: string;
  originalUrl: string;
  domain: string;
  root: string;
  snippet: string;
  engines: string[];
  engineScore: number;
  queries: string[];
}

export const toNormal = (
  result: DegoogResult,
  query: string,
): NormalResult | null => {
  if (!isHttpUrl(result.url)) return null;

  const url = canonicalUrl(result.url);
  const engines = result.sources?.length
    ? [...new Set(result.sources.filter(Boolean))]
    : result.source
      ? [result.source]
      : [];

  return {
    title: cleanTitle(result.title, domainOf(url)),
    url,
    originalUrl: result.url,
    domain: domainOf(url),
    root: rootDomain(url),
    snippet: squashSpace(stripMarkup(result.snippet || result.content || "")),
    engines,
    engineScore: typeof result.score === "number" ? result.score : 0,
    queries: query ? [query] : [],
  };
};

export const normalize = (
  results: DegoogResult[],
  query: string,
): NormalResult[] =>
  results
    .map((result) => toNormal(result, query))
    .filter((result): result is NormalResult => result !== null);
