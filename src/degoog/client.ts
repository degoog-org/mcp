import type { DegoogConfig } from "../config/schema.ts";
import { secretFrom, userAgent } from "../config/env.ts";
import { logger } from "../utils/logger.ts";
import { redactUrl } from "../utils/redact.ts";
import { withDeadline } from "../utils/timeout.ts";

const LOG_NS = "degoog";

export class DegoogError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "DegoogError";
    this.status = status;
  }
}

export interface RequestOptions {
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  method?: "GET" | "POST";
  accept?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface DegoogClient {
  baseUrl: string;
  hasApiKey: boolean;
  buildUrl: (path: string, query?: RequestOptions["query"]) => string;
  headers: (accept?: string) => Record<string, string>;
  json: <T>(options: RequestOptions) => Promise<T>;
  raw: (options: RequestOptions) => Promise<Response>;
}

const cleanQuery = (
  query: RequestOptions["query"],
): Array<[string, string]> => {
  if (!query) return [];
  return Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => [key, String(value)] as [string, string]);
};

export const createClient = (config: DegoogConfig): DegoogClient => {
  const baseUrl = config.url.replace(/\/+$/, "");
  const apiKey = secretFrom(config.apiKeyEnv);

  const buildUrl = (path: string, query?: RequestOptions["query"]): string => {
    const url = new URL(`${baseUrl}${path}`);
    for (const [key, value] of cleanQuery(query)) {
      url.searchParams.append(key, value);
    }
    return url.toString();
  };

  const headers = (accept = "application/json"): Record<string, string> => {
    const out: Record<string, string> = {
      Accept: accept,
      "User-Agent": userAgent(),
    };
    if (apiKey) out.Authorization = `Bearer ${apiKey}`;
    return out;
  };

  const raw = async (options: RequestOptions): Promise<Response> => {
    const method = options.method ?? "GET";
    const url = buildUrl(options.path, options.query);
    const requestHeaders = headers(options.accept);
    if (options.body !== undefined) {
      requestHeaders["Content-Type"] = "application/json";
    }

    const started = performance.now();
    const response = await withDeadline(
      options.timeoutMs ?? config.timeout,
      (signal) =>
        fetch(url, {
          method,
          headers: requestHeaders,
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          signal,
        }),
      options.signal,
    );

    logger.debug(
      LOG_NS,
      `${method} ${redactUrl(url)} status=${response.status} ms=${Math.round(performance.now() - started)}`,
    );
    return response;
  };

  const json = async <T>(options: RequestOptions): Promise<T> => {
    const response = await raw(options);
    if (!response.ok) {
      const detail = response.status === 401 ? "authentication rejected" : "request failed";
      throw new DegoogError(
        `Degoog ${options.path} ${detail} (HTTP ${response.status})`,
        response.status,
      );
    }
    try {
      return (await response.json()) as T;
    } catch (err) {
      logger.warn(LOG_NS, `invalid JSON from ${options.path}`, err);
      throw new DegoogError(`Degoog ${options.path} returned invalid JSON`, 502);
    }
  };

  return { baseUrl, hasApiKey: Boolean(apiKey), buildUrl, headers, json, raw };
};
