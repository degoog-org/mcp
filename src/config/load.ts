import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parse } from "yaml";
import { logger } from "../utils/logger.ts";
import {
  DEFAULT_CONFIG,
  DEFAULT_CONFIG_PATH,
  DEFAULT_CONFIG_YAML,
} from "./defaults.ts";
import { EnvVar, readEnv } from "./env.ts";
import { expandEnvDeep } from "./interpolate.ts";
import { ProviderId } from "../llm/types.ts";
import {
  OutputMode,
  ProviderFallback,
  QueryExpansion,
  ScrapeRenderer,
  TextMode,
  type McpConfig,
} from "./schema.ts";

const LOG_NS = "config";

export interface LoadResult {
  config: McpConfig;
  path: string;
  created: boolean;
}

export interface LoadOptions {
  path?: string;
  createIfMissing?: boolean;
}

type Raw = Record<string, unknown>;

const asRaw = (value: unknown): Raw =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Raw)
    : {};

const asNumber = (value: unknown, fallback: number): number => {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed)
    ? parsed
    : fallback;
};

const asBool = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (["true", "1", "yes", "on"].includes(value.toLowerCase())) return true;
    if (["false", "0", "no", "off"].includes(value.toLowerCase())) return false;
  }
  return fallback;
};

const asText = (value: unknown, fallback: string): string =>
  typeof value === "string" ? value : fallback;

const asOneOf = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T => {
  const raw = typeof value === "boolean" ? (value ? "on" : "off") : value;
  return typeof raw === "string" && allowed.includes(raw as T)
    ? (raw as T)
    : fallback;
};

const positive = (value: unknown, fallback: number): number => {
  const parsed = asNumber(value, fallback);
  return parsed > 0 ? Math.floor(parsed) : fallback;
};

const nonNegative = (value: unknown, fallback: number): number => {
  const parsed = asNumber(value, fallback);
  return parsed >= 0 ? Math.floor(parsed) : fallback;
};

const mergeConfig = (raw: Raw): McpConfig => {
  const server = asRaw(raw.server);
  const degoog = asRaw(raw.degoog);
  const output = asRaw(raw.output);
  const search = asRaw(raw.search);
  const scrape = asRaw(raw.scrape);
  const bundle = asRaw(raw.bundleSearch);
  const deep = asRaw(raw.deepSearch);
  const cache = asRaw(raw.cache);
  const d = DEFAULT_CONFIG;

  return {
    server: {
      host: asText(server.host, d.server.host),
      port: positive(server.port, d.server.port),
      authTokenEnv: asText(server.authTokenEnv, d.server.authTokenEnv),
      idleTimeout: positive(server.idleTimeout, d.server.idleTimeout),
    },
    degoog: {
      url: asText(degoog.url, d.degoog.url).replace(/\/+$/, ""),
      apiKeyEnv: asText(degoog.apiKeyEnv, d.degoog.apiKeyEnv),
      timeout: positive(degoog.timeout, d.degoog.timeout),
    },
    output: {
      mode: asOneOf(output.mode, Object.values(OutputMode), d.output.mode),
      guidance: asBool(output.guidance, d.output.guidance),
    },
    search: {
      maxResults: positive(search.maxResults, d.search.maxResults),
      snippetChars: positive(search.snippetChars, d.search.snippetChars),
      textMode: asOneOf(
        search.textMode,
        Object.values(TextMode),
        d.search.textMode,
      ),
    },
    scrape: {
      renderer: asOneOf(
        scrape.renderer,
        Object.values(ScrapeRenderer),
        d.scrape.renderer,
      ),
      maxUrls: positive(scrape.maxUrls, d.scrape.maxUrls),
      concurrency: positive(scrape.concurrency, d.scrape.concurrency),
      timeout: positive(scrape.timeout, d.scrape.timeout),
      maxResponseBytes: positive(
        scrape.maxResponseBytes,
        d.scrape.maxResponseBytes,
      ),
      maxCharsPerUrl: positive(scrape.maxCharsPerUrl, d.scrape.maxCharsPerUrl),
      maxChunksPerUrl: positive(
        scrape.maxChunksPerUrl,
        d.scrape.maxChunksPerUrl,
      ),
      chunkChars: positive(scrape.chunkChars, d.scrape.chunkChars),
      allowPrivateIps: asBool(
        scrape.allowPrivateIps,
        d.scrape.allowPrivateIps,
      ),
      hideImages: asBool(scrape.hideImages, d.scrape.hideImages),
      maxEvidenceChars: positive(
        scrape.maxEvidenceChars,
        d.scrape.maxEvidenceChars,
      ),
      textMode: asOneOf(
        scrape.textMode,
        Object.values(TextMode),
        d.scrape.textMode,
      ),
    },
    bundleSearch: {
      maxQueries: positive(bundle.maxQueries, d.bundleSearch.maxQueries),
      queryExpansion: asOneOf(
        bundle.queryExpansion,
        Object.values(QueryExpansion),
        d.bundleSearch.queryExpansion,
      ),
      maxExpandedQueries: positive(
        bundle.maxExpandedQueries,
        d.bundleSearch.maxExpandedQueries,
      ),
      maxSearchResultsPerQuery: positive(
        bundle.maxSearchResultsPerQuery,
        d.bundleSearch.maxSearchResultsPerQuery,
      ),
      maxScrapeUrls: positive(
        bundle.maxScrapeUrls,
        d.bundleSearch.maxScrapeUrls,
      ),
      scrapeOverage: nonNegative(
        bundle.scrapeOverage,
        d.bundleSearch.scrapeOverage,
      ),
      maxScrapeAttempts: positive(
        bundle.maxScrapeAttempts,
        d.bundleSearch.maxScrapeAttempts,
      ),
      maxEvidenceChars: positive(
        bundle.maxEvidenceChars,
        d.bundleSearch.maxEvidenceChars,
      ),
      includeRawResults: asBool(
        bundle.includeRawResults,
        d.bundleSearch.includeRawResults,
      ),
      textMode: asOneOf(
        bundle.textMode,
        Object.values(TextMode),
        d.bundleSearch.textMode,
      ),
      timeout: positive(bundle.timeout, d.bundleSearch.timeout),
    },
    deepSearch: {
      enabled: asBool(deep.enabled, d.deepSearch.enabled),
      provider: asOneOf(
        deep.provider,
        Object.values(ProviderId),
        d.deepSearch.provider,
      ),
      model: asText(deep.model, d.deepSearch.model).trim(),
      baseUrl: asText(deep.baseUrl, d.deepSearch.baseUrl).trim(),
      apiKey: asText(deep.apiKey, d.deepSearch.apiKey).trim(),
      maxTokens: positive(deep.maxTokens, d.deepSearch.maxTokens),
      enableThinking: asBool(
        deep.enableThinking,
        d.deepSearch.enableThinking,
      ),
      onProviderUnavailable: asOneOf(
        deep.onProviderUnavailable,
        Object.values(ProviderFallback),
        d.deepSearch.onProviderUnavailable,
      ),
      maxIterations: positive(
        deep.maxIterations,
        d.deepSearch.maxIterations,
      ),
      maxQueriesPerIteration: positive(
        deep.maxQueriesPerIteration,
        d.deepSearch.maxQueriesPerIteration,
      ),
      maxScrapeUrls: positive(
        deep.maxScrapeUrls,
        d.deepSearch.maxScrapeUrls,
      ),
      scrapeOverage: nonNegative(
        deep.scrapeOverage,
        d.deepSearch.scrapeOverage,
      ),
      maxScrapeAttempts: positive(
        deep.maxScrapeAttempts,
        d.deepSearch.maxScrapeAttempts,
      ),
      maxEvidenceChars: positive(
        deep.maxEvidenceChars,
        d.deepSearch.maxEvidenceChars,
      ),
      requireCitations: asBool(
        deep.requireCitations,
        d.deepSearch.requireCitations,
      ),
      timeout: positive(deep.timeout, d.deepSearch.timeout),
      providerTimeout: positive(
        deep.providerTimeout,
        d.deepSearch.providerTimeout,
      ),
      reportTimeout: positive(deep.reportTimeout, d.deepSearch.reportTimeout),
    },
    cache: {
      enabled: asBool(cache.enabled, d.cache.enabled),
      ttl: positive(cache.ttl, d.cache.ttl),
      maxEntries: positive(cache.maxEntries, d.cache.maxEntries),
      maxBytes: positive(cache.maxBytes, d.cache.maxBytes),
    },
  };
};

