import { basicOpenAIBody, createOpenAIChatAdapter } from "./openai-chat.ts";
import { LMSTUDIO_DEFAULT_BASE, ProviderId } from "./types.ts";

export const lmStudioAdapter = createOpenAIChatAdapter({
  id: ProviderId.LmStudio,
  logNs: "llm:lm-studio",
  defaultBaseUrl: LMSTUDIO_DEFAULT_BASE,
  buildBody: basicOpenAIBody,
});
