import { describe, expect, test } from "bun:test";
import type { Candidate } from "../src/bundle/candidate-picker.ts";
import { gatherInDegoogOrder } from "../src/bundle/gather.ts";
import type { ScrapeRow } from "../src/scrape/pipeline.ts";

const candidates = (count: number): Candidate[] =>
  Array.from({ length: count }, (_, index) => ({
    url: `https://s${index + 1}.example/`,
    title: `S${index + 1}`,
    domain: `s${index + 1}.example`,
    reason: "next in Degoog order",
    degoogScore: 100 - index,
  }));

const row = (url: string, ok: boolean, error?: string): ScrapeRow => ({
  url,
  finalUrl: url,
  ok,
  title: ok ? "Title" : "",
  canonical: "",
  publishedAt: null,
  siteName: null,
  chunks: ok
    ? [{ text: "evidence", heading: null, index: 0, score: 1, match: 0 }]
    : [],
  chunksOmitted: 0,
  chars: ok ? 8 : 0,
  truncated: false,
  redirects: [],
  ...(error ? { error } : {}),
});

const urlsOf = (numbers: number[]): Set<string> =>
  new Set(numbers.map((n) => `https://s${n}.example/`));

const run = async (options: {
  total: number;
  target: number;
  overage: number;
  fail: number[];
}) => {
  const list = candidates(options.total);
  const failing = urlsOf(options.fail);
  const waveSizes: number[] = [];

  const outcome = await gatherInDegoogOrder({
    candidates: list,
    target: options.target,
    firstWave: Math.min(options.total, options.target + options.overage),
    scrape: async (urls) => {
      waveSizes.push(urls.length);
      return urls.map((url) =>
        row(url, !failing.has(url), failing.has(url) ? "HTTP 403" : undefined),
      );
    },
  });

  const kept = outcome.rows
    .filter((entry) => entry.ok)
    .map((entry) => Number(entry.url.replace(/\D+/g, "")));

  return { outcome, waveSizes, kept };
};

describe("bundle gathering walks Degoog order", () => {
  test("stops at the target when the top sources all read cleanly", async () => {
    const { outcome, waveSizes, kept } = await run({
      total: 10,
      target: 4,
      overage: 3,
      fail: [],
    });

    expect(kept).toEqual([1, 2, 3, 4]);
    expect(waveSizes).toEqual([7]);
    expect(outcome.useful).toBe(4);
    expect(outcome.surplus).toBe(3);
    expect(outcome.continued).toBe(false);
  });

  test("continues past failed top sources without a second round trip", async () => {
    const { outcome, waveSizes, kept } = await run({
      total: 10,
      target: 4,
      overage: 3,
      fail: [1, 2],
    });

    expect(kept).toEqual([3, 4, 5, 6]);
    expect(waveSizes).toEqual([7]);
    expect(outcome.useful).toBe(4);
    expect(outcome.failed).toBe(2);
  });

  test("runs one follow-up wave when the first wave falls short", async () => {
    const { outcome, waveSizes, kept } = await run({
      total: 10,
      target: 4,
      overage: 0,
      fail: [2],
    });

    expect(kept).toEqual([1, 3, 4, 5]);
    expect(waveSizes).toEqual([4, 1]);
    expect(outcome.continued).toBe(true);
    expect(outcome.waves).toBe(2);
  });

  test("reports exhaustion instead of pretending it hit the target", async () => {
    const { outcome, kept } = await run({
      total: 5,
      target: 4,
      overage: 3,
      fail: [1, 2, 3],
    });

    expect(kept).toEqual([4, 5]);
    expect(outcome.useful).toBe(2);
    expect(outcome.exhausted).toBe(true);
  });

  test("keeps every failure in the returned rows", async () => {
    const { outcome } = await run({
      total: 10,
      target: 4,
      overage: 3,
      fail: [1, 2],
    });

    const failures = outcome.rows.filter((entry) => !entry.ok);
    expect(failures.map((entry) => entry.url)).toEqual([
      "https://s1.example/",
      "https://s2.example/",
    ]);
    expect(failures.every((entry) => entry.error === "HTTP 403")).toBe(true);
  });

  test("never reorders the sources it keeps", async () => {
    const { kept } = await run({ total: 10, target: 3, overage: 5, fail: [2, 4] });
    expect(kept).toEqual([1, 3, 5]);
    expect([...kept].sort((a, b) => a - b)).toEqual(kept);
  });
});
