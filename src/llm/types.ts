export enum ProviderId {
  OpenAICompat = "openai-compat",
  OpenAI = "openai",
  OpenRouter = "openrouter",
  Ollama = "ollama",
  LlamaCpp = "llama-cpp",
  Vllm = "vllm",
  LmStudio = "lm-studio",
  Gemini = "gemini",
  Anthropic = "anthropic",
}

export enum ChunkKind {
  Text = "text",
  Thinking = "thinking",
  Done = "done",
  Error = "error",
}

export enum ChatRole {
  System = "system",
  User = "user",
  Assistant = "assistant",
}

export const OPENAI_DEFAULT_BASE = "https://api.openai.com/v1";
export const OPENROUTER_DEFAULT_BASE = "https://openrouter.ai/api/v1";
export const OLLAMA_DEFAULT_BASE = "http://localhost:11434";
export const LLAMACPP_DEFAULT_BASE = "http://localhost:8080/v1";
export const VLLM_DEFAULT_BASE = "http://localhost:8000/v1";
export const LMSTUDIO_DEFAULT_BASE = "http://localhost:1234/v1";
export const GEMINI_DEFAULT_BASE =
  "https://generativelanguage.googleapis.com/v1beta";
export const ANTHROPIC_DEFAULT_BASE = "https://api.anthropic.com/v1";
export const ANTHROPIC_VERSION = "2023-06-01";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ProviderConfig {
  model: string;
  baseUrl?: string;
  apiKey?: string;
}

export interface StreamOptions {
  maxTokens: number;
  enableThinking?: boolean;
  signal?: AbortSignal;
}

export type Chunk =
  | { kind: ChunkKind.Text; text: string }
  | { kind: ChunkKind.Thinking; text: string }
  | { kind: ChunkKind.Done; finishReason?: string }
  | { kind: ChunkKind.Error; message: string };

export type ChunkStream = AsyncGenerator<Chunk, void, unknown>;

export interface ProviderAdapter {
  id: ProviderId;
  stream: (
    config: ProviderConfig,
    messages: ChatMessage[],
    opts: StreamOptions,
  ) => ChunkStream;
}

export interface ProviderRequirements {
  baseUrl: boolean;
  apiKey: boolean;
}
