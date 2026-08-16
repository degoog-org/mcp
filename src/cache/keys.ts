export enum CacheNamespace {
  Search = "search",
  Scrape = "scrape",
  Suggest = "suggest",
  Discover = "discover",
  SearchTypes = "search-types",
  ScrapeFailure = "scrape-failure",
}

const stable = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value !== "object") return String(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${key}=${stable(item)}`);

  return `{${entries.join(",")}}`;
};

export const cacheKey = (
  namespace: CacheNamespace,
  parts: Record<string, unknown>,
): string => `${namespace}:${stable(parts)}`;
