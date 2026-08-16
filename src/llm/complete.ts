import { logger } from "../utils/logger.ts";
import { pickAdapter } from "./index.ts";
import {
  ChunkKind,
  type ChatMessage,
  type ProviderConfig,
  type ProviderId,
  type StreamOptions,
} from "./types.ts";

const LOG_NS = "llm:complete";

export interface CompleteInput {
  provider: ProviderId;
  config: ProviderConfig;
  messages: ChatMessage[];
  options: StreamOptions;
}

export interface CompleteResult {
  text: string;
  finishReason?: string;
  error?: string;
}

export const complete = async (
  input: CompleteInput,
): Promise<CompleteResult> => {
  const adapter = pickAdapter(input.provider);
  const parts: string[] = [];
  let finishReason: string | undefined;
  let error: string | undefined;

  for await (const chunk of adapter.stream(
    input.config,
    input.messages,
    input.options,
  )) {
    if (chunk.kind === ChunkKind.Text) parts.push(chunk.text);
    else if (chunk.kind === ChunkKind.Done) finishReason = chunk.finishReason;
    else if (chunk.kind === ChunkKind.Error) error = chunk.message;
  }

  const text = parts.join("").trim();
  if (error) logger.warn(LOG_NS, `${input.provider} failed: ${error}`);

  return { text, finishReason, error };
};
