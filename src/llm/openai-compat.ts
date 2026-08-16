import { basicOpenAIBody, createOpenAIChatAdapter } from "./openai-chat.ts";
import { ProviderId } from "./types.ts";

export const openAICompatAdapter = createOpenAIChatAdapter({
  id: ProviderId.OpenAICompat,
  logNs: "llm:openai-compat",
  buildBody: basicOpenAIBody,
});
