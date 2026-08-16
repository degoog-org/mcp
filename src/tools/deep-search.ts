import { z } from "zod";
import { missingQuery, runDeepSearch } from "../deep-search/orchestrator.ts";
import type { ToolResult } from "../output/structured.ts";
import type { ToolContext } from "./context.ts";

export const DEEP_SEARCH_DESCRIPTION =
  "Iterative research loop that plans queries, reads sources and writes a cited report using an LLM provider configured on this instance. Needs deepSearch enabled and configured in mcp.yml, otherwise a call either returns a clearly labelled degraded bundle_search pack or an error naming the missing field, depending on deepSearch.onProviderUnavailable. Check discover or health for the live status. Costly, prefer bundle_search unless you need multi-round research.";

export const deepShape = {
  query: z
    .string()
    .optional()
    .describe(
      "Required. Research question to investigate across several searches. Optional in the schema only so a disabled or misconfigured instance can explain itself instead of returning a schema error.",
    ),
  type: z.string().optional().describe("Search tab/type, defaults to web."),
  lang: z.string().optional().describe("Language code, e.g. en."),
};

export type DeepArgs = z.infer<z.ZodObject<typeof deepShape>>;

export const runDeepTool = async (
  ctx: ToolContext,
  args: Partial<DeepArgs>,
  signal?: AbortSignal,
): Promise<ToolResult> => {
  const query = args.query?.trim() ?? "";
  if (!query) return missingQuery(ctx);

  return runDeepSearch(ctx, {
    query,
    type: args.type,
    lang: args.lang,
    signal,
  });
};
