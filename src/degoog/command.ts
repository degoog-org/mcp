import type { DegoogClient } from "./client.ts";
import { DegoogRoute, type DegoogCommand } from "./types.ts";

export interface CommandResult {
  type?: string;
  trigger?: string;
  title?: string;
  html?: string;
  page?: number;
  totalPages?: number;
  results?: unknown[];
  error?: string;
}

export const listCommands = async (
  client: DegoogClient,
  signal?: AbortSignal,
): Promise<DegoogCommand[]> => {
  const raw = await client.json<unknown>({
    path: DegoogRoute.Commands,
    signal,
  });

  const source = Array.isArray(raw)
    ? raw
    : ((raw as Record<string, unknown>)?.commands ?? []);

  if (!Array.isArray(source)) return [];

  return source
    .map((entry) => entry as Record<string, unknown>)
    .filter((entry) => typeof entry.trigger === "string")
    .map((entry) => ({
      trigger: entry.trigger as string,
      aliases: Array.isArray(entry.aliases)
        ? (entry.aliases as string[])
        : undefined,
      description:
        typeof entry.description === "string" ? entry.description : undefined,
      category: typeof entry.category === "string" ? entry.category : undefined,
    }));
};

export const runCommand = async (
  client: DegoogClient,
  query: string,
  page: number | undefined,
  signal?: AbortSignal,
): Promise<CommandResult> =>
  client.json<CommandResult>({
    path: DegoogRoute.Command,
    query: { q: query, page },
    signal,
  });
