import type { EvidencePack } from "../bundle/evidence-pack.ts";
import { evidenceText } from "./evaluate.ts";
import type { ResearchModel } from "./model.ts";

export const REPORT_SYSTEM =
  "You write short evidence-based research reports. Cite every claim with [S1] style ids from the evidence. Never invent sources.";

export const MISSING_CITATIONS =
  "report was rejected because it contained no [S1] style citations";

export const reportPrompt = (
  question: string,
  pack: EvidencePack,
  maxChars: number,
): string =>
  [
    `Question: ${question}`,
    "Sources:",
    pack.sources.map((source) => `[${source.id}] ${source.title} - ${source.url}`).join("\n"),
    "Evidence:",
    evidenceText(pack, maxChars) || "(no evidence gathered)",
    "Write at most 250 words. Cite source ids inline. State clearly what is still unknown.",
  ].join("\n");

export const hasCitations = (text: string): boolean => /\[S\d+\]/.test(text);

export const writeReport = async (
  model: ResearchModel,
  question: string,
  pack: EvidencePack,
  maxChars: number,
  requireCitations: boolean,
): Promise<{ text: string; cited: boolean }> => {
  const text = (
    await model.ask({
      system: REPORT_SYSTEM,
      prompt: reportPrompt(question, pack, maxChars),
      maxTokens: 900,
    })
  ).trim();

  const cited = hasCitations(text);
  if (requireCitations && !cited) {
    return { text: `${MISSING_CITATIONS}. Raw evidence is in structured content.`, cited };
  }

  return { text, cited };
};
