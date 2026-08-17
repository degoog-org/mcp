export class TimeoutError extends Error {
  constructor(ms: number, label?: string) {
    super(label ? `${label} timed out after ${ms}ms` : `timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

const chain = (controller: AbortController, outer?: AbortSignal): (() => void) => {
  if (!outer) return () => undefined;
  if (outer.aborted) {
    controller.abort(outer.reason);
    return () => undefined;
  }

  const relay = () => controller.abort(outer.reason);
  outer.addEventListener("abort", relay, { once: true });
  return () => outer.removeEventListener("abort", relay);
};

export const withDeadline = async <T>(
  ms: number,
  run: (signal: AbortSignal) => Promise<T>,
  outer?: AbortSignal,
): Promise<T> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new TimeoutError(ms)), ms);
  const unchain = chain(controller, outer);

  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
    unchain();
  }
};

export const withTimeLimit = async <T>(
  ms: number,
  label: string,
  run: (signal: AbortSignal) => Promise<T>,
  outer?: AbortSignal,
): Promise<T> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new TimeoutError(ms, label)), ms);
  const unchain = chain(controller, outer);

  const tripped = new Promise<never>((_, reject) => {
    if (controller.signal.aborted) return reject(controller.signal.reason);
    controller.signal.addEventListener(
      "abort",
      () => reject(controller.signal.reason),
      { once: true },
    );
  });

  try {
    const pending = run(controller.signal);
    pending.catch(() => undefined);
    return await Promise.race([pending, tripped]);
  } finally {
    clearTimeout(timer);
    unchain();
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
