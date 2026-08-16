import type { DeepSearchConfig } from "../config/schema.ts";
import { complete } from "../llm/complete.ts";
import { ChatRole, type ChatMessage } from "../llm/types.ts";
import { logger } from "../utils/logger.ts";

const LOG_NS = "deep-model";

export interface AskInput {
  system: string;
  prompt: string;
  maxTokens: number;
}

export interface ResearchModel {
  ask: (input: AskInput) => Promise<string>;
}

export const createResearchModel = (
  settings: DeepSearchConfig,
  signal?: AbortSignal,
): ResearchModel => ({
  ask: async (input) => {
    const messages: ChatMessage[] = [
      { role: ChatRole.System, content: input.system },
      { role: ChatRole.User, content: input.prompt },
    ];

    const result = await complete({
      provider: settings.provider,
      config: {
        model: settings.model,
        baseUrl: settings.baseUrl,
        apiKey: settings.apiKey,
      },
      messages,
      options: {
        maxTokens: Math.min(input.maxTokens, settings.maxTokens),
        enableThinking: settings.enableThinking,
        signal,
      },
    });

    if (result.error) throw new Error(result.error);
    return result.text;
  },
});

export const parseJson = <T>(text: string): T | null => {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = (fenced?.[1] ?? text).trim();
  const start = body.search(/[[{]/);
  if (start === -1) return null;

  const end = Math.max(body.lastIndexOf("}"), body.lastIndexOf("]"));
  if (end <= start) return null;

  try {
    return JSON.parse(body.slice(start, end + 1)) as T;
  } catch (err) {
    logger.debug(LOG_NS, "model reply was not valid JSON", err);
    return null;
  }
};
