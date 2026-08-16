import type { MemoryCache } from "../cache/memory.ts";
import { QueryExpansion } from "../config/schema.ts";
import { suggestCached } from "../degoog/cached.ts";
import type { DegoogClient } from "../degoog/client.ts";

export interface ExpansionInput {
  client: DegoogClient;
  cache: MemoryCache;
  mode: QueryExpansion;
  baseQueries: string[];
  related: string[];
  max: number;
  signal?: AbortSignal;
}

export interface ExpansionResult {
  added: string[];
  source: QueryExpansion;
}

const uniqueNew = (
  candidates: string[],
  existing: string[],
  max: number,
): string[] => {
  const seen = new Set(existing.map((entry) => entry.toLowerCase()));
  const picked: string[] = [];

  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    picked.push(trimmed);
    if (picked.length >= max) break;
  }

  return picked;
};

export const expandQueries = async (
  input: ExpansionInput,
): Promise<ExpansionResult> => {
  if (input.mode === QueryExpansion.Off || input.max <= 0) {
    return { added: [], source: QueryExpansion.Off };
  }

  if (input.mode === QueryExpansion.Related) {
    return {
      added: uniqueNew(input.related, input.baseQueries, input.max),
      source: QueryExpansion.Related,
    };
  }

  const seed = input.baseQueries[0] ?? "";
  const suggestions = await suggestCached(
    input.client,
    input.cache,
    seed,
    input.signal,
  );

  return {
    added: uniqueNew(
      suggestions.map((entry) => entry.text),
      input.baseQueries,
      input.max,
    ),
    source: QueryExpansion.Suggestions,
  };
};
