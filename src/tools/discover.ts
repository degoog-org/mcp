import { CacheNamespace, cacheKey } from "../cache/keys.ts";
import {
  configProblems,
  deepSearchReady,
  fallsBackToBundle,
} from "../deep-search/orchestrator.ts";
import { getCapability, type Capabilities } from "../degoog/discover.ts";
import { fromError } from "../output/errors.ts";
import { toolResult, type ToolResult } from "../output/structured.ts";
import { capList } from "../search/caps.ts";
import { logger } from "../utils/logger.ts";
import { ToolName, type ToolContext } from "./context.ts";

const LOG_NS = "tool-discover";
const MAX_LISTED = 40;
const DISCOVER_TTL_MS = 300_000;

export interface DisabledTool {
  name: string;
  reason: string;
  onCall: string;
  useInstead?: string;
}

export const enabledTools = (ctx: ToolContext): string[] =>
  Object.values(ToolName).filter(
    (name) => name !== ToolName.DeepSearch || deepSearchReady(ctx),
  );

export const disabledTools = (ctx: ToolContext): DisabledTool[] => {
  if (deepSearchReady(ctx)) return [];

  const degrades = fallsBackToBundle(ctx);

  return [
    {
      name: ToolName.DeepSearch,
      reason: ctx.config.deepSearch.enabled
        ? `deepSearch is enabled but not configured in mcp.yml: ${configProblems(ctx).join("; ")}`
        : "deepSearch.enabled is false in mcp.yml",
      onCall: degrades
        ? "it stays registered and every call returns a degraded bundle_search evidence pack, labelled as such"
        : "it stays registered and every call returns an error, nothing runs in its place",
      ...(degrades ? { useInstead: ToolName.BundleSearch } : {}),
    },
  ];
};

export const capsOf = (ctx: ToolContext): Record<string, unknown> => ({
  searchMaxResults: ctx.config.search.maxResults,
  snippetChars: ctx.config.search.snippetChars,
  scrapeMaxUrls: ctx.config.scrape.maxUrls,
  scrapeMaxCharsPerUrl: ctx.config.scrape.maxCharsPerUrl,
  scrapeRenderer: ctx.config.scrape.renderer,
  bundleMaxScrapeUrls: ctx.config.bundleSearch.maxScrapeUrls,
  bundleMaxEvidenceChars: ctx.config.bundleSearch.maxEvidenceChars,
  outputMode: ctx.config.output.mode,
});

export const runDiscoverTool = async (
  ctx: ToolContext,
  signal?: AbortSignal,
): Promise<ToolResult> => {
  try {
    const key = cacheKey(CacheNamespace.Discover, { base: ctx.client.baseUrl });
    const cached = ctx.cache.get<Capabilities>(key);
    const capabilities =
      cached ?? (await getCapability(ctx.client, ctx.cache, signal));
    if (!cached) ctx.cache.set(key, capabilities, DISCOVER_TTL_MS);

    const types = capList(capabilities.searchTypes, MAX_LISTED);
    const engines = capList(capabilities.engines, MAX_LISTED);
    const commands = capList(capabilities.commands, MAX_LISTED);
    const off = disabledTools(ctx);

    const text = [
      `Degoog: ${engines.items.length} engines, ${types.items.length} search types, ${commands.items.length} commands.`,
      `Search types usable as search(type=...): ${types.items.map((entry) => entry.id).join(", ")}.`,
      ...(capabilities.typeAliases.length
        ? [
            `Legacy aliases also accepted, see aliasesAccepted in the structured content: ${capabilities.typeAliases.length}.`,
          ]
        : []),
      `Suggestions: ${capabilities.autocomplete.length ? "available" : "none installed"}.`,
      off.length
        ? `Unavailable tools: ${off.map((entry) => `${entry.name} (${entry.useInstead ? `use ${entry.useInstead}` : "no substitute"})`).join(", ")}.`
        : "All tools are enabled.",
      "Use bundle_search when you want search plus evidence in one call.",
    ].join("\n");

    return toolResult(text, {
      searchTypes: types.items.map((entry) => entry.id),
      aliasesAccepted: capabilities.typeAliases,
      tabs: types.items.map((entry) => ({
        id: entry.id,
        name: entry.name,
        kind: entry.kind,
      })),
      engines: engines.items.map((engine) => ({
        id: engine.id,
        name: engine.name,
        enabled: engine.enabled,
      })),
      commands: commands.items.map((command) => ({
        trigger: command.trigger,
        category: command.category,
      })),
      suggestionsAvailable: capabilities.autocomplete.length > 0,
      deepSearchEnabled: ctx.config.deepSearch.enabled,
      deepSearchReady: deepSearchReady(ctx),
      enabledTools: enabledTools(ctx),
      disabledTools: off,
      caps: capsOf(ctx),
      omitted: {
        tabs: types.omitted,
        engines: engines.omitted,
        commands: commands.omitted,
      },
      problems: capabilities.problems,
    });
  } catch (err) {
    logger.warn(LOG_NS, "discover failed", err);
    return fromError(err);
  }
};
