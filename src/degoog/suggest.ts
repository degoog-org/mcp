import type { DegoogClient } from "./client.ts";
import { logger } from "../utils/logger.ts";
import { DegoogRoute, type DegoogSuggestion } from "./types.ts";

const LOG_NS = "degoog-suggest";

const toSuggestion = (entry: unknown): DegoogSuggestion | null => {
  if (typeof entry === "string") return { text: entry };
  if (entry && typeof entry === "object") {
    const record = entry as Record<string, unknown>;
    if (typeof record.text === "string") {
      return {
        text: record.text,
        source: typeof record.source === "string" ? record.source : undefined,
      };
    }
  }
  return null;
};

export const getSuggests = async (
  client: DegoogClient,
  query: string,
  signal?: AbortSignal,
): Promise<DegoogSuggestion[]> => {
  if (!query.trim()) return [];

  try {
    const raw = await client.json<unknown>({
      path: DegoogRoute.Suggest,
      query: { q: query },
      signal,
    });
    if (!Array.isArray(raw)) return [];
    return raw
      .map(toSuggestion)
      .filter((item): item is DegoogSuggestion => item !== null);
  } catch (err) {
    logger.warn(LOG_NS, "suggestion lookup failed", err);
    return [];
  }
};
