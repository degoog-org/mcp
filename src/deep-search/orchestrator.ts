import { ProviderFallback } from "../config/schema.ts";
import { adapterRequirements } from "../llm/index.ts";
import {
  errorResult,
  fromError,
  kindOf,
  messageOf,
  ToolErrorKind,
} from "../output/errors.ts";
import { toolResult, type ToolResult } from "../output/structured.ts";
import { bundleText } from "../output/visible.ts";
import { runBundle } from "../tools/bundle-search.ts";
import { ToolName, type ToolContext } from "../tools/context.ts";
import { logger } from "../utils/logger.ts";
import { runLoop } from "./loop.ts";
import { createResearchModel } from "./model.ts";
import { writeReport } from "./report.ts";

const LOG_NS = "deep-search";

export const DISABLED_MESSAGE =
  "deep_search is disabled on this instance. It needs deepSearch.enabled plus an LLM provider in mcp.yml.";

const DISABLED_FIX = "See DEEP_SEARCH.md for the provider setup.";

const OFF_NOTE =
  "deepSearch.onProviderUnavailable is off on this instance, so nothing ran in place of deep_search.";

const DEGRADED_NOTE =
  "This is a bundle_search evidence pack. No queries were planned, no coverage was evaluated, no report was written. Treat it as raw sources, not as research.";

export interface DeepInput {
  query: string;
  type?: string;
  lang?: string;
  signal?: AbortSignal;
}

export const configProblems = (ctx: ToolContext): string[] => {
  const settings = ctx.config.deepSearch;
  const needs = adapterRequirements(settings.provider);
  const problems: string[] = [];

  if (!settings.model) {
    problems.push("deepSearch.model is empty, set the model id to run");
  }
  if (needs.baseUrl && !settings.baseUrl) {
    problems.push(`deepSearch.baseUrl is required for provider ${settings.provider}`);
  }
  if (needs.apiKey && !settings.apiKey) {
    problems.push(`deepSearch.apiKey is required for provider ${settings.provider}`);
  }

  return problems;
};

export const deepSearchReady = (ctx: ToolContext): boolean =>
  ctx.config.deepSearch.enabled && configProblems(ctx).length === 0;

export const fallsBackToBundle = (ctx: ToolContext): boolean =>
  ctx.config.deepSearch.onProviderUnavailable === ProviderFallback.BundleSearch;

export const statusLine = (ctx: ToolContext): string => {
  const settings = ctx.config.deepSearch;
  if (!settings.enabled) return DISABLED_MESSAGE;

  const problems = configProblems(ctx);
  return problems.length
    ? `deep_search is enabled but not configured: ${problems.join("; ")}`
    : `deep_search is ready on provider ${settings.provider}, model ${settings.model}.`;
};

const degradeToBundle = async (
  ctx: ToolContext,
  input: DeepInput,
  reason: string,
  fix: string,
): Promise<ToolResult> => {
  try {
    const outcome = await runBundle(
      ctx,
      { query: input.query, type: input.type, lang: input.lang },
      input.signal,
    );
    const { pack } = outcome;

    logger.info(LOG_NS, `degraded to bundle_search: ${reason}`);

    const text = [
      `DEGRADED RESULT, deep_search did not run. ${reason}`,
      fix,
      DEGRADED_NOTE,
      "",
      bundleText({
        sources: pack.sources.length,
        chunks: pack.chunks.length,
        failures: pack.failures.length,
        continued: outcome.gathered.continued,
        exhausted: outcome.gathered.exhausted,
      }),
    ].join("\n");

    return toolResult(text, {
      degraded: {
        requested: ToolName.DeepSearch,
        ran: ToolName.BundleSearch,
        reason,
        fix,
      },
      question: input.query,
      ...outcome.structured,
    });
  } catch (err) {
    logger.warn(LOG_NS, "bundle fallback failed", err);
    return errorResult(
      kindOf(err),
      `${reason} The bundle_search fallback also failed: ${messageOf(err)}`,
      fix,
    );
  }
};

const unavailable = (
  ctx: ToolContext,
  input: DeepInput,
  kind: ToolErrorKind,
  reason: string,
  fix: string,
): Promise<ToolResult> | ToolResult =>
  fallsBackToBundle(ctx)
    ? degradeToBundle(ctx, input, reason, fix)
    : errorResult(kind, reason, `${fix} ${OFF_NOTE}`);

export const runDeepSearch = async (
  ctx: ToolContext,
  input: DeepInput,
): Promise<ToolResult> => {
  const settings = ctx.config.deepSearch;

  if (!settings.enabled) {
    return unavailable(
      ctx,
      input,
      ToolErrorKind.Disabled,
      DISABLED_MESSAGE,
      DISABLED_FIX,
    );
  }

  const problems = configProblems(ctx);
  if (problems.length) {
    return unavailable(
      ctx,
      input,
      ToolErrorKind.Config,
      `deep_search is enabled but not configured: ${problems.join("; ")}`,
      `Fix deepSearch in mcp.yml and restart. ${DISABLED_FIX}`,
    );
  }

  const model = createResearchModel(settings, input.signal);

  try {
    const loop = await runLoop({
      ctx,
      model,
      question: input.query,
      type: input.type,
      lang: input.lang,
      signal: input.signal,
    });

    const report = await writeReport(
      model,
      input.query,
      loop.pack,
      settings.maxEvidenceChars,
      settings.requireCitations,
    );

    logger.info(
      LOG_NS,
      `provider=${settings.provider} model=${settings.model} iterations=${loop.trace.length} sources=${loop.pack.sources.length} cited=${report.cited}`,
    );

    return toolResult(report.text, {
      question: input.query,
      report: report.text,
      cited: report.cited,
      provider: settings.provider,
      providerModel: settings.model,
      stoppedBecause: loop.stoppedBecause,
      searchedQueries: loop.searched,
      selectionPolicy: "degoog_order_readable_sources",
      selection: loop.selection,
      counts: {
        iterations: loop.trace.length,
        sources: loop.pack.sources.length,
        chunks: loop.pack.chunks.length,
        failures: loop.pack.failures.length,
        evidenceChars: loop.pack.charsUsed,
      },
      sources: loop.pack.sources,
      evidence: loop.pack.chunks,
      failedSources: loop.pack.failures,
      trace: loop.trace,
    });
  } catch (err) {
    logger.warn(LOG_NS, "deep search failed", err);
    const fix = `Check the ${settings.provider} provider is reachable and the model id is correct.`;

    if (!fallsBackToBundle(ctx)) return fromError(err, `${fix} ${OFF_NOTE}`);

    return degradeToBundle(
      ctx,
      input,
      `The ${settings.provider} provider failed: ${messageOf(err)}`,
      fix,
    );
  }
};

export const missingQuery = (ctx: ToolContext): ToolResult =>
  errorResult(
    ToolErrorKind.Input,
    `query must not be empty. ${statusLine(ctx)}`,
    fallsBackToBundle(ctx)
      ? 'Call again as { "query": "your research question" }. The same argument works on bundle_search, which needs no provider.'
      : 'Call again as { "query": "your research question" }.',
  );
