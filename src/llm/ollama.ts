import { logger } from "../utils/logger.ts";
import { resolveProviderBaseUrl } from "./base-url.ts";
import { readNdjson } from "./ndjson.ts";
import {
  ChunkKind,
  OLLAMA_DEFAULT_BASE,
  ProviderId,
  type ChatMessage,
  type ChunkStream,
  type ProviderAdapter,
  type ProviderConfig,
  type StreamOptions,
} from "./types.ts";

const LOG_NS = "llm:ollama";

interface OllamaPayload {
  message?: { content?: string; thinking?: string };
  done?: boolean;
  done_reason?: string;
}

const resolveOllamaBase = (baseUrl?: string): string => {
  const base = resolveProviderBaseUrl(baseUrl ?? "", OLLAMA_DEFAULT_BASE);
  try {
    const url = new URL(base);
    if (url.pathname === "/v1") return url.origin;
  } catch {}
  return base.replace(/\/$/, "");
};

const callOllama = (
  config: ProviderConfig,
  messages: ChatMessage[],
  opts: StreamOptions,
): Promise<Response> => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.apiKey) headers["Authorization"] = `Bearer ${config.apiKey}`;

  return fetch(`${resolveOllamaBase(config.baseUrl)}/api/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: true,
      think: !!opts.enableThinking,
      options: { num_predict: opts.maxTokens },
    }),
    signal: opts.signal,
  });
};

export const streamOllama = async function* (
  config: ProviderConfig,
  messages: ChatMessage[],
  opts: StreamOptions,
): ChunkStream {
  let res: Response;
  try {
    res = await callOllama(config, messages, opts);
  } catch (err) {
    logger.warn(LOG_NS, "request failed", err);
    yield { kind: ChunkKind.Error, message: "AI request failed" };
    return;
  }

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    logger.warn(LOG_NS, `bad response ${res.status}`, text.slice(0, 200));
    yield { kind: ChunkKind.Error, message: `Provider returned ${res.status}` };
    return;
  }

  let finishReason: string | undefined;

  for await (const line of readNdjson(res.body)) {
    let payload: OllamaPayload;
    try {
      payload = JSON.parse(line) as OllamaPayload;
    } catch {
      continue;
    }

    const thinking = payload.message?.thinking;
    if (thinking) yield { kind: ChunkKind.Thinking, text: thinking };

    const text = payload.message?.content;
    if (text) yield { kind: ChunkKind.Text, text };

    if (payload.done) {
      finishReason = payload.done_reason;
      break;
    }
  }

  yield { kind: ChunkKind.Done, finishReason };
};

export const ollamaAdapter: ProviderAdapter = {
  id: ProviderId.Ollama,
  stream: streamOllama,
};
