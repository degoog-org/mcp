import { z } from "zod";
import { OutputMode, TextMode } from "../config/schema.ts";
import { searchCached } from "../degoog/cached.ts";
import { SearchTypeKind, type ResolvedType } from "../degoog/search-types.ts";
import { SearchTimeFilter } from "../degoog/types.ts";
import { citeId } from "../output/citations.ts";
import { wantsDetail } from "../output/compact.ts";
import { fromError, ToolErrorKind, errorResult } from "../output/errors.ts";
import { toolResult, type ToolResult } from "../output/structured.ts";
import {
  searchFullText,
  searchText,
  type SearchPack,
} from "../output/visible.ts";
import { recentScrapeFailure } from "../scrape/failures.ts";
import { pickScrapable, runPipeline } from "../search/pipeline.ts";
import type { ShapedResult } from "../search/shape.ts";
import { logger } from "../utils/logger.ts";
import { shortQuery } from "../utils/redact.ts";
import type { ToolContext } from "./context.ts";

const LOG_NS = "tool-search";

export const searchShape = {
  query: z.string().min(1).describe("Search query to send to Degoog."),
  type: z
    .string()
    .optional()
    .describe("Search tab/type, defaults to web. Use discover for valid values."),
  page: z.number().int().min(1).max(10).optional().describe("Result page, 1-10."),
  time: z
    .enum(Object.values(SearchTimeFilter) as [string, ...string[]])
    .optional()
    .describe("Time filter. Use custom with dateFrom/dateTo."),
  lang: z.string().optional().describe("Language code, e.g. en."),
  dateFrom: z.string().optional().describe("YYYY-MM-DD, only with time=custom."),
  dateTo: z.string().optional().describe("YYYY-MM-DD, only with time=custom."),
  engines: z
    .array(z.string())
    .optional()
    .describe("Engine ids to use. Omit for instance defaults."),
  safeMode: z.string().optional().describe("Safe search level."),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe("Cap on returned results."),
};

export type SearchArgs = z.infer<z.ZodObject<typeof searchShape>>;

export interface SourceRow {
  id: string;
  title: string;
  url: string;
  domain: string;
  snippet: string;
  engines: string[];
  degoogScore: number;
  reasons: string[];
}

export const unknownTypeNote = (searchType: ResolvedType): string | undefined =>
  searchType.known
    ? undefined
    : `"${searchType.requested}" is not an advertised search type, Degoog was asked for "${searchType.value}". Run discover for the values that work here.`;

export const toSourceRow = (result: ShapedResult, index: number): SourceRow => ({
  id: citeId(index),
  title: result.title,
  url: result.url,
  domain: result.domain,
  snippet: result.snippet,
  engines: result.engines,
  degoogScore: result.degoogScore,
  reasons: result.reasons,
});

export const searchVisible = (mode: TextMode, pack: SearchPack): string =>
  mode === TextMode.Full ? searchFullText(pack) : searchText(pack.summary);

export const runSearchTool = async (
  ctx: ToolContext,
  args: SearchArgs,
  signal?: AbortSignal,
): Promise<ToolResult> => {
  const query = args.query.trim();
  if (!query) {
    return errorResult(ToolErrorKind.Input, "query must not be empty");
  }

  const { config } = ctx;
  const maxResults = Math.min(args.maxResults ?? config.search.maxResults, 50);

  try {
    const { response, searchType } = await searchCached(
      ctx.client,
      ctx.cache,
      {
        query,
        type: args.type,
        page: args.page,
        time: args.time,
        lang: args.lang,
        dateFrom: args.dateFrom,
        dateTo: args.dateTo,
        engines: args.engines,
        safeMode: args.safeMode,
      },
      signal,
    );

    const pipeline = runPipeline({
      responses: [{ query, response }],
      rankQuery: query,
      maxResults,
      snippetChars: config.search.snippetChars,
    });

    const sources = pipeline.results.map(toSourceRow);
    const recommended = pickScrapable(
      pipeline.results,
      Math.min(config.scrape.maxUrls, sources.length),
    ).map((result) => {
      const row = sources.find((source) => source.url === result.url);
      const failure = recentScrapeFailure(ctx.cache, result.url);
      return {
        id: row?.id ?? "",
        url: result.url,
        reason: result.reasons[0] ?? "top Degoog-ranked result",
        ...(failure
          ? { scrapeStatus: failure.status, scrapeFailure: failure.reason }
          : {}),
      };
    });

    logger.debug(
      LOG_NS,
      `query="${shortQuery(query)}" results=${sources.length} omitted=${pipeline.omitted}`,
    );

    const structured: Record<string, unknown> = {
      query,
      type: searchType.value,
      typeKind: searchType.info?.kind ?? SearchTypeKind.Web,
      page: args.page ?? 1,
      counts: {
        returned: sources.length,
        omitted: pipeline.omitted,
        duplicatesMerged: pipeline.merged,
        domains: pipeline.domains,
        engines: pipeline.engines,
      },
      results: sources,
      scrapeRecommendations: recommended,
      relatedSearches: pipeline.related.slice(0, 6),
      textMode: config.search.textMode,
    };

    const typeWarning = unknownTypeNote(searchType);
    if (typeWarning) structured.typeWarning = typeWarning;

    if (wantsDetail(config.output.mode)) {
      structured.sourceOverlap = pipeline.overlap;
      structured.timings = {
        totalMs: response.totalTime,
        engines: response.engineTimings ?? [],
      };
    }
    if (config.output.mode === OutputMode.Full) {
      structured.rawResultCount = response.results?.length ?? 0;
    }

    return toolResult(
      searchVisible(config.search.textMode, {
        summary: {
          results: sources.length,
          domains: pipeline.domains,
          engines: pipeline.engines,
          recommended: recommended.length,
          note: typeWarning,
        },
        results: sources,
      }),
      structured,
    );
  } catch (err) {
    logger.warn(LOG_NS, `search failed for "${shortQuery(query)}"`, err);
    return fromError(err, "Check Degoog reachability with the health tool.");
  }
};
