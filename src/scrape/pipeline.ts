import type { ScrapeConfig } from "../config/schema.ts";
import { logger } from "../utils/logger.ts";
import { runPooled } from "../utils/timeout.ts";
import { capChars } from "../search/caps.ts";
import { pickChunks, type Chunk } from "./chunks.ts";
import { extract } from "./extract.ts";
import { fetchPage } from "./fetch.ts";
import { fetchVia } from "./fetcher.ts";

const LOG_NS = "scrape";
const BROWSER_NEEDED =
  "page needs browser rendering, this scraper is static fetch only";
const BROWSER_STILL =
  "page still needs browser rendering, the delegated fetcher did not return a rendered body";
const NO_CONTENT =
  "no readable article content found in the static html, the page may render its body with JavaScript";
const SCAN_FACTOR = 8;

export interface ScrapeRow {
  url: string;
  finalUrl: string;
  ok: boolean;
  title: string;
  canonical: string;
  publishedAt: string | null;
  siteName: string | null;
  chunks: Chunk[];
  chunksOmitted: number;
  chars: number;
  truncated: boolean;
  redirects: string[];
  error?: string;
}

export interface ScrapeOptions {
  query: string;
  config: ScrapeConfig;
  maxCharsPerUrl?: number;
  maxChunksPerUrl?: number;
  signal?: AbortSignal;
}

const failedRow = (url: string, error: string, finalUrl = url): ScrapeRow => ({
  url,
  finalUrl,
  ok: false,
  title: "",
  canonical: "",
  publishedAt: null,
  siteName: null,
  chunks: [],
  chunksOmitted: 0,
  chars: 0,
  truncated: false,
  redirects: [],
  error,
});

const scrapeOne = async (
  url: string,
  options: ScrapeOptions,
): Promise<ScrapeRow> => {
  const { config } = options;
  const maxChars = options.maxCharsPerUrl ?? config.maxCharsPerUrl;
  const maxChunks = options.maxChunksPerUrl ?? config.maxChunksPerUrl;

  const fetchOptions = {
    timeoutMs: config.timeout,
    maxResponseBytes: config.maxResponseBytes,
    allowPrivateIps: config.allowPrivateIps,
    signal: options.signal,
  };
  const outcome = config.fetcher.url
    ? await fetchVia(url, config.fetcher, fetchOptions)
    : await fetchPage(url, fetchOptions);

  if (!outcome.ok) {
    return {
      ...failedRow(url, outcome.error ?? "fetch failed", outcome.url),
      redirects: outcome.redirects,
    };
  }

  let extraction: ReturnType<typeof extract>;
  try {
    extraction = extract(outcome.html, outcome.url, {
      hideImages: config.hideImages,
    });
  } catch (err) {
    logger.warn(LOG_NS, `extraction failed for ${url}`, err);
    return failedRow(url, "extraction failed", outcome.url);
  }

  if (extraction.needsBrowser || !extraction.text.trim()) {
    const delegated = Boolean(config.fetcher.url);
    const unrendered = delegated ? BROWSER_STILL : BROWSER_NEEDED;
    return {
      ...failedRow(url, extraction.needsBrowser ? unrendered : NO_CONTENT, outcome.url),
      title: extraction.title,
      canonical: extraction.canonical,
      redirects: outcome.redirects,
    };
  }

  const scanned = capChars(extraction.text, maxChars * SCAN_FACTOR);
  const picked = pickChunks(
    scanned,
    options.query,
    config.chunkChars,
    maxChunks,
    maxChars,
  );
  const chars = picked.chunks.reduce((total, chunk) => total + chunk.text.length, 0);

  return {
    url,
    finalUrl: outcome.url,
    ok: picked.chunks.length > 0,
    title: extraction.title,
    canonical: extraction.canonical,
    publishedAt: extraction.publishedAt,
    siteName: extraction.siteName,
    chunks: picked.chunks,
    chunksOmitted: picked.omitted,
    chars,
    truncated: outcome.truncated || extraction.text.length > chars,
    redirects: outcome.redirects,
    ...(picked.chunks.length ? {} : { error: "no usable evidence extracted" }),
  };
};

export const scrapeUrls = async (
  urls: string[],
  options: ScrapeOptions,
): Promise<ScrapeRow[]> =>
  runPooled(urls, options.config.concurrency, async (url) => {
    try {
      return await scrapeOne(url, options);
    } catch (err) {
      logger.warn(LOG_NS, `scrape failed for ${url}`, err);
      return failedRow(url, err instanceof Error ? err.message : "scrape failed");
    }
  });

export const BROWSER_HINT = BROWSER_NEEDED;
