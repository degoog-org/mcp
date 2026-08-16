const NOISE_LINES = [
  /^(accept|manage|allow) (all )?cookies?$/i,
  /^(subscribe|sign up|log ?in|sign in|register)\b/i,
  /^share (this|on)\b/i,
  /^advertisement$/i,
  /^skip to (main )?content$/i,
  /^cookie (policy|settings|preferences)$/i,
  /^(follow us|newsletter)\b/i,
  /^\[\s*edit\s*\]$/i,
];

const isNoise = (line: string): boolean =>
  NOISE_LINES.some((pattern) => pattern.test(line.trim()));

export const cleanText = (text: string): string => {
  const seen = new Set<string>();
  const kept: string[] = [];

  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/[ \t]+/g, " ").trimEnd();

    if (!line.trim()) {
      if (kept.at(-1) !== "") kept.push("");
      continue;
    }
    if (isNoise(line)) continue;

    const key = line.trim().toLowerCase();
    if (key.length > 12) {
      if (seen.has(key)) continue;
      seen.add(key);
    }

    kept.push(line);
  }

  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
};
