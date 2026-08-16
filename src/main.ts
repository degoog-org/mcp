import { createCache } from "./cache/memory.ts";
import { loadConfig } from "./config/load.ts";
import { createClient } from "./degoog/client.ts";
import { createSidecar, startServer } from "./server/http.ts";
import type { ToolContext } from "./tools/context.ts";
import { logger } from "./utils/logger.ts";

const LOG_NS = "main";

export const bootstrap = async (): Promise<ToolContext> => {
  const { config, path, created } = await loadConfig();

  if (created) {
    logger.info(LOG_NS, `first run, seeded config at ${path}`);
  }

  return {
    config,
    client: createClient(config.degoog),
    cache: createCache(config.cache),
    configPath: path,
    startedAt: Date.now(),
  };
};

export const main = async (): Promise<void> => {
  const ctx = await bootstrap();
  const sidecar = await createSidecar(ctx);
  const server = await startServer(sidecar, ctx.config);

  logger.info(
    LOG_NS,
    `degoog=${ctx.config.degoog.url} deepSearch=${ctx.config.deepSearch.enabled ? "on" : "off"} outputMode=${ctx.config.output.mode}`,
  );

  const shutdown = (signal: string): void => {
    logger.info(LOG_NS, `${signal} received, shutting down`);
    void server.stop().then(() => process.exit(0));
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
};

if (import.meta.main) {
  await main();
}
