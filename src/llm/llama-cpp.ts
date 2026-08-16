import { createOpenAIChatAdapter, type BodyBuilder } from "./openai-chat.ts";
import { LLAMACPP_DEFAULT_BASE, ProviderId } from "./types.ts";

const buildBody: BodyBuilder = (config, messages, opts) => ({
  model: config.model,
  messages,
  stream: true,
  max_tokens: opts.maxTokens,
  chat_template_kwargs: { enable_thinking: !!opts.enableThinking },
});

export const llamaCppAdapter = createOpenAIChatAdapter({
  id: ProviderId.LlamaCpp,
  logNs: "llm:llama-cpp",
  defaultBaseUrl: LLAMACPP_DEFAULT_BASE,
  buildBody,
});
