import { citeSome } from "./citations.ts";

export interface SearchSummary {
  results: number;
  domains: number;
  engines: number;
  recommended: number;
  note?: string;
}

export interface RetrySummary {
  engine: string;
  engineResults: number | null;
  merged: number;
  fromEngine: number;
  status?: string;
}

export interface ScrapeSummary {
  requested: number;
  useful: number;
  failed: number;
}

export interface BundleSummary {
  sources: number;
  chunks: number;
  failures: number;
  continued?: boolean;
  exhausted?: boolean;
}

export const searchText = (summary: SearchSummary): string =>
  [
    `Search ready: ${summary.results} results, ${summary.domains} domains, ${summary.engines} engines.`,
    `Suggested to read, in Degoog order: ${citeSome(summary.recommended)}.`,
    "Use scrape if snippets are not enough.",
    ...(summary.note ? [summary.note] : []),
  ].join("\n");

export const retryText = (summary: RetrySummary): string => {
  const lines = [
    summary.engineResults === null
      ? `Retried ${summary.engine}: ${summary.merged} ranked results, all engines merged.`
      : `Retried ${summary.engine}: that engine returned ${summary.engineResults} results, merged with the other engines into ${summary.merged} ranked results.`,
    `${summary.fromEngine} of the ranked results list ${summary.engine} as a source.`,
  ];

  if (summary.status) {
    lines.push(`Engine status reported by Degoog: ${summary.status}.`);
  }
  if (summary.engineResults === null) {
    lines.push(
      "Degoog did not report a per-engine count for this retry, see engineTimings in the structured content.",
    );
  }

  return lines.join("\n");
};

export const scrapeText = (summary: ScrapeSummary): string =>
  [
    `Scraped ${summary.requested} URLs: ${summary.useful} useful, ${summary.failed} failed.`,
    "Top evidence chunks are in structured content. Cite source IDs.",
  ].join("\n");

export const bundleText = (summary: BundleSummary): string => {
  const head = [
    `Bundle ready: ${summary.sources} useful sources from top Degoog-ranked readable pages, ${summary.chunks} evidence chunks, ${summary.failures} failed.`,
  ];

  if (summary.continued) {
    head.push(
      "Some top sources failed, continued to later Degoog-ranked results in Degoog order.",
    );
  }
  if (summary.exhausted) {
    head.push("Ran out of candidates before reaching the requested source count.");
  }

  head.push(`Answer using evidence first. Cite ${citeSome(summary.sources, 4)}.`);
  return head.join("\n");
};
