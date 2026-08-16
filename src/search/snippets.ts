import { capChars } from "./caps.ts";

const BOILERPLATE = [
  /^\s*\d+\s+(hours?|days?|weeks?|months?|years?)\s+ago\s*[-–—]\s*/i,
  /^\s*(read more|continue reading)\s*[-–—:]\s*/i,
];

export const trimSnippet = (snippet: string, max: number): string => {
  let text = snippet.replace(/\s+/g, " ").trim();
  for (const pattern of BOILERPLATE) text = text.replace(pattern, "");

  if (text.length <= max) return text;

  const cut = text.slice(0, max);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "));
  if (lastStop > max * 0.6) return cut.slice(0, lastStop + 1);

  const lastSpace = cut.lastIndexOf(" ");
  return capChars(lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut, max);
};
