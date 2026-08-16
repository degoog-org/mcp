import type { MemoryCache } from "../cache/memory.ts";
import { CacheNamespace, cacheKey } from "../cache/keys.ts";
import type { DegoogClient } from "./client.ts";
import { runSearch, tabSearch } from "./search.ts";
import { resolveType, SearchTypeKind, type ResolvedType } from "./search-types.ts";
import { getSuggests } from "./suggest.ts";
import type { DegoogSearchResponse, DegoogSuggestion, SearchQueryInput } from "./types.ts";

export interface SearchOutcome {
  response: DegoogSearchResponse;
  searchType: ResolvedType;
}

export const searchCached = async (
  client: DegoogClient,
  cache: MemoryCache,
  input: SearchQueryInput,
  signal?: AbortSignal,
): Promise<SearchOutcome> => {
  const searchType = await resolveType(client, cache, input.type, signal);
  const tabId = searchType.info?.tabId;

  const key = cacheKey(CacheNamespace.Search, {
    base: client.baseUrl,
    query: input.query,
    type: searchType.value,
    tab: tabId ?? "",
    page: input.page ?? 1,
    time: input.time ?? "any",
    lang: input.lang ?? "",
    dateFrom: input.dateFrom ?? "",
    dateTo: input.dateTo ?? "",
    safeMode: input.safeMode ?? "",
    engines: [...(input.engines ?? [])].sort(),
  });

  const hit = cache.get<DegoogSearchResponse>(key);
  if (hit) return { response: hit, searchType };

  const response =
    searchType.info?.kind === SearchTypeKind.Tab && tabId
      ? await tabSearch(client, tabId, input.query, input.page ?? 1, signal)
      : await runSearch(client, { ...input, type: searchType.value }, signal);

  cache.set(key, response);
  return { response, searchType };
};

export const suggestCached = async (
  client: DegoogClient,
  cache: MemoryCache,
  query: string,
  signal?: AbortSignal,
): Promise<DegoogSuggestion[]> => {
  const key = cacheKey(CacheNamespace.Suggest, {
    base: client.baseUrl,
    query,
  });

  const hit = cache.get<DegoogSuggestion[]>(key);
  if (hit) return hit;

  const suggestions = await getSuggests(client, query, signal);
  cache.set(key, suggestions);
  return suggestions;
};
