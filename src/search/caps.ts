export interface Capped<T> {
  items: T[];
  omitted: number;
}

export const capList = <T>(items: T[], max: number): Capped<T> => {
  const limit = Math.max(0, max);
  return {
    items: items.slice(0, limit),
    omitted: Math.max(0, items.length - limit),
  };
};

export const capChars = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
