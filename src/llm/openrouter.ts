import { createOpenAIChatAdapter, type BodyBuilder } from "./openai-chat.ts";
import { OPENROUTER_DEFAULT_BASE, ProviderId } from "./types.ts";

const buildBody: BodyBuilder = (config, messages, opts) => ({
  model: config.model,
  messages,
  stream: true,
  max_tokens: opts.maxTokens,
  reasoning: opts.enableThinking
    ? { effort: "medium", exclude: false }
    : { effort: "none" },
});

export const openRouterAdapter = createOpenAIChatAdapter({
  id: ProviderId.OpenRouter,
  logNs: "llm:openrouter",
  defaultBaseUrl: OPENROUTER_DEFAULT_BASE,
  buildBody,
});
