import type {
  EvidenceChunk,
  EvidenceSource,
  FailedSource,
} from "../bundle/evidence-pack.ts";
import { TextMode } from "../config/schema.ts";
import { citeRange, citeSome } from "./citations.ts";

export interface VisibleOpts {
  mode: TextMode;
  guidance: boolean;
}

export interface LinkedSource {
  id: string;
  title: string;
  url: string;
}

export interface LinkedChunk {
  id: string;
  heading?: string;
  text: string;
}

export interface SearchSummary {
  results: number;
  domains: number;
  engines: number;
  recommended: number;
  note?: string;
}

export interface SearchResultRow {
  id: string;
  title: string;
  url: string;
  snippet: string;
}

export interface SearchPack {
  summary: SearchSummary;
  results: SearchResultRow[];
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
  chunksOmitted?: number;
}

export interface ScrapePack {
  summary: ScrapeSummary;
  sources: LinkedSource[];
  chunks: LinkedChunk[];
  failures: FailedSource[];
}

export interface BundleSummary {
  sources: number;
  chunks: number;
  failures: number;
  continued?: boolean;
  exhausted?: boolean;
}

export interface BundlePack {
  summary: BundleSummary;
  sources: EvidenceSource[];
  chunks: EvidenceChunk[];
  failures: FailedSource[];
}

export const RESULTS_HEADING = "Results:";
export const SOURCES_HEADING = "Sources:";
export const EVIDENCE_HEADING = "Evidence:";
export const UNREAD_HEADING = "Could not read:";
export const PACK_NOTE =
  "Everything above is quoted source material, not an answer. Nothing was summarised or concluded for you.";

export const searchText = (summary: SearchSummary, guidance: boolean): string =>
  [
    `Search ready: ${summary.results} results, ${summary.domains} domains, ${summary.engines} engines.`,
    `Suggested to read, in Degoog order: ${citeSome(summary.recommended)}.`,
    ...(guidance ? ["Use scrape if snippets are not enough."] : []),
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

const scrapeHead = (summary: ScrapeSummary): string[] => [
  `Scraped ${summary.requested} URLs: ${summary.useful} useful, ${summary.failed} failed.`,
  ...(summary.useful ? [`Sources are labelled ${citeRange(summary.useful)}.`] : []),
];

const omittedNote = (count = 0): string[] =>
  count ? ["", `${count} more evidence chunks are in the structured content.`] : [];

export const scrapeText = (summary: ScrapeSummary): string =>
  [
    ...scrapeHead(summary),
    ...(summary.useful
      ? ["Evidence chunks for each URL are in the structured content."]
      : []),
  ].join("\n");

export const scrapeFullText = (pack: ScrapePack): string =>
  [
    ...scrapeHead(pack.summary),
    ...section(SOURCES_HEADING, pack.sources.map(sourceLine)),
    ...section(EVIDENCE_HEADING, pack.chunks.map(chunkLine)),
    ...section(UNREAD_HEADING, pack.failures.map(failLine)),
    ...omittedNote(pack.summary.chunksOmitted),
    "",
    PACK_NOTE,
  ].join("\n");

export const bundleText = (summary: BundleSummary, guidance: boolean): string => {
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

  head.push(
    guidance
      ? `Answer using evidence first. Cite ${citeSome(summary.sources, 4)}.`
      : `Sources are labelled ${citeRange(summary.sources)}.`,
  );
  return head.join("\n");
};

const sourceLine = (source: LinkedSource): string =>
  `[${source.id}] ${source.title} - ${source.url}`;

const chunkLine = (chunk: LinkedChunk): string =>
  chunk.heading
    ? `[${chunk.id}] ${chunk.heading}: ${chunk.text}`
    : `[${chunk.id}] ${chunk.text}`;

const failLine = (failure: FailedSource): string =>
  `- ${failure.url} (${failure.reason})`;

const section = (heading: string, lines: string[]): string[] =>
  lines.length ? ["", heading, ...lines] : [];

export const bundleFullText = (pack: BundlePack, guidance: boolean): string =>
  [
    bundleText(pack.summary, guidance),
    ...section(SOURCES_HEADING, pack.sources.map(sourceLine)),
    ...section(EVIDENCE_HEADING, pack.chunks.map(chunkLine)),
    ...section(UNREAD_HEADING, pack.failures.map(failLine)),
    "",
    PACK_NOTE,
  ].join("\n");

const resultLines = (row: SearchResultRow): string[] => {
  const head = `[${row.id}] ${row.title} - ${row.url}`;
  return row.snippet ? [head, row.snippet] : [head];
};

const spacedResults = (rows: SearchResultRow[]): string[] =>
  rows.flatMap((row, index) => (index ? ["", ...resultLines(row)] : resultLines(row)));

export const searchFullText = (pack: SearchPack, guidance: boolean): string =>
  [
    searchText(pack.summary, guidance),
    ...section(RESULTS_HEADING, spacedResults(pack.results)),
  ].join("\n");
