export interface Entry<T> {
  value: T;
  bytes: number;
  expiresAt: number;
}

export const isExpired = (entry: Entry<unknown>, now = Date.now()): boolean =>
  entry.expiresAt <= now;

export const sizeOf = (value: unknown): number => {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
};
