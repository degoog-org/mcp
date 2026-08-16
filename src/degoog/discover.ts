import type { MemoryCache } from "../cache/memory.ts";
import type { DegoogClient } from "./client.ts";
import { logger } from "../utils/logger.ts";
import { listCommands } from "./command.ts";
import {
  listTypeCatalog,
  WEB_SEARCH_TYPE,
  type SearchTypeInfo,
  type TypeCatalog,
} from "./search-types.ts";
import {
  DegoogRoute,
  type DegoogCommand,
  type DegoogExtension,
} from "./types.ts";

const LOG_NS = "degoog-discover";

export interface Capabilities {
  searchTypes: SearchTypeInfo[];
  typeAliases: string[];
  engines: DegoogExtension[];
  autocomplete: DegoogExtension[];
  commands: DegoogCommand[];
  reachable: boolean;
  problems: string[];
}

const toExtension = (entry: unknown): DegoogExtension | null => {
  if (!entry || typeof entry !== "object") return null;
  const record = entry as Record<string, unknown>;
  if (typeof record.id !== "string") return null;
  return {
    id: record.id,
    name: typeof record.name === "string" ? record.name : undefined,
    enabled: typeof record.enabled === "boolean" ? record.enabled : undefined,
    description:
      typeof record.description === "string" ? record.description : undefined,
  };
};

const extGroup = (raw: unknown, key: string): DegoogExtension[] => {
  const group = (raw as Record<string, unknown>)?.[key];
  if (!Array.isArray(group)) return [];
  return group
    .map(toExtension)
    .filter((item): item is DegoogExtension => item !== null);
};

const settle = async <T>(
  label: string,
  problems: string[],
  fallback: T,
  run: () => Promise<T>,
): Promise<T> => {
  try {
    return await run();
  } catch (err) {
    logger.warn(LOG_NS, `${label} lookup failed`, err);
    problems.push(`${label} unavailable`);
    return fallback;
  }
};

export const getCapability = async (
  client: DegoogClient,
  cache: MemoryCache,
  signal?: AbortSignal,
): Promise<Capabilities> => {
  const problems: string[] = [];

  const [catalog, engineRaw, autoRaw, commands] = await Promise.all([
    settle<TypeCatalog>(
      "search-tabs",
      problems,
      { types: [WEB_SEARCH_TYPE], aliases: [] },
      () => listTypeCatalog(client, cache, signal),
    ),
    settle<unknown>("engines", problems, {}, () =>
      client.json({
        path: DegoogRoute.Extensions,
        query: { type: "engine" },
        signal,
      }),
    ),
    settle<unknown>("autocomplete", problems, {}, () =>
      client.json({
        path: DegoogRoute.Extensions,
        query: { type: "autocomplete" },
        signal,
      }),
    ),
    settle<DegoogCommand[]>("commands", problems, [], () =>
      listCommands(client, signal),
    ),
  ]);

  return {
    searchTypes: catalog.types,
    typeAliases: catalog.aliases,
    engines: extGroup(engineRaw, "engines"),
    autocomplete: extGroup(autoRaw, "autocomplete"),
    commands,
    reachable: problems.length < 4,
    problems,
  };
};
