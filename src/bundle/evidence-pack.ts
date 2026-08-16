import { citeId } from "../output/citations.ts";
import { cleanTitle } from "../utils/text.ts";
import type { ShapedResult } from "../search/shape.ts";
import type { ScrapeRow } from "../scrape/pipeline.ts";
import { fitsBudget } from "./budget.ts";
import type { Candidate } from "./candidate-picker.ts";

export interface EvidenceChunk {
  id: string;
  heading?: string;
  text: string;
  match: number;
}

export interface EvidenceSource {
  id: string;
  title: string;
  url: string;
  domain: string;
  reason: string;
  publishedAt?: string;
  snippet?: string;
  match: number;
}

export interface FailedSource {
  url: string;
  reason: string;
}

export interface EvidencePack {
  sources: EvidenceSource[];
  chunks: EvidenceChunk[];
  failures: FailedSource[];
  charsUsed: number;
  chunksOmitted: number;
}

export interface PackInput {
  rows: ScrapeRow[];
  candidates: Candidate[];
  ranked: ShapedResult[];
  maxChars: number;
}

const snippetFor = (ranked: ShapedResult[], url: string): string | undefined =>
  ranked.find((result) => result.url === url)?.snippet;

export const buildPack = (input: PackInput): EvidencePack => {
  const sources: EvidenceSource[] = [];
  const chunks: EvidenceChunk[] = [];
  const failures: FailedSource[] = [];

  let charsUsed = 0;
  let chunksOmitted = 0;

  for (const row of input.rows) {
    if (!row.ok) {
      failures.push({ url: row.url, reason: row.error ?? "scrape failed" });
      continue;
    }

    const candidate = input.candidates.find((entry) => entry.url === row.url);
    const id = citeId(sources.length);

    sources.push({
      id,
      title: cleanTitle(row.title, candidate?.title || candidate?.domain || row.url),
      url: row.canonical || row.url,
      domain: candidate?.domain ?? "",
      reason: candidate?.reason ?? "selected in Degoog order",
      publishedAt: row.publishedAt ?? undefined,
      snippet: snippetFor(input.ranked, row.url),
      match: row.chunks.reduce((top, chunk) => Math.max(top, chunk.match), 0),
    });

    chunksOmitted += row.chunksOmitted;

    for (const chunk of row.chunks) {
      if (!fitsBudget(charsUsed, chunk.text.length, input.maxChars)) {
        chunksOmitted++;
        continue;
      }
      charsUsed += chunk.text.length;
      chunks.push({
        id,
        heading: chunk.heading ?? undefined,
        text: chunk.text,
        match: chunk.match,
      });
    }
  }

  return { sources, chunks, failures, charsUsed, chunksOmitted };
};

export const nextActions = (pack: EvidencePack, omitted: number): string[] => {
  const actions: string[] = [];

  if (!pack.chunks.length) {
    actions.push("no evidence extracted, try scrape on specific URLs");
  }
  if (pack.failures.length) {
    actions.push("some sources failed, consider scrape on alternates");
  }
  if (omitted > 0) {
    actions.push("more ranked results exist, narrow the query or raise caps");
  }
  if (pack.chunksOmitted > 0) {
    actions.push("evidence was capped, scrape a single URL for more depth");
  }

  return actions;
};
