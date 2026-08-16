import { createOpenAIChatAdapter, type BodyBuilder } from "./openai-chat.ts";
import { OPENAI_DEFAULT_BASE, ProviderId } from "./types.ts";

const buildBody: BodyBuilder = (config, messages, opts) => {
  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    stream: true,
    max_tokens: opts.maxTokens,
  };
  if (opts.enableThinking) body.reasoning_effort = "medium";
  return body;
};

export const openAIAdapter = createOpenAIChatAdapter({
  id: ProviderId.OpenAI,
  logNs: "llm:openai",
  defaultBaseUrl: OPENAI_DEFAULT_BASE,
  buildBody,
});
