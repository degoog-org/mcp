import { z } from "zod";
import { splitBudget } from "../bundle/budget.ts";
import { pickCandidates } from "../bundle/candidate-picker.ts";
import { buildPack, nextActions, type EvidencePack } from "../bundle/evidence-pack.ts";
import { gatherInDegoogOrder, type GatherOutcome } from "../bundle/gather.ts";
import { expandQueries } from "../bundle/query-expansion.ts";
import { QueryExpansion } from "../config/schema.ts";
import { searchCached } from "../degoog/cached.ts";
import type { DegoogSearchResponse } from "../degoog/types.ts";
import { wantsDetail } from "../output/compact.ts";
import { errorResult, fromError, ToolErrorKind } from "../output/errors.ts";
import { toolResult, type ToolResult } from "../output/structured.ts";
import { bundleText } from "../output/visible.ts";
import { runPipeline } from "../search/pipeline.ts";
import { noteScrapeRows } from "../scrape/failures.ts";
import { scrapeUrls } from "../scrape/pipeline.ts";
import { logger } from "../utils/logger.ts";
import { shortQuery } from "../utils/redact.ts";
import type { ToolContext } from "./context.ts";
import { toSourceRow, unknownTypeNote } from "./search.ts";

const LOG_NS = "tool-bundle";

export const bundleShape = {
  query: z.string().optional().describe("Single research query."),
  queries: z
    .array(z.string())
    .optional()
    .describe("Explicit query list, used instead of query."),
  type: z.string().optional().describe("Search tab/type, defaults to web."),
  lang: z.string().optional().describe("Language code, e.g. en."),
  time: z.string().optional().describe("Time filter, e.g. week."),
  expandQueries: z
    .boolean()
    .optional()
    .describe("Allow suggestion-based query expansion for this call."),
  maxScrapeUrls: z
    .number()
    .int()
    .min(1)
    .max(12)
    .optional()
    .describe("How many sources to read."),
  maxEvidenceChars: z
    .number()
    .int()
    .min(500)
    .max(40000)
    .optional()
    .describe("Total evidence character budget."),
};

export type BundleArgs = z.infer<z.ZodObject<typeof bundleShape>>;

export interface BundleOutcome {
  pack: EvidencePack;
  searched: string[];
  expansion: { used: boolean; source: string; added: string[] };
  omitted: number;
  gathered: GatherOutcome;
  structured: Record<string, unknown>;
}

export const CANDIDATE_POOL_FACTOR = 2;

const askedQueries = (args: BundleArgs): string[] => {
  const list = args.queries?.length
    ? args.queries
    : args.query
      ? [args.query]
      : [];
  return list.map((entry) => entry.trim()).filter(Boolean);
};

const queryLimit = (args: BundleArgs, maxQueries: number): number =>
  Math.min(args.queries?.length ?? 1, Math.max(1, maxQueries));

