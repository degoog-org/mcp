import { z } from "zod";
import { retryEngine } from "../degoog/retry.ts";
import { plainType } from "../degoog/search-types.ts";
import type { DegoogSearchResponse, DegoogTiming } from "../degoog/types.ts";
import { fromError } from "../output/errors.ts";
import { toolResult, type ToolResult } from "../output/structured.ts";
import { retryText } from "../output/visible.ts";
import { runPipeline } from "../search/pipeline.ts";
import type { ShapedResult } from "../search/shape.ts";
import { logger } from "../utils/logger.ts";
import { toSourceRow } from "./search.ts";
import type { ToolContext } from "./context.ts";

const LOG_NS = "tool-retry";

export const retryShape = {
  query: z.string().min(1).describe("Query to re-run."),
  engine: z
    .string()
    .min(1)
    .describe("Engine id or name to retry. Use discover for valid ids."),
  type: z.string().optional().describe("Search tab/type, defaults to web."),
  page: z.number().int().min(1).max(10).optional().describe("Result page."),
  lang: z.string().optional().describe("Language code."),
};

export type RetryArgs = z.infer<z.ZodObject<typeof retryShape>>;

const sameName = (left: string, right: string): boolean =>
  left.trim().toLowerCase() === right.trim().toLowerCase();

export const retryTiming = (
  response: DegoogSearchResponse,
  engine: string,
): DegoogTiming | undefined =>
  response.timing ??
  response.engineTimings?.find((entry) => sameName(entry.name, engine));

export const countFromEngine = (
  results: ShapedResult[],
  engine: string,
): number =>
  results.filter((result) =>
    result.engines.some((name) => sameName(name, engine)),
  ).length;

export const runRetryTool = async (
  ctx: ToolContext,
  args: RetryArgs,
  signal?: AbortSignal,
): Promise<ToolResult> => {
  try {
    const response = await retryEngine(
      ctx.client,
      {
        query: args.query,
        engine: args.engine,
        type: args.type ? plainType(args.type) : undefined,
        page: args.page,
        lang: args.lang,
      },
      signal,
    );

    const pipeline = runPipeline({
      responses: [{ query: args.query, response }],
      rankQuery: args.query,
      maxResults: ctx.config.search.maxResults,
      snippetChars: ctx.config.search.snippetChars,
    });

    const timing = retryTiming(response, args.engine);
    const engineName = timing?.name ?? args.engine;
    const fromEngine = countFromEngine(pipeline.results, engineName);

    return toolResult(
      retryText({
        engine: engineName,
        engineResults: timing?.resultCount ?? null,
        merged: pipeline.results.length,
        fromEngine,
        status: timing?.status,
      }),
      {
        engine: args.engine,
        engineName,
        query: args.query,
        counts: {
          engineResults: timing?.resultCount ?? null,
          merged: pipeline.results.length,
          fromEngine,
        },
        results: pipeline.results.map(toSourceRow),
        engineTiming: timing,
        engineTimings: response.engineTimings ?? [],
      },
    );
  } catch (err) {
    logger.warn(LOG_NS, `retry failed for engine ${args.engine}`, err);
    return fromError(err, "Use discover to list valid engine ids.");
  }
};
