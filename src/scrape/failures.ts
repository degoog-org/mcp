import { CacheNamespace, cacheKey } from "../cache/keys.ts";
import type { MemoryCache } from "../cache/memory.ts";
import { domainOf } from "../utils/urls.ts";
import type { ScrapeRow } from "./pipeline.ts";

const FAILURE_TTL_MS = 600_000;
const HOST_WIDE = /\b(403|429)\b/;

export const RECENT_FAILURE = "recent_failure";

export interface FailureNote {
  status: string;
  reason: string;
}

const domainKey = (url: string): string =>
  cacheKey(CacheNamespace.ScrapeFailure, { domain: domainOf(url) });

const urlKey = (url: string): string =>
  cacheKey(CacheNamespace.ScrapeFailure, { url });

const keyFor = (url: string, reason: string): string =>
  HOST_WIDE.test(reason) ? domainKey(url) : urlKey(url);

export const noteScrapeFailure = (
  cache: MemoryCache,
  url: string,
  reason: string,
): void => {
  cache.set(keyFor(url, reason), reason, FAILURE_TTL_MS);
};

export const noteScrapeRows = (cache: MemoryCache, rows: ScrapeRow[]): void => {
  for (const row of rows) {
    if (row.ok || !row.error) continue;
    noteScrapeFailure(cache, row.url, row.error);
  }
};

export const recentScrapeFailure = (
  cache: MemoryCache,
  url: string,
): FailureNote | null => {
  const hit =
    cache.get<string>(urlKey(url)) ?? cache.get<string>(domainKey(url));
  return hit ? { status: RECENT_FAILURE, reason: hit } : null;
};
