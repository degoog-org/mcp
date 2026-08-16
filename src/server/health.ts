import { DegoogRoute } from "../degoog/types.ts";
import type { ToolContext } from "../tools/context.ts";
import { logger } from "../utils/logger.ts";

const LOG_NS = "health";
const PROBE_TIMEOUT_MS = 4000;

export enum HealthState {
  Ok = "ok",
  Degraded = "degraded",
}

export interface HealthReport {
  status: HealthState;
  uptimeSec: number;
  degoog: {
    url: string;
    reachable: boolean;
    status: number | null;
    apiKeyConfigured: boolean;
    detail?: string;
  };
  auth: { inboundTokenRequired: boolean };
  cache: Record<string, number>;
  configPath: string;
}

export const probeDegoog = async (
  ctx: ToolContext,
): Promise<HealthReport["degoog"]> => {
  const base = {
    url: ctx.client.baseUrl,
    apiKeyConfigured: ctx.client.hasApiKey,
  };

  try {
    const response = await ctx.client.raw({
      path: DegoogRoute.Health,
      timeoutMs: PROBE_TIMEOUT_MS,
    });
    return { ...base, reachable: response.ok, status: response.status };
  } catch (err) {
    logger.debug(LOG_NS, "degoog probe failed", err);
    return {
      ...base,
      reachable: false,
      status: null,
      detail: err instanceof Error ? err.message : "unreachable",
    };
  }
};

export const buildReport = async (
  ctx: ToolContext,
  authRequired: boolean,
): Promise<HealthReport> => {
  const degoog = await probeDegoog(ctx);
  const stats = ctx.cache.stats();

  return {
    status: degoog.reachable ? HealthState.Ok : HealthState.Degraded,
    uptimeSec: Math.round((Date.now() - ctx.startedAt) / 1000),
    degoog,
    auth: { inboundTokenRequired: authRequired },
    cache: {
      entries: stats.entries,
      bytes: stats.bytes,
      hits: stats.hits,
      misses: stats.misses,
      evictions: stats.evictions,
    },
    configPath: ctx.configPath,
  };
};
