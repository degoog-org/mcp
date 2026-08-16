export interface CharBudget {
  perSource: number;
  total: number;
}

export const splitBudget = (
  totalChars: number,
  sources: number,
  floor = 400,
): CharBudget => {
  const count = Math.max(1, sources);
  return {
    perSource: Math.max(floor, Math.floor(totalChars / count)),
    total: totalChars,
  };
};

export const fitsBudget = (used: number, next: number, total: number): boolean =>
  used + next <= total;
