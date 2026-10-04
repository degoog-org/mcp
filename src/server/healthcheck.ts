import type { McpConfig } from "../config/schema.ts";
import { HttpPath } from "./http.ts";

const WILDCARD_HOSTS = new Set(["", "0.0.0.0", "::", "[::]"]);
const LOOPBACK = "127.0.0.1";
const PROBE_TIMEOUT_MS = 4000;

const probeHost = (host: string): string => {
  const trimmed = host.trim();
  if (WILDCARD_HOSTS.has(trimmed)) return LOOPBACK;
  if (trimmed.includes(":") && !trimmed.startsWith("[")) return `[${trimmed}]`;
  return trimmed;
};

export const healthzUrl = (config: McpConfig): string =>
  `http://${probeHost(config.server.host)}:${config.server.port}${HttpPath.Healthz}`;

export const probeHealth = async (config: McpConfig): Promise<boolean> => {
  try {
    const response = await fetch(healthzUrl(config), {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
};
