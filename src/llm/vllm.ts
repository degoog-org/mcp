import { createOpenAIChatAdapter, type BodyBuilder } from "./openai-chat.ts";
import { ProviderId, VLLM_DEFAULT_BASE } from "./types.ts";

const buildBody: BodyBuilder = (config, messages, opts) => ({
  model: config.model,
  messages,
  stream: true,
  max_tokens: opts.maxTokens,
  chat_template_kwargs: { enable_thinking: !!opts.enableThinking },
});

export const vllmAdapter = createOpenAIChatAdapter({
  id: ProviderId.Vllm,
  logNs: "llm:vllm",
  defaultBaseUrl: VLLM_DEFAULT_BASE,
  buildBody,
});
