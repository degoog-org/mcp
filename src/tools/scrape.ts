import { z } from "zod";
import { citeId } from "../output/citations.ts";
import { wantsDetail } from "../output/compact.ts";
import { errorResult, fromError, ToolErrorKind } from "../output/errors.ts";
import { toolResult, type ToolResult } from "../output/structured.ts";
import { scrapeText } from "../output/visible.ts";
import { capList } from "../search/caps.ts";
import { noteScrapeRows } from "../scrape/failures.ts";
import { scrapeUrls, type ScrapeRow } from "../scrape/pipeline.ts";
import { logger } from "../utils/logger.ts";
import type { ToolContext } from "./context.ts";

const LOG_NS = "tool-scrape";

export const scrapeShape = {
  urls: z
    .array(z.string())
    .min(1)
    .describe("Explicit http(s) URLs to fetch. Private addresses are blocked."),
  query: z
    .string()
    .optional()
    .describe("Optional query used to score evidence chunks within each page."),
  maxChars: z
    .number()
    .int()
    .min(200)
    .max(20000)
    .optional()
    .describe("Per-URL character budget."),
  maxChunks: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe("Per-URL evidence chunk cap."),
};

export type ScrapeArgs = z.infer<z.ZodObject<typeof scrapeShape>>;

export const toEvidenceRow = (row: ScrapeRow, index: number) => ({
  id: citeId(index),
  url: row.url,
  finalUrl: row.finalUrl === row.url ? undefined : row.finalUrl,
  ok: row.ok,
  title: row.title || undefined,
  publishedAt: row.publishedAt ?? undefined,
  site: row.siteName ?? undefined,
  chunks: row.chunks.map((chunk) => ({
    heading: chunk.heading ?? undefined,
    text: chunk.text,
  })),
  chunksOmitted: row.chunksOmitted,
  truncated: row.truncated || undefined,
  error: row.error,
});

export const runScrapeTool = async (
  ctx: ToolContext,
  args: ScrapeArgs,
  signal?: AbortSignal,
): Promise<ToolResult> => {
  const { config } = ctx;
  const requested = args.urls.map((url) => url.trim()).filter(Boolean);

  if (!requested.length) {
    return errorResult(ToolErrorKind.Input, "at least one url is required");
  }

  const capped = capList(requested, config.scrape.maxUrls);

  try {
    const rows = await scrapeUrls(capped.items, {
      query: args.query ?? "",
      config: config.scrape,
      maxCharsPerUrl: args.maxChars,
      maxChunksPerUrl: args.maxChunks,
      signal,
    });

    noteScrapeRows(ctx.cache, rows);

    const useful = rows.filter((row) => row.ok).length;
    const failed = rows.length - useful;

    logger.debug(
      LOG_NS,
      `urls=${rows.length} useful=${useful} failed=${failed} skipped=${capped.omitted}`,
    );

    const structured: Record<string, unknown> = {
      requested: requested.length,
      scraped: rows.length,
      skipped: capped.omitted,
      counts: { useful, failed },
      sources: rows.map(toEvidenceRow),
      renderer: config.scrape.renderer,
    };

    if (wantsDetail(config.output.mode)) {
      structured.redirects = rows
        .filter((row) => row.redirects.length)
        .map((row) => ({ url: row.url, hops: row.redirects }));
    }

    return toolResult(
      scrapeText({ requested: rows.length, useful, failed }),
      structured,
    );
  } catch (err) {
    logger.warn(LOG_NS, "scrape run failed", err);
    return fromError(err);
  }
};
