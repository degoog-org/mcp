import type { ScrapeRow } from "../scrape/pipeline.ts";
import type { Candidate } from "./candidate-picker.ts";

export interface GatherInput {
  candidates: Candidate[];
  target: number;
  firstWave: number;
  scrape: (urls: string[]) => Promise<ScrapeRow[]>;
}

export interface GatherOutcome {
  rows: ScrapeRow[];
  attempted: number;
  useful: number;
  failed: number;
  surplus: number;
  waves: number;
  continued: boolean;
  exhausted: boolean;
}

const usefulCount = (rows: ScrapeRow[]): number =>
  rows.filter((row) => row.ok).length;

export const gatherInDegoogOrder = async (
  input: GatherInput,
): Promise<GatherOutcome> => {
  const { candidates, target } = input;
  const order = new Map(candidates.map((entry, index) => [entry.url, index]));

  const collected: ScrapeRow[] = [];
  let cursor = 0;
  let waves = 0;

  const runWave = async (size: number): Promise<void> => {
    const slice = candidates.slice(cursor, cursor + size);
    if (!slice.length) return;

    const rows = await input.scrape(slice.map((entry) => entry.url));
    collected.push(...rows);
    cursor += slice.length;
    waves++;
  };

  await runWave(Math.max(1, input.firstWave));

  const shortBy = target - usefulCount(collected);
  const continued = shortBy > 0 && cursor < candidates.length;

  if (continued) {
    await runWave(shortBy + Math.max(0, input.firstWave - target));
  }

  const ordered = [...collected].sort(
    (a, b) =>
      (order.get(a.url) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(b.url) ?? Number.MAX_SAFE_INTEGER),
  );

  const usable = ordered.filter((row) => row.ok);
  const failures = ordered.filter((row) => !row.ok);
  const kept = usable.slice(0, target);

  return {
    rows: [...kept, ...failures],
    attempted: cursor,
    useful: kept.length,
    failed: failures.length,
    surplus: usable.length - kept.length,
    waves,
    continued,
    exhausted: kept.length < target && cursor >= candidates.length,
  };
};