export const runBundle = async (
  ctx: ToolContext,
  args: BundleArgs,
  signal?: AbortSignal,
): Promise<BundleOutcome> => {
  const { config } = ctx;
  const settings = config.bundleSearch;

  const asked = askedQueries(args);
  const base = asked.slice(0, queryLimit(args, settings.maxQueries));
  const rankQuery = base[0];

  if (!rankQuery) {
    throw new Error("bundle_search requires query or queries");
  }

  let typeWarning: string | undefined;

  const searchOne = async (
    query: string,
  ): Promise<{ query: string; response: DegoogSearchResponse }> => {
    const outcome = await searchCached(
      ctx.client,
      ctx.cache,
      {
        query,
        type: args.type,
        lang: args.lang,
        time: args.time,
      },
      signal,
    );
    typeWarning = unknownTypeNote(outcome.searchType);
    return { query, response: outcome.response };
  };

  const primary = await Promise.all(base.map(searchOne));

  const mode = args.expandQueries
    ? settings.queryExpansion === QueryExpansion.Off
      ? QueryExpansion.Suggestions
      : settings.queryExpansion
    : settings.queryExpansion;

  const expansion = await expandQueries({
    client: ctx.client,
    cache: ctx.cache,
    mode: args.expandQueries === false ? QueryExpansion.Off : mode,
    baseQueries: base,
    related: primary.flatMap(({ response }) => response.relatedSearches ?? []),
    max: settings.maxExpandedQueries,
    signal,
  });

  const expanded = await Promise.all(expansion.added.map(searchOne));
  const responses = [...primary, ...expanded];

  const target = Math.max(1, args.maxScrapeUrls ?? settings.maxScrapeUrls);
  const attemptCap = Math.max(target, settings.maxScrapeAttempts);

  const pipeline = runPipeline({
    responses,
    rankQuery,
    maxResults: Math.max(
      settings.maxSearchResultsPerQuery,
      attemptCap * CANDIDATE_POOL_FACTOR,
    ),
    snippetChars: config.search.snippetChars,
  });

  const maxChars = args.maxEvidenceChars ?? settings.maxEvidenceChars;
  const budget = splitBudget(maxChars, target);

  const candidates = pickCandidates(pipeline.results, attemptCap);

  const gathered = await gatherInDegoogOrder({
    candidates,
    target,
    firstWave: Math.min(candidates.length, target + settings.scrapeOverage),
    scrape: (urls) =>
      scrapeUrls(urls, {
        query: rankQuery,
        config: config.scrape,
        maxCharsPerUrl: Math.min(budget.perSource, config.scrape.maxCharsPerUrl),
        signal,
      }),
  });

  noteScrapeRows(ctx.cache, gathered.rows);

  const pack = buildPack({
    rows: gathered.rows,
    candidates,
    ranked: pipeline.results,
    maxChars,
  });

  const searched = responses.map(({ query }) => query);

  const structured: Record<string, unknown> = {
    originalQueries: asked,
    searchedQueries: searched,
    queriesOmitted: Math.max(0, asked.length - base.length),
    expansion: {
      used: expansion.added.length > 0,
      source: expansion.source,
      added: expansion.added,
    },
    counts: {
      sources: pack.sources.length,
      chunks: pack.chunks.length,
      failures: pack.failures.length,
      resultsOmitted: pipeline.omitted,
      chunksOmitted: pack.chunksOmitted,
      evidenceChars: pack.charsUsed,
    },
    selectionPolicy: "degoog_order_readable_sources",
    selection: {
      target,
      attempted: gathered.attempted,
      waves: gathered.waves,
      continuedAfterFailure: gathered.continued,
      surplusDiscarded: gathered.surplus,
      candidatesExhausted: gathered.exhausted,
    },
    sources: pack.sources,
    evidence: pack.chunks,
    failedSources: pack.failures,
    nextActions: nextActions(pack, pipeline.omitted),
  };

  if (settings.includeRawResults || wantsDetail(config.output.mode)) {
    structured.rankedResults = pipeline.results.map(toSourceRow);
  }
  if (typeWarning) structured.typeWarning = typeWarning;

  return {
    pack,
    searched,
    expansion: {
      used: expansion.added.length > 0,
      source: expansion.source,
      added: expansion.added,
    },
    omitted: pipeline.omitted,
    gathered,
    structured,
  };
};

export const runBundleTool = async (
  ctx: ToolContext,
  args: BundleArgs,
  signal?: AbortSignal,
): Promise<ToolResult> => {
  const requested = askedQueries(args);
  if (!requested.length) {
    return errorResult(
      ToolErrorKind.Input,
      "provide query or queries",
      "Example: { \"query\": \"bun test runner\" }",
    );
  }

  try {
    const outcome = await runBundle(ctx, args, signal);
    const { pack } = outcome;

    logger.debug(
      LOG_NS,
      `query="${shortQuery(requested[0] as string)}" sources=${pack.sources.length} chunks=${pack.chunks.length} failures=${pack.failures.length}`,
    );

    return toolResult(
      bundleText({
        sources: pack.sources.length,
        chunks: pack.chunks.length,
        failures: pack.failures.length,
        continued: outcome.gathered.continued,
        exhausted: outcome.gathered.exhausted,
      }),
      outcome.structured,
    );
  } catch (err) {
    logger.warn(LOG_NS, "bundle run failed", err);
    return fromError(err, "Check Degoog reachability with the health tool.");
  }
};
