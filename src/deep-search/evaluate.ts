import type { EvidencePack } from "../bundle/evidence-pack.ts";
import { parseJson, type ResearchModel } from "./model.ts";

export const EVAL_SYSTEM =
  "You judge whether gathered evidence answers a question. Reply with JSON only.";

export interface Coverage {
  sufficient: boolean;
  gaps: string[];
  conflicts: string[];
  followUps: string[];
}

interface EvalReply {
  sufficient?: unknown;
  gaps?: unknown;
  conflicts?: unknown;
  followUps?: unknown;
}

const asStrings = (value: unknown, max: number): string[] =>
  Array.isArray(value)
    ? value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .slice(0, max)
    : [];

export const evidenceText = (pack: EvidencePack, maxChars: number): string => {
  const lines: string[] = [];
  let used = 0;

  for (const chunk of pack.chunks) {
    const line = `[${chunk.id}] ${chunk.heading ? `${chunk.heading}: ` : ""}${chunk.text}`;
    if (used + line.length > maxChars) break;
    used += line.length;
    lines.push(line);
  }

  return lines.join("\n\n");
};

export const evalPrompt = (
  question: string,
  pack: EvidencePack,
  maxChars: number,
): string =>
  [
    `Question: ${question}`,
    "Evidence:",
    evidenceText(pack, maxChars) || "(no evidence gathered)",
    "Return JSON: { \"sufficient\": true|false, \"gaps\": [], \"conflicts\": [], \"followUps\": [] }",
    "followUps must be new web search queries that would close the gaps.",
  ].join("\n");

export const checkCoverage = async (
  model: ResearchModel,
  question: string,
  pack: EvidencePack,
  maxQueries: number,
  maxChars: number,
): Promise<Coverage> => {
  const reply = await model.ask({
    system: EVAL_SYSTEM,
    prompt: evalPrompt(question, pack, maxChars),
    maxTokens: 600,
  });

  const parsed = parseJson<EvalReply>(reply);

  return {
    sufficient: parsed?.sufficient === true,
    gaps: asStrings(parsed?.gaps, 5),
    conflicts: asStrings(parsed?.conflicts, 5),
    followUps: asStrings(parsed?.followUps, maxQueries),
  };
};
