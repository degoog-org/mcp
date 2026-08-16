import { anthropicAdapter } from "./anthropic.ts";
import { geminiAdapter } from "./gemini.ts";
import { llamaCppAdapter } from "./llama-cpp.ts";
import { lmStudioAdapter } from "./lm-studio.ts";
import { ollamaAdapter } from "./ollama.ts";
import { openAICompatAdapter } from "./openai-compat.ts";
import { openAIAdapter } from "./openai.ts";
import { openRouterAdapter } from "./openrouter.ts";
import {
  ProviderId,
  type ProviderAdapter,
  type ProviderRequirements,
} from "./types.ts";
import { vllmAdapter } from "./vllm.ts";

export * from "./types.ts";

export const ADAPTERS: Record<ProviderId, ProviderAdapter> = {
  [ProviderId.OpenAICompat]: openAICompatAdapter,
  [ProviderId.OpenAI]: openAIAdapter,
  [ProviderId.OpenRouter]: openRouterAdapter,
  [ProviderId.Ollama]: ollamaAdapter,
  [ProviderId.LlamaCpp]: llamaCppAdapter,
  [ProviderId.Vllm]: vllmAdapter,
  [ProviderId.LmStudio]: lmStudioAdapter,
  [ProviderId.Gemini]: geminiAdapter,
  [ProviderId.Anthropic]: anthropicAdapter,
};

export const ADAPTER_REQUIREMENTS: Record<ProviderId, ProviderRequirements> = {
  [ProviderId.OpenAICompat]: { baseUrl: true, apiKey: false },
  [ProviderId.OpenAI]: { baseUrl: false, apiKey: true },
  [ProviderId.OpenRouter]: { baseUrl: false, apiKey: true },
  [ProviderId.Ollama]: { baseUrl: false, apiKey: false },
  [ProviderId.LlamaCpp]: { baseUrl: false, apiKey: false },
  [ProviderId.Vllm]: { baseUrl: false, apiKey: false },
  [ProviderId.LmStudio]: { baseUrl: false, apiKey: false },
  [ProviderId.Gemini]: { baseUrl: false, apiKey: true },
  [ProviderId.Anthropic]: { baseUrl: false, apiKey: true },
};

export const isProviderId = (value: unknown): value is ProviderId =>
  typeof value === "string" &&
  (Object.values(ProviderId) as string[]).includes(value);

export const pickAdapter = (id: ProviderId): ProviderAdapter =>
  ADAPTERS[id] ?? openAICompatAdapter;

export const adapterRequirements = (id: ProviderId): ProviderRequirements =>
  ADAPTER_REQUIREMENTS[id] ?? ADAPTER_REQUIREMENTS[ProviderId.OpenAICompat];
