import { logger } from "../utils/logger.ts";
import { resolveProviderBaseUrl } from "./base-url.ts";
import { readSse } from "./sse.ts";
import {
  ANTHROPIC_DEFAULT_BASE,
  ANTHROPIC_VERSION,
  ChatRole,
  ChunkKind,
  ProviderId,
  type ChatMessage,
  type ChunkStream,
  type ProviderAdapter,
  type ProviderConfig,
  type StreamOptions,
} from "./types.ts";

const LOG_NS = "llm:anthropic";
const THINKING_BUDGET = 1024;

interface AnthropicTurn {
  role: "user" | "assistant";
  content: string;
}

interface AnthropicPayload {
  type?: string;
  delta?: {
    type?: string;
    text?: string;
    thinking?: string;
    stop_reason?: string;
  };
}

const toAnthropicMsgs = (
  messages: ChatMessage[],
): { system: string; turns: AnthropicTurn[] } => {
  let system = "";
  const turns: AnthropicTurn[] = [];

  for (const message of messages) {
    if (message.role === ChatRole.System) {
      system += (system ? "\n\n" : "") + message.content;
      continue;
    }
    turns.push({
      role: message.role === ChatRole.Assistant ? "assistant" : "user",
      content: message.content,
    });
  }

  return { system, turns };
};

const callAnthropic = (
  config: ProviderConfig,
  messages: ChatMessage[],
  opts: StreamOptions,
): Promise<Response> => {
  const base = resolveProviderBaseUrl(config.baseUrl ?? "", ANTHROPIC_DEFAULT_BASE);
  const { system, turns } = toAnthropicMsgs(messages);

  const body: Record<string, unknown> = {
    model: config.model,
    max_tokens: opts.maxTokens,
    stream: true,
    messages: turns,
  };
  if (system) body.system = system;
  if (opts.enableThinking) {
    body.thinking = { type: "enabled", budget_tokens: THINKING_BUDGET };
  }

  return fetch(`${base}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "x-api-key": config.apiKey ?? "",
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
};

export const streamAnthropic = async function* (
  config: ProviderConfig,
  messages: ChatMessage[],
  opts: StreamOptions,
): ChunkStream {
  let res: Response;
  try {
    res = await callAnthropic(config, messages, opts);
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
    let payload: AnthropicPayload;
    try {
      payload = JSON.parse(ev.data) as AnthropicPayload;
    } catch {
      continue;
    }

    if (payload.type === "content_block_delta" && payload.delta) {
      const delta = payload.delta;
      if (delta.type === "thinking_delta" && delta.thinking) {
        yield { kind: ChunkKind.Thinking, text: delta.thinking };
        continue;
      }
      if (delta.type === "text_delta" && delta.text) {
        yield { kind: ChunkKind.Text, text: delta.text };
      }
    } else if (payload.type === "message_delta" && payload.delta?.stop_reason) {
      finishReason = payload.delta.stop_reason;
    } else if (payload.type === "message_stop") {
      break;
    }
  }

  yield { kind: ChunkKind.Done, finishReason };
};

export const anthropicAdapter: ProviderAdapter = {
  id: ProviderId.Anthropic,
  stream: streamAnthropic,
};
