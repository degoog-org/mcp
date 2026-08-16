import { logger } from "../utils/logger.ts";
import { resolveProviderBaseUrl } from "./base-url.ts";
import { readSse } from "./sse.ts";
import {
  ChunkKind,
  type ChatMessage,
  type ChunkStream,
  type ProviderAdapter,
  type ProviderConfig,
  type ProviderId,
  type StreamOptions,
} from "./types.ts";

const THINK_OPEN = "<think>";
const THINK_CLOSE = "</think>";
const STOP_MARKERS = ["<|endoftext|>", "<|im_end|>", "<|im_start|>"];

interface OpenAIDelta {
  content?: string;
  reasoning_content?: unknown;
  reasoning?: unknown;
  thinking?: unknown;
}

interface OpenAIChoice {
  delta?: OpenAIDelta;
  finish_reason?: string;
}

interface OpenAIPayload {
  choices?: OpenAIChoice[];
}

export const pickReason = (delta?: OpenAIDelta): string | undefined => {
  if (!delta) return undefined;
  if (typeof delta.reasoning_content === "string") return delta.reasoning_content;
  if (typeof delta.reasoning === "string") return delta.reasoning;
  if (delta.reasoning && typeof delta.reasoning === "object") {
    const nested = (delta.reasoning as { content?: unknown }).content;
    if (typeof nested === "string") return nested;
  }
  if (typeof delta.thinking === "string") return delta.thinking;
  return undefined;
};

const firstStop = (value: string): number => {
  let idx = -1;
  for (const marker of STOP_MARKERS) {
    const at = value.indexOf(marker);
    if (at >= 0 && (idx < 0 || at < idx)) idx = at;
  }
  return idx;
};

interface SplitResult {
  think: string;
  text: string;
  stopped: boolean;
}

const makeSplitter = (): ((raw: string) => SplitResult) => {
  let inThink = false;
  let carry = "";

  return (raw: string): SplitResult => {
    let work = carry + raw;
    carry = "";
    let think = "";
    let text = "";

    while (work.length > 0) {
      const tag = inThink ? THINK_CLOSE : THINK_OPEN;
      const hit = work.indexOf(tag);

      if (hit < 0) {
        const partial = work.lastIndexOf("<");
        if (partial >= 0 && tag.startsWith(work.slice(partial))) {
          if (inThink) think += work.slice(0, partial);
          else text += work.slice(0, partial);
          carry = work.slice(partial);
          break;
        }
        if (inThink) think += work;
        else text += work;
        break;
      }

      if (inThink) think += work.slice(0, hit);
      else text += work.slice(0, hit);
      work = work.slice(hit + tag.length);
      inThink = !inThink;
    }

    const stopAt = firstStop(text);
    if (stopAt >= 0) return { think, text: text.slice(0, stopAt), stopped: true };
    return { think, text, stopped: false };
  };
};

export type BodyBuilder = (
  config: ProviderConfig,
  messages: ChatMessage[],
  opts: StreamOptions,
) => Record<string, unknown>;

export const basicOpenAIBody: BodyBuilder = (config, messages, opts) => ({
  model: config.model,
  messages,
  stream: true,
  max_tokens: opts.maxTokens,
});

export interface OpenAIChatAdapterInput {
  id: ProviderId;
  logNs: string;
  defaultBaseUrl?: string;
  buildBody?: BodyBuilder;
}

export const createOpenAIChatAdapter = ({
  id,
  logNs,
  defaultBaseUrl,
  buildBody = basicOpenAIBody,
}: OpenAIChatAdapterInput): ProviderAdapter => {
  const call = (
    config: ProviderConfig,
    messages: ChatMessage[],
    opts: StreamOptions,
  ): Promise<Response> => {
    const base = defaultBaseUrl
      ? resolveProviderBaseUrl(config.baseUrl ?? "", defaultBaseUrl)
      : (config.baseUrl ?? "").replace(/\/$/, "");

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    };
    if (config.apiKey) headers["Authorization"] = `Bearer ${config.apiKey}`;

    return fetch(`${base}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(buildBody(config, messages, opts)),
      signal: opts.signal,
    });
  };

  const stream = async function* (
    config: ProviderConfig,
    messages: ChatMessage[],
    opts: StreamOptions,
  ): ChunkStream {
    let res: Response;
    try {
      res = await call(config, messages, opts);
    } catch (err) {
      logger.warn(logNs, "request failed", err);
      yield { kind: ChunkKind.Error, message: "AI request failed" };
      return;
    }

    if (!res.ok || !res.body) {
      const errBody = await res.text().catch(() => "");
      logger.warn(logNs, `bad response ${res.status}`, errBody.slice(0, 200));
      yield { kind: ChunkKind.Error, message: `Provider returned ${res.status}` };
      return;
    }

    const split = makeSplitter();
    let finishReason: string | undefined;
    let textOut = false;
    let stopped = false;

    for await (const ev of readSse(res.body)) {
      if (ev.data === "[DONE]") break;

      let payload: OpenAIPayload;
      try {
        payload = JSON.parse(ev.data) as OpenAIPayload;
      } catch {
        continue;
      }

      const choice = payload.choices?.[0];
      if (!choice) continue;

      const reason = pickReason(choice.delta);
      if (reason) yield { kind: ChunkKind.Thinking, text: reason };

      const raw = choice.delta?.content;
      if (raw) {
        const parts = split(raw);
        if (parts.think) yield { kind: ChunkKind.Thinking, text: parts.think };
        if (parts.text) {
          textOut = true;
          yield { kind: ChunkKind.Text, text: parts.text };
        }
        if (parts.stopped) {
          stopped = true;
          finishReason = finishReason ?? "stop";
          break;
        }
      }

      if (choice.finish_reason) finishReason = choice.finish_reason;
    }

    if (!textOut) logger.warn(logNs, `no text emitted, finishReason=${finishReason}`);
    yield { kind: ChunkKind.Done, finishReason: stopped ? "stop" : finishReason };
  };

  return { id, stream };
};
