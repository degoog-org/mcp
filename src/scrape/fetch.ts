import { userAgent } from "../config/env.ts";
import { logger } from "../utils/logger.ts";
import { withDeadline } from "../utils/timeout.ts";
import { checkHost } from "./safety.ts";

const LOG_NS = "scrape-fetch";
const MAX_REDIRECTS = 5;
const TEXT_TYPES = ["text/html", "application/xhtml", "text/plain", "application/xml", "text/xml"];

export interface FetchOptions {
  timeoutMs: number;
  maxResponseBytes: number;
  allowPrivateIps: boolean;
  signal?: AbortSignal;
}

export interface FetchOutcome {
  ok: boolean;
  url: string;
  status: number;
  contentType: string;
  html: string;
  bytes: number;
  truncated: boolean;
  redirects: string[];
  error?: string;
}

export const failedFetch = (url: string, error: string, status = 0): FetchOutcome => ({
  ok: false,
  url,
  status,
  contentType: "",
  html: "",
  bytes: 0,
  truncated: false,
  redirects: [],
  error,
});

export const readCapped = async (
  response: Response,
  maxBytes: number,
): Promise<{ text: string; bytes: number; truncated: boolean }> => {
  if (!response.body) return { text: "", bytes: 0, truncated: false };

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const parts: string[] = [];
  let bytes = 0;
  let truncated = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      bytes += value.byteLength;
      if (bytes > maxBytes) {
        const keep = value.subarray(0, Math.max(0, value.byteLength - (bytes - maxBytes)));
        parts.push(decoder.decode(keep));
        truncated = true;
        await reader.cancel().catch(() => undefined);
        break;
      }
      parts.push(decoder.decode(value, { stream: true }));
    }
  } finally {
    reader.releaseLock();
  }

  return { text: parts.join(""), bytes: Math.min(bytes, maxBytes), truncated };
};

const isTextType = (contentType: string): boolean =>
  !contentType || TEXT_TYPES.some((type) => contentType.includes(type));

export const briefError = (err: unknown): string => {
  if (!(err instanceof Error)) return "fetch failed";
  const [head = ""] = err.message.split("For more information,");
  return head.replace(/\s+/g, " ").trim() || "fetch failed";
};

export const fetchPage = async (
  target: string,
  options: FetchOptions,
): Promise<FetchOutcome> => {
  const redirects: string[] = [];
  let current = target;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const check = await checkHost(current, options.allowPrivateIps);
    if (!check.ok) {
      return failedFetch(current, check.detail ?? check.reason ?? "blocked");
    }

    let response: Response;
    try {
      response = await withDeadline(
        options.timeoutMs,
        (signal) =>
          fetch(current, {
            redirect: "manual",
            headers: {
              "User-Agent": userAgent(),
              Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
              "Accept-Language": "en;q=0.9",
            },
            signal,
          }),
        options.signal,
      );
    } catch (err) {
      logger.debug(LOG_NS, `fetch failed for ${current}`, err);
      return failedFetch(current, briefError(err));
    }

    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      let next: string;
      try {
        next = new URL(location, current).toString();
      } catch {
        return failedFetch(current, "invalid redirect target", response.status);
      }
      redirects.push(next);
      current = next;
      continue;
    }

    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    if (!response.ok) {
      return { ...failedFetch(current, `HTTP ${response.status}`, response.status), redirects };
    }
    if (!isTextType(contentType)) {
      return {
        ...failedFetch(current, `unsupported content type ${contentType || "unknown"}`, response.status),
        redirects,
      };
    }

    const { text, bytes, truncated } = await readCapped(response, options.maxResponseBytes);
    return {
      ok: true,
      url: current,
      status: response.status,
      contentType,
      html: text,
      bytes,
      truncated,
      redirects,
    };
  }

  return { ...failedFetch(current, "too many redirects"), redirects };
};
