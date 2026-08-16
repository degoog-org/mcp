import { logger } from "../utils/logger.ts";
import { resolveProviderBaseUrl } from "./base-url.ts";
import { readSse } from "./sse.ts";
import {
  ChatRole,
  ChunkKind,
  GEMINI_DEFAULT_BASE,
  ProviderId,
  type ChatMessage,
  type ChunkStream,
  type ProviderAdapter,
  type ProviderConfig,
  type StreamOptions,
} from "./types.ts";

const LOG_NS = "llm:gemini";

interface GeminiPart {
  text?: string;
  thought?: boolean;
}

interface GeminiPayload {
  candidates?: Array<{
    content?: { parts?: GeminiPart[] };
    finishReason?: string;
  }>;
}

const toGeminiContents = (
  messages: ChatMessage[],
): {
  contents: Array<{ role: string; parts: Array<{ text: string }> }>;
  system: string;
} => {
  const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];
  let system = "";

  for (const message of messages) {
    if (message.role === ChatRole.System) {
      system += (system ? "\n\n" : "") + message.content;
      continue;
    }
    contents.push({
      role: message.role === ChatRole.Assistant ? "model" : "user",
      parts: [{ text: message.content }],
    });
  }

  return { contents, system };
};

const callGemini = (
  config: ProviderConfig,
  messages: ChatMessage[],
  opts: StreamOptions,
): Promise<Response> => {
  const base = resolveProviderBaseUrl(config.baseUrl ?? "", GEMINI_DEFAULT_BASE);
  const url = `${base}/models/${encodeURIComponent(config.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(config.apiKey ?? "")}`;
  const { contents, system } = toGeminiContents(messages);

  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      maxOutputTokens: opts.maxTokens,
      thinkingConfig: opts.enableThinking
        ? { includeThoughts: true }
        : { thinkingBudget: 0 },
    },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };

  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
};

export const streamGemini = async function* (
  config: ProviderConfig,
  messages: ChatMessage[],
  opts: StreamOptions,
): ChunkStream {
  let res: Response;
  try {
    res = await callGemini(config, messages, opts);
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

  for await (const ev of readSse(res.body)) {
    let payload: GeminiPayload;
    try {
      payload = JSON.parse(ev.data) as GeminiPayload;
    } catch {
      continue;
    }

    const candidate = payload.candidates?.[0];
    if (!candidate) continue;

    for (const part of candidate.content?.parts ?? []) {
      if (!part.text) continue;
      if (part.thought) yield { kind: ChunkKind.Thinking, text: part.text };
      else yield { kind: ChunkKind.Text, text: part.text };
    }

    if (candidate.finishReason) finishReason = candidate.finishReason;
  }

  yield { kind: ChunkKind.Done, finishReason };
};

export const geminiAdapter: ProviderAdapter = {
  id: ProviderId.Gemini,
  stream: streamGemini,
};
