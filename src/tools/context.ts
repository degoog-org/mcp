import type { MemoryCache } from "../cache/memory.ts";
import type { McpConfig } from "../config/schema.ts";
import type { DegoogClient } from "../degoog/client.ts";

export interface ToolContext {
  config: McpConfig;
  client: DegoogClient;
  cache: MemoryCache;
  configPath: string;
  startedAt: number;
}

export enum ToolName {
  Search = "search",
  Scrape = "scrape",
  BundleSearch = "bundle_search",
  DeepSearch = "deep_search",
  Discover = "discover",
  RetryEngine = "retry_engine",
  Command = "command",
  Health = "health",
}
