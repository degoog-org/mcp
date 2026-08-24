import { ProviderId } from "../llm/types.ts";
import {
  OutputMode,
  ProviderFallback,
  QueryExpansion,
  ScrapeRenderer,
  TextMode,
  type McpConfig,
} from "./schema.ts";

export const DEFAULT_CONFIG_PATH = "/data/mcp.yml";
export const DEFAULT_DEGOOG_URL = "http://degoog:4444";
export const DEFAULT_PORT = 4443;

export const DEFAULT_CONFIG: McpConfig = {
  server: {
    host: "",
    port: DEFAULT_PORT,
    authTokenEnv: "DEGOOG_MCP_AUTH_TOKEN",
    idleTimeout: 255000,
  },
  degoog: {
    url: DEFAULT_DEGOOG_URL,
    apiKeyEnv: "DEGOOG_MCP_DEGOOG_API_KEY",
    timeout: 15000,
  },
  output: {
    mode: OutputMode.Compact,
    guidance: true,
  },
  search: {
    maxResults: 8,
    snippetChars: 220,
    textMode: TextMode.Compact,
  },
  scrape: {
    renderer: ScrapeRenderer.Static,
    fetcher: {
      url: "",
      method: "GET",
      headers: {},
      body: "",
      html: "",
    },
    maxUrls: 4,
    concurrency: 4,
    timeout: 15000,
    maxResponseBytes: 2097152,
    maxCharsPerUrl: 3000,
    maxChunksPerUrl: 4,
    chunkChars: 700,
    allowPrivateIps: false,
    hideImages: false,
    maxEvidenceChars: 8000,
    textMode: TextMode.Compact,
  },
  bundleSearch: {
    maxQueries: 8,
    queryExpansion: QueryExpansion.Off,
    maxExpandedQueries: 2,
    maxSearchResultsPerQuery: 8,
    maxScrapeUrls: 4,
    scrapeOverage: 3,
    maxScrapeAttempts: 10,
    maxEvidenceChars: 8000,
    includeRawResults: false,
    textMode: TextMode.Compact,
    timeout: 90000,
  },
  deepSearch: {
    enabled: false,
    provider: ProviderId.Ollama,
    model: "",
    baseUrl: "",
    apiKey: "",
    maxTokens: 2000,
    enableThinking: false,
    onProviderUnavailable: ProviderFallback.BundleSearch,
    maxIterations: 2,
    maxQueriesPerIteration: 4,
    maxScrapeUrls: 8,
    scrapeOverage: 4,
    maxScrapeAttempts: 16,
    maxEvidenceChars: 20000,
    requireCitations: true,
    timeout: 240000,
    providerTimeout: 90000,
    reportTimeout: 120000,
  },
  cache: {
    enabled: true,
    ttl: 1800000,
    maxEntries: 512,
    maxBytes: 67108864,
  },
};

export const DEFAULT_CONFIG_YAML = `# Degoog MCP configuration.
# Timeout and ttl values are milliseconds.

server:
  host: ""
  port: 4443
  authTokenEnv: DEGOOG_MCP_AUTH_TOKEN
  idleTimeout: 255000 # bun caps the socket idle timeout at 255000

degoog:
  url: "${DEFAULT_DEGOOG_URL}"
  apiKeyEnv: DEGOOG_MCP_DEGOOG_API_KEY
  timeout: 15000

output:
  mode: compact # compact | balanced | full | structured-only
  guidance: true # false drops the lines that tell a model what to do next

search:
  maxResults: 8
  snippetChars: 220
  textMode: compact

scrape:
  renderer: static
  fetcher: # hand the page fetch to your own http service, worked examples in docs/PROXIES.md
    url: "" # empty means the built in static fetch, supports {{url}} and {{timeout}}
    method: GET
    headers: {}
    body: "" # sent as written, supports {{url}} and {{timeout}} (e.g. '{"url":"{{url}}","maxTimeout":{{timeout}}}')
    html: "" # dot path to the html in a json reply, empty when the body is the html (e.g. "result.body")
  maxUrls: 4
  concurrency: 4
  timeout: 15000
  maxResponseBytes: 2097152
  maxCharsPerUrl: 3000
  maxChunksPerUrl: 4
  chunkChars: 700
  allowPrivateIps: false
  hideImages: false
  maxEvidenceChars: 8000
  textMode: compact # compact | full

bundleSearch:
  maxQueries: 8
  queryExpansion: off # off | suggestions | related
  maxExpandedQueries: 2
  maxSearchResultsPerQuery: 8
  maxScrapeUrls: 4
  scrapeOverage: 3
  maxScrapeAttempts: 10
  maxEvidenceChars: 8000
  includeRawResults: false
  textMode: compact # compact | full
  timeout: 90000

deepSearch:
  enabled: false
  provider: ollama
  model: ""
  baseUrl: ""
  apiKey: ""
  maxTokens: 2000
  enableThinking: false
  onProviderUnavailable: bundle_search
  maxIterations: 2
  maxQueriesPerIteration: 4
  maxScrapeUrls: 8
  scrapeOverage: 4
  maxScrapeAttempts: 16
  maxEvidenceChars: 20000
  requireCitations: true
  timeout: 240000
  providerTimeout: 90000
  reportTimeout: 120000

cache:
  enabled: true
  ttl: 1800000
  maxEntries: 512
  maxBytes: 67108864
`;
