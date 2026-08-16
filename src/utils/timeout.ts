export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

export const withDeadline = async <T>(
  ms: number,
  run: (signal: AbortSignal) => Promise<T>,
  outer?: AbortSignal,
): Promise<T> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new TimeoutError(ms)), ms);
  const relay = () => controller.abort(outer?.reason);
  outer?.addEventListener("abort", relay, { once: true });

  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", relay);
  }
};

export const runPooled = async <I, O>(
  items: I[],
  limit: number,
  run: (item: I, index: number) => Promise<O>,
): Promise<O[]> => {
  const results = new Array<O>(items.length);
  const size = Math.max(1, Math.min(limit, items.length));
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor++;
      const item = items[index] as I;
      results[index] = await run(item, index);
    }
  };

  await Promise.all(Array.from({ length: size }, worker));
  return results;
};