const applyEnv = (config: McpConfig): McpConfig => {
  const url = readEnv(EnvVar.DegoogUrl);
  const port = readEnv(EnvVar.Port);
  const host = process.env[EnvVar.BindHost];

  return {
    ...config,
    server: {
      ...config.server,
      host: host === undefined ? config.server.host : host.trim(),
      port: port ? positive(port, config.server.port) : config.server.port,
    },
    degoog: {
      ...config.degoog,
      url: url ? url.replace(/\/+$/, "") : config.degoog.url,
    },
  };
};

export const configPath = (override?: string): string =>
  override || readEnv(EnvVar.ConfigPath) || DEFAULT_CONFIG_PATH;

const writeSeed = async (path: string): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  const temp = join(dirname(path), `.mcp.yml.${process.pid}.tmp`);
  await writeFile(temp, DEFAULT_CONFIG_YAML, "utf8");
  await rename(temp, path);
};

export const loadConfig = async (
  options: LoadOptions = {},
): Promise<LoadResult> => {
  const path = configPath(options.path);
  const createIfMissing = options.createIfMissing ?? true;

  let text: string | null = null;
  try {
    text = await readFile(path, "utf8");
  } catch {
    text = null;
  }

  let created = false;
  if (text === null && createIfMissing) {
    try {
      await writeSeed(path);
      text = DEFAULT_CONFIG_YAML;
      created = true;
      logger.info(LOG_NS, `created default config at ${path}`);
    } catch (err) {
      logger.warn(LOG_NS, `could not create config at ${path}`, err);
    }
  }

  if (text === null) {
    logger.warn(LOG_NS, `no config at ${path}, using built-in defaults`);
    return { config: applyEnv(DEFAULT_CONFIG), path, created };
  }

  let parsed: Raw = {};
  try {
    parsed = asRaw(expandEnvDeep(parse(text)));
  } catch (err) {
    logger.error(LOG_NS, `invalid YAML at ${path}, using defaults`, err);
  }

  return { config: applyEnv(mergeConfig(parsed)), path, created };
};
