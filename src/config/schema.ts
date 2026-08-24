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
  Delegated = "delegated",
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
  idleTimeout: number;
}

export interface DegoogConfig {
  url: string;
  apiKeyEnv: string;
  timeout: number;
}

export interface OutputConfig {
  mode: OutputMode;
  guidance: boolean;
}

export interface SearchConfig {
  maxResults: number;
  snippetChars: number;
  textMode: TextMode;
}

export interface FetcherConfig {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  html: string;
}

export interface ScrapeConfig {
  renderer: ScrapeRenderer;
  fetcher: FetcherConfig;
  maxUrls: number;
  concurrency: number;
  timeout: number;
  maxResponseBytes: number;
  maxCharsPerUrl: number;
  maxChunksPerUrl: number;
  chunkChars: number;
  allowPrivateIps: boolean;
  hideImages: boolean;
  maxEvidenceChars: number;
  textMode: TextMode;
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
  textMode: TextMode;
  timeout: number;
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
  timeout: number;
  providerTimeout: number;
  reportTimeout: number;
}

export interface CacheConfig {
  enabled: boolean;
  ttl: number;
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
