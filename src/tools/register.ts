import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ToolResult } from "../output/structured.ts";
import { runBundleTool, bundleShape, type BundleArgs } from "./bundle-search.ts";
import { runCommandTool, commandShape, type CommandArgs } from "./command.ts";
import { ToolName, type ToolContext } from "./context.ts";
import {
  runDeepTool,
  deepShape,
  DEEP_SEARCH_DESCRIPTION,
  type DeepArgs,
} from "./deep-search.ts";
import { runDiscoverTool } from "./discover.ts";
import { runHealthTool } from "./health.ts";
import { runRetryTool, retryShape, type RetryArgs } from "./retry-engine.ts";
import { runScrapeTool, scrapeShape, type ScrapeArgs } from "./scrape.ts";
import { runSearchTool, searchShape, type SearchArgs } from "./search.ts";

const READ_ONLY = { readOnlyHint: true, openWorldHint: true } as const;

const asCallResult = (result: ToolResult): CallToolResult =>
  result as unknown as CallToolResult;

export interface RegisterOptions {
  ctx: ToolContext;
  authRequired: boolean;
}

export const registerTools = (
  server: McpServer,
  options: RegisterOptions,
): void => {
  const { ctx } = options;

  server.registerTool(
    ToolName.Search,
    {
      title: "Degoog search",
      description:
        "Run a Degoog search and get compact ranked results with stable [S1] source ids and scrape recommendations.",
      inputSchema: searchShape,
      annotations: READ_ONLY,
    },
    async (args, extra) =>
      asCallResult(await runSearchTool(ctx, args as SearchArgs, extra.signal)),
  );

  server.registerTool(
    ToolName.Scrape,
    {
      title: "Scrape URLs",
      description:
        "Fetch explicit http(s) URLs and return cleaned evidence chunks. Static fetch only, no JavaScript rendering, so app-shell pages come back as failure rows. One row per URL, including failures.",
      inputSchema: scrapeShape,
      annotations: READ_ONLY,
    },
    async (args, extra) =>
      asCallResult(await runScrapeTool(ctx, args as ScrapeArgs, extra.signal)),
  );

  server.registerTool(
    ToolName.BundleSearch,
    {
      title: "Bundle search",
      description:
        "Search, read sources in Degoog order, and return one compact evidence pack. Simplest single call for small models. Does not write the answer.",
      inputSchema: bundleShape,
      annotations: READ_ONLY,
    },
    async (args, extra) =>
      asCallResult(await runBundleTool(ctx, args as BundleArgs, extra.signal)),
  );

  server.registerTool(
    ToolName.DeepSearch,
    {
      title: "Deep search",
      description: DEEP_SEARCH_DESCRIPTION,
      inputSchema: deepShape,
      annotations: READ_ONLY,
    },
    async (args, extra) =>
      asCallResult(await runDeepTool(ctx, args as DeepArgs, extra.signal)),
  );

  server.registerTool(
    ToolName.Discover,
    {
      title: "Discover capabilities",
      description:
        "List Degoog search types, engine ids, commands, suggestion availability, tool caps, and whether deep search is enabled.",
      annotations: READ_ONLY,
    },
    async (extra) => asCallResult(await runDiscoverTool(ctx, extra.signal)),
  );

  server.registerTool(
    ToolName.RetryEngine,
    {
      title: "Retry one engine",
      description:
        "Re-run a single Degoog engine for a query instead of repeating the whole search.",
      inputSchema: retryShape,
      annotations: READ_ONLY,
    },
    async (args, extra) =>
      asCallResult(await runRetryTool(ctx, args as RetryArgs, extra.signal)),
  );

  server.registerTool(
    ToolName.Command,
    {
      title: "Run bang command",
      description:
        "Run a Degoog bang command such as !uuid and return its rendered output as text.",
      inputSchema: commandShape,
      annotations: READ_ONLY,
    },
    async (args, extra) =>
      asCallResult(await runCommandTool(ctx, args as CommandArgs, extra.signal)),
  );

  server.registerTool(
    ToolName.Health,
    {
      title: "Sidecar health",
      description:
        "Report MCP health, Degoog reachability, auth status, enabled tools, and configured caps.",
      annotations: READ_ONLY,
    },
    async () => asCallResult(await runHealthTool(ctx, options.authRequired)),
  );
};
