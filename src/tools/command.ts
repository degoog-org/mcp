import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { z } from "zod";
import { runCommand } from "../degoog/command.ts";
import { fromError } from "../output/errors.ts";
import { toolResult, type ToolResult } from "../output/structured.ts";
import { capChars } from "../search/caps.ts";
import { cleanText } from "../scrape/clean.ts";
import { UI_CHROME_SELECTORS } from "../scrape/drop.ts";
import { toMarkdown } from "../scrape/markdown.ts";
import { logger } from "../utils/logger.ts";
import type { ToolContext } from "./context.ts";

const LOG_NS = "tool-command";
const MAX_OUTPUT_CHARS = 4000;

export const commandShape = {
  query: z
    .string()
    .min(1)
    .describe("Bang command with arguments, for example !uuid or !w bun."),
  page: z.number().int().min(1).max(10).optional().describe("Result page."),
};

export type CommandArgs = z.infer<z.ZodObject<typeof commandShape>>;

export const htmlToText = (html: string): string => {
  const $ = cheerio.load(html);
  $(UI_CHROME_SELECTORS).remove();
  return cleanText(toMarkdown($, $("body") as unknown as cheerio.Cheerio<AnyNode>));
};

export const runCommandTool = async (
  ctx: ToolContext,
  args: CommandArgs,
  signal?: AbortSignal,
): Promise<ToolResult> => {
  try {
    const result = await runCommand(ctx.client, args.query, args.page, signal);
    const rendered = result.html ? capChars(htmlToText(result.html), MAX_OUTPUT_CHARS) : "";

    const text = rendered
      ? `${result.title ?? result.trigger ?? "Command"}:\n${rendered}`
      : `Command ran but produced no text output (type ${result.type ?? "unknown"}).`;

    return toolResult(text, {
      query: args.query,
      type: result.type,
      trigger: result.trigger,
      title: result.title,
      text: rendered,
      page: result.page,
      totalPages: result.totalPages,
    });
  } catch (err) {
    logger.warn(LOG_NS, `command failed for "${args.query}"`, err);
    return fromError(err, "Use discover to list available bang commands.");
  }
};
