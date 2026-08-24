import { ScrapeRenderer, type FetcherConfig, type ScrapeConfig } from "../config/schema.ts";
import { logger } from "../utils/logger.ts";
import { withDeadline } from "../utils/timeout.ts";
import { briefError, failedFetch, readCapped, type FetchOptions, type FetchOutcome } from "./fetch.ts";
import { checkHost } from "./safety.ts";

const LOG_NS = "scrape-fetcher";

export const URL_SLOT = "{{url}}";
export const TIMEOUT_SLOT = "{{timeout}}";

export enum FetcherError {
  BadJson = "delegated fetcher did not return valid json",
  NoHtml = "delegated fetcher returned no html at the configured path",
  Unreachable = "delegated fetcher could not be reached",
}

export const rendererOf = (config: ScrapeConfig): ScrapeRenderer =>
  config.fetcher.url ? ScrapeRenderer.Delegated : ScrapeRenderer.Static;

const jsonSlot = (value: string): string => JSON.stringify(value).slice(1, -1);

const wantsJson = (config: FetcherConfig): boolean => {
  const declared = Object.entries(config.headers).some(
    ([name, value]) =>
      name.toLowerCase() === "content-type" && value.toLowerCase().includes("json"),
  );
  return declared || /^\s*[{[]/.test(config.body);
};

const fillSlots = (
  template: string,
  target: string,
  timeoutMs: number,
  escape: (value: string) => string,
): string =>
  template
    .split(URL_SLOT)
    .join(escape(target))
    .split(TIMEOUT_SLOT)
    .join(String(timeoutMs));

const digPath = (source: unknown, path: string): unknown =>
  path
    .split(".")
    .filter(Boolean)
    .reduce<unknown>(
      (node, key) =>
        node && typeof node === "object" ? (node as Record<string, unknown>)[key] : undefined,
      source,
    );

const readHtml = (payload: string, path: string): string => {
  if (!path) return payload;

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch (err) {
    logger.warn(LOG_NS, "response was not json", err);
    throw new Error(FetcherError.BadJson);
  }

  const found = digPath(parsed, path);
  if (typeof found !== "string" || !found) throw new Error(FetcherError.NoHtml);

  return found;
};

export const fetchVia = async (
  target: string,
  config: FetcherConfig,
  options: FetchOptions,
): Promise<FetchOutcome> => {
  const check = await checkHost(target, options.allowPrivateIps);
  if (!check.ok) {
    return failedFetch(target, check.detail ?? check.reason ?? "blocked");
  }

  const endpoint = fillSlots(config.url, target, options.timeoutMs, encodeURIComponent);
  const escape = wantsJson(config) ? jsonSlot : encodeURIComponent;
  const body = config.body
    ? fillSlots(config.body, target, options.timeoutMs, escape)
    : undefined;

  let response: Response;
  try {
    response = await withDeadline(
      options.timeoutMs,
      (signal) =>
        fetch(endpoint, {
          method: config.method,
          headers: config.headers,
          body,
          redirect: "follow",
          signal,
        }),
      options.signal,
    );
  } catch (err) {
    logger.warn(LOG_NS, `${FetcherError.Unreachable} for ${target}`, err);
    return failedFetch(target, briefError(err));
  }

  const { text, bytes, truncated } = await readCapped(response, options.maxResponseBytes);

  if (!response.ok) {
    return failedFetch(target, `delegated fetcher replied HTTP ${response.status}`, response.status);
  }

  let html: string;
  try {
    html = readHtml(text, config.html);
  } catch (err) {
    return failedFetch(target, err instanceof Error ? err.message : FetcherError.NoHtml);
  }

  return {
    ok: true,
    url: target,
    status: response.status,
    contentType: "text/html",
    html,
    bytes,
    truncated,
    redirects: [],
  };
};
