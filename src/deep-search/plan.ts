import { parseJson, type ResearchModel } from "./model.ts";

export const PLAN_SYSTEM =
  "You plan web research. Reply with JSON only. No prose, no markdown.";

export interface ResearchPlan {
  queries: string[];
  focus: string;
}

interface PlanReply {
  queries?: unknown;
  focus?: unknown;
}

const asQueries = (value: unknown, max: number): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, max);
};

export const planPrompt = (question: string, known: string[]): string =>
  [
    `Research question: ${question}`,
    known.length ? `Already searched: ${known.join(" | ")}` : "",
    "Return JSON: { \"queries\": [\"...\"], \"focus\": \"one short sentence\" }",
    "Queries must be plain web search strings that do not repeat earlier ones.",
  ]
    .filter(Boolean)
    .join("\n");

export const makePlan = async (
  model: ResearchModel,
  question: string,
  known: string[],
  maxQueries: number,
): Promise<ResearchPlan> => {
  const reply = await model.ask({
    system: PLAN_SYSTEM,
    prompt: planPrompt(question, known),
    maxTokens: 400,
  });

  const parsed = parseJson<PlanReply>(reply);
  const queries = asQueries(parsed?.queries, maxQueries);

  return {
    queries: queries.length ? queries : [question],
    focus: typeof parsed?.focus === "string" ? parsed.focus : "",
  };
};
