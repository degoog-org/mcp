import type { ProviderId } from "../llm/types.ts";

export enum OutputMode {
  Compact = "compact",
  Balanced = "balanced",
  Full = "full",
  StructuredOnly = "structured-only",
}

export enum TextMode {
  Compact = "compact",
  Full = "full",
}

export enum ScrapeRenderer {
  Static = "static",
}

export enum QueryExpansion {
  Off = "off",
  Suggestions = "suggestions",
  Related = "related",
}

export enum ProviderFallback {
  BundleSearch = "bundle_search",
  Off = "off",
}


export interface ServerConfig {
  host: string;
  port: number;
  authTokenEnv: string;
}

export interface DegoogConfig {
  url: string;
  apiKeyEnv: string;
  timeoutMs: number;
}

export interface OutputConfig {
  mode: OutputMode;
}

export interface SearchConfig {
  maxResults: number;
  snippetChars: number;
  textMode: TextMode;
}

export interface ScrapeConfig {
  renderer: ScrapeRenderer;
  maxUrls: number;
  concurrency: number;
  timeoutMs: number;
  maxResponseBytes: number;
  maxCharsPerUrl: number;
  maxChunksPerUrl: number;
  chunkChars: number;
  allowPrivateIps: boolean;
}

export interface BundleSearchConfig {
  maxQueries: number;
  queryExpansion: QueryExpansion;
  maxExpandedQueries: number;
  maxSearchResultsPerQuery: number;
  maxScrapeUrls: number;
  scrapeOverage: number;
  maxScrapeAttempts: number;
  maxEvidenceChars: number;
  includeRawResults: boolean;
}

export interface DeepSearchConfig {
  enabled: boolean;
  provider: ProviderId;
  model: string;
  baseUrl: string;
  apiKey: string;
  maxTokens: number;
  enableThinking: boolean;
  onProviderUnavailable: ProviderFallback;
  maxIterations: number;
  maxQueriesPerIteration: number;
  maxScrapeUrls: number;
  scrapeOverage: number;
  maxScrapeAttempts: number;
  maxEvidenceChars: number;
  requireCitations: boolean;
}

export interface CacheConfig {
  enabled: boolean;
  ttlMs: number;
  maxEntries: number;
  maxBytes: number;
}

export interface McpConfig {
  server: ServerConfig;
  degoog: DegoogConfig;
  output: OutputConfig;
  search: SearchConfig;
  scrape: ScrapeConfig;
  bundleSearch: BundleSearchConfig;
  deepSearch: DeepSearchConfig;
  cache: CacheConfig;
}

export type PartialConfig = {
  [K in keyof McpConfig]?: Partial<McpConfig[K]>;
};
