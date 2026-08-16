export const queryTerms = (query: string): string[] =>
  query
    .toLowerCase()
    .split(/[^\p{L}\p{N}+#.]+/u)
    .filter((term) => term.length > 1);

export interface Chunk {
  text: string;
  heading: string | null;
  index: number;
  score: number;
  match: number;
}

const isHeading = (line: string): boolean => line.startsWith("#");

const splitLong = (block: string, chunkChars: number): string[] => {
  if (block.length <= chunkChars) return [block];

  const pieces: string[] = [];
  let current = "";

  for (const sentence of block.split(/(?<=[.!?])\s+/)) {
    if (current && current.length + sentence.length + 1 > chunkChars) {
      pieces.push(current);
      current = "";
    }
    current = current ? `${current} ${sentence}` : sentence;

    while (current.length > chunkChars) {
      pieces.push(current.slice(0, chunkChars));
      current = current.slice(chunkChars).trimStart();
    }
  }

  if (current) pieces.push(current);
  return pieces;
};

export const chunkText = (text: string, chunkChars: number): Chunk[] => {
  const chunks: Chunk[] = [];
  let heading: string | null = null;
  let buffer: string[] = [];
  let size = 0;

  const flush = (): void => {
    const body = buffer.join("\n").trim();
    buffer = [];
    size = 0;
    if (body.length < 40) return;
    chunks.push({ text: body, heading, index: chunks.length, score: 0, match: 0 });
  };

  for (const block of text.split(/\n{2,}/)) {
    const line = block.trim();
    if (!line) continue;

    if (isHeading(line)) {
      flush();
      heading = line.replace(/^#+\s*/, "");
      continue;
    }

    for (const piece of splitLong(line, chunkChars)) {
      if (size + piece.length > chunkChars && size > 0) flush();
      buffer.push(piece);
      size += piece.length + 1;
    }
  }

  flush();
  return chunks;
};

export const scoreChunks = (chunks: Chunk[], query: string): Chunk[] => {
  const terms = queryTerms(query);

  return chunks.map((chunk) => {
    if (!terms.length) {
      return { ...chunk, score: Math.max(0, 10 - chunk.index), match: 0 };
    }

    const haystack = `${chunk.heading ?? ""} ${chunk.text}`.toLowerCase();
    const hits = terms.filter((term) => haystack.includes(term)).length;
    const density = hits / terms.length;
    const position = Math.max(0, 4 - chunk.index * 0.5);

    return {
      ...chunk,
      score: Math.round(density * 100 + position),
      match: Math.round(density * 100),
    };
  });
};

export const pickChunks = (
  text: string,
  query: string,
  chunkChars: number,
  maxChunks: number,
  maxChars: number,
): { chunks: Chunk[]; omitted: number } => {
  const scored = scoreChunks(chunkText(text, chunkChars), query).sort(
    (a, b) => b.score - a.score || a.index - b.index,
  );

  const kept: Chunk[] = [];
  let used = 0;

  for (const chunk of scored) {
    if (kept.length >= maxChunks) break;
    if (used + chunk.text.length > maxChars && kept.length > 0) continue;
    kept.push(chunk);
    used += chunk.text.length;
  }

  kept.sort((a, b) => a.index - b.index);
  return { chunks: kept, omitted: Math.max(0, scored.length - kept.length) };
};
