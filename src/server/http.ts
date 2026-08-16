import type { McpConfig } from "../config/schema.ts";
import type { ToolContext } from "../tools/context.ts";
import { logger } from "../utils/logger.ts";
import { createGuard, deniedResponse, type Guard } from "./auth.ts";
import { createEndpoint, SERVER_NAME, SERVER_VERSION, type McpEndpoint } from "./mcp.ts";

const LOG_NS = "http";

export enum HttpPath {
  Mcp = "/mcp",
  Health = "/health",
  Healthz = "/healthz",
  Ready = "/ready",
  Readyz = "/readyz",
}

export interface Sidecar {
  fetch: (request: Request) => Promise<Response>;
  guard: Guard;
  endpoint: McpEndpoint;
  close: () => Promise<void>;
}

const healthBody = (ctx: ToolContext): Record<string, unknown> => ({
  ok: true,
  name: SERVER_NAME,
  version: SERVER_VERSION,
  uptimeSec: Math.round((Date.now() - ctx.startedAt) / 1000),
});

export const createSidecar = async (ctx: ToolContext): Promise<Sidecar> => {
  const guard = createGuard(ctx.config.server);
  const endpoint = await createEndpoint(ctx, guard.required);

  const fetchRequest = async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname.replace(/\/+$/, "") || "/";

    if (path === HttpPath.Health || path === HttpPath.Healthz) {
      return Response.json(healthBody(ctx));
    }
    if (path === HttpPath.Ready || path === HttpPath.Readyz) {
      return Response.json({ ok: true });
    }
    if (path !== HttpPath.Mcp) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    if (!guard.allows(request)) {
      logger.warn(LOG_NS, "rejected /mcp request without a valid bearer token");
      return deniedResponse();
    }

    return endpoint.handle(request);
  };

  return {
    fetch: fetchRequest,
    guard,
    endpoint,
    close: () => endpoint.close(),
  };
};

export interface RunningServer {
  port: number;
  stop: () => Promise<void>;
}

export const startServer = async (
  sidecar: Sidecar,
  config: McpConfig,
): Promise<RunningServer> => {
  const server = Bun.serve({
    port: config.server.port,
    hostname: config.server.host || undefined,
    idleTimeout: 120,
    fetch: sidecar.fetch,
  });

  logger.info(
    LOG_NS,
    `listening on ${config.server.host || "0.0.0.0"}:${server.port}${HttpPath.Mcp}`,
  );

  return {
    port: server.port ?? config.server.port,
    stop: async () => {
      await server.stop(true);
      await sidecar.close();
    },
  };
};
