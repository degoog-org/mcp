export interface Citation {
  id: string;
  title: string;
  url: string;
  domain: string;
}

export const citeId = (index: number): string => `S${index + 1}`;

export const citeRange = (count: number): string => {
  if (count <= 0) return "none";
  if (count === 1) return citeId(0);
  return `${citeId(0)}-${citeId(count - 1)}`;
};

export const citeSome = (count: number, max = 3): string => {
  const picked = Array.from({ length: Math.min(count, max) }, (_, i) =>
    `[${citeId(i)}]`,
  );
  return picked.length ? picked.join(", ") : "none";
};
