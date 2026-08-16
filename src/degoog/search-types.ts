import { CacheNamespace, cacheKey } from "../cache/keys.ts";
import type { MemoryCache } from "../cache/memory.ts";
import { logger } from "../utils/logger.ts";
import type { DegoogClient } from "./client.ts";
import { DegoogRoute, type DegoogTab } from "./types.ts";

const LOG_NS = "search-types";
const ENGINE_PREFIX = "engine:";
const ENGINE_DASH_PREFIX = "engine-";
const TAB_PREFIX = "tab:";
const TYPES_TTL_MS = 300_000;

export const WEB_TYPE = "web";

export enum SearchTypeKind {
  Web = "web",
  Engine = "engine",
  Tab = "tab",
}

export interface SearchTypeInfo {
  id: string;
  name: string;
  kind: SearchTypeKind;
  tabId?: string;
}

export interface TypeCatalog {
  types: SearchTypeInfo[];
  aliases: string[];
}

export interface ResolvedType {
  requested: string;
  value: string;
  info: SearchTypeInfo | null;
  known: boolean;
}

export const WEB_SEARCH_TYPE: SearchTypeInfo = {
  id: WEB_TYPE,
  name: "Web",
  kind: SearchTypeKind.Web,
};

export const plainType = (raw: string): string => {
  let value = raw.trim();
  while (value.startsWith(TAB_PREFIX)) value = value.slice(TAB_PREFIX.length);
  if (value.startsWith(ENGINE_PREFIX)) value = value.slice(ENGINE_PREFIX.length);
  return value.trim();
};

interface PendingType {
  raw: string;
  id: string;
  name: string;
  kind: SearchTypeKind;
  tabId?: string;
}

const toPending = (tab: DegoogTab): PendingType | null => {
  if (typeof tab?.id !== "string") return null;

  const engineBacked = tab.id.startsWith(ENGINE_PREFIX);
  const id = plainType(tab.id);
  if (!id) return null;

  return {
    raw: tab.id,
    id,
    name: tab.name || id,
    kind: engineBacked ? SearchTypeKind.Engine : SearchTypeKind.Tab,
    ...(engineBacked ? {} : { tabId: tab.id }),
  };
};

const infoOf = (entry: PendingType): SearchTypeInfo => ({
  id: entry.id,
  name: entry.name,
  kind: entry.kind,
  ...(entry.tabId ? { tabId: entry.tabId } : {}),
});

export const toTypeCatalog = (tabs: DegoogTab[]): TypeCatalog => {
  const seen = new Set<string>([WEB_TYPE]);
  const types: SearchTypeInfo[] = [WEB_SEARCH_TYPE];
  const aliases: string[] = [];

  const pending = tabs
    .map(toPending)
    .filter((entry): entry is PendingType => entry !== null);

  for (const entry of pending) {
    if (entry.raw.startsWith(ENGINE_PREFIX)) aliases.push(entry.raw);
    if (entry.id.toLowerCase().startsWith(ENGINE_DASH_PREFIX)) continue;

    const key = entry.id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    types.push(infoOf(entry));
  }

  for (const entry of pending) {
    const key = entry.id.toLowerCase();
    if (!key.startsWith(ENGINE_DASH_PREFIX)) continue;

    if (seen.has(key.slice(ENGINE_DASH_PREFIX.length))) {
      aliases.push(entry.id);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    types.push(infoOf(entry));
  }

  return { types, aliases: [...new Set(aliases)] };
};

export const toSearchTypes = (tabs: DegoogTab[]): SearchTypeInfo[] =>
  toTypeCatalog(tabs).types;

export const matchType = (
  raw: string,
  known: SearchTypeInfo[],
): SearchTypeInfo | null => {
  const wanted = plainType(raw).toLowerCase();
  if (!wanted) return null;

  const exact = known.find((entry) => entry.id.toLowerCase() === wanted);
  if (exact) return exact;

  if (!wanted.startsWith(ENGINE_DASH_PREFIX)) return null;
  const target = wanted.slice(ENGINE_DASH_PREFIX.length);
  return known.find((entry) => entry.id.toLowerCase() === target) ?? null;
};

export const listTypeCatalog = async (
  client: DegoogClient,
  cache: MemoryCache,
  signal?: AbortSignal,
): Promise<TypeCatalog> => {
  const key = cacheKey(CacheNamespace.SearchTypes, { base: client.baseUrl });
  const hit = cache.get<TypeCatalog>(key);
  if (hit) return hit;

  const raw = await client.json<{ tabs?: unknown }>({
    path: DegoogRoute.SearchTabs,
    signal,
  });
  const tabs = Array.isArray(raw?.tabs) ? (raw.tabs as DegoogTab[]) : [];
  const catalog = toTypeCatalog(tabs);

  cache.set(key, catalog, TYPES_TTL_MS);
  return catalog;
};

export const listSearchTypes = async (
  client: DegoogClient,
  cache: MemoryCache,
  signal?: AbortSignal,
): Promise<SearchTypeInfo[]> =>
  (await listTypeCatalog(client, cache, signal)).types;

export const resolveType = async (
  client: DegoogClient,
  cache: MemoryCache,
  raw: string | undefined,
  signal?: AbortSignal,
): Promise<ResolvedType> => {
  const requested = raw?.trim() ?? "";
  const stripped = plainType(requested);

  if (!stripped || stripped.toLowerCase() === WEB_TYPE) {
    return { requested, value: WEB_TYPE, info: WEB_SEARCH_TYPE, known: true };
  }

  try {
    const match = matchType(requested, await listSearchTypes(client, cache, signal));
    if (match) {
      return { requested, value: match.id, info: match, known: true };
    }
    logger.debug(LOG_NS, `unknown search type "${requested}", sending it as-is`);
  } catch (err) {
    logger.warn(LOG_NS, "search type lookup failed, sending the type as-is", err);
  }

  return { requested, value: stripped, info: null, known: false };
};
