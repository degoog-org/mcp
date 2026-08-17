import { afterAll, describe, expect, test } from "bun:test";
import { pickCandidates } from "../src/bundle/candidate-picker.ts";
import { QueryExpansion, TextMode } from "../src/config/schema.ts";
import { normalize } from "../src/search/normalize.ts";
import { shapeResults } from "../src/search/shape.ts";
import { DEFAULT_CONFIG } from "../src/config/defaults.ts";
import { runBundleTool } from "../src/tools/bundle-search.ts";
import { fakeResult, fakeSearch, longText, makeCtx, pageHtml, serveFake, structured, visibleText } from "./helpers.ts";

interface Pack {
  originalQueries: string[];
  searchedQueries: string[];
  queriesOmitted: number;
  expansion: { used: boolean; source: string; added: string[] };
  counts: Record<string, number>;
  sources: Array<{ id: string; title: string; url: string; reason: string }>;
  evidence: Array<{ id: string; text: string }>;
  failedSources: Array<{ url: string; reason: string }>;
  nextActions: string[];
  selectionPolicy: string;
  textMode: string;
  selection: {
    target: number;
    attempted: number;
    waves: number;
    continuedAfterFailure: boolean;
    surplusDiscarded: number;
    candidatesExhausted: boolean;
  };
  rankedResults?: unknown;
}

let port = "";

const alias = (host: string, path: string): string =>
  `http://${host}:${port}${path}`;

const searchResults = () => [
  fakeResult({
    url: alias("localhost", "/docs"),
    title: "Official docs",
    snippet: "The official documentation about installing the thing.",
    sources: ["Brave", "Mojeek"],
  }),
  fakeResult({
    url: alias("127.0.0.1", "/guide"),
    title: "Community guide",
    snippet: "A community guide about installing and configuring the thing.",
    sources: ["DuckDuckGo"],
  }),
  fakeResult({
    url: alias("0.0.0.0", "/blog"),
    title: "Blog post",
    snippet: "Blog notes about configuring the thing.",
    sources: ["Brave"],
  }),
  fakeResult({
    url: alias("[::1]", "/gone"),
    title: "Dead link",
    snippet: "This one will not load.",
    sources: ["Mojeek"],
  }),
];

const SLOW_QUERY = "slowpoke";

const server = serveFake(async (request, url) => {
  if (url.pathname === "/api/search") {
    const query =
      url.searchParams.get("q") ??
      ((await request.clone().json()) as { query?: string }).query ??
      "";
    if (query.includes(SLOW_QUERY)) await Bun.sleep(300);
    return Response.json(fakeSearch(searchResults(), query));
  }
  if (url.pathname === "/api/suggest") {
    return Response.json(["install the thing on linux", "install the thing on mac"]);
  }
  if (url.pathname === "/gone") {
    return new Response("gone", { status: 410 });
  }

  return new Response(
    pageHtml(`Page ${url.pathname}`, [
      longText("install", 12),
      longText("configure", 12),
    ]),
    { headers: { "content-type": "text/html" } },
  );
});

port = new URL(server.url).port;

const packOf = (result: { structuredContent?: Record<string, unknown> }): Pack =>
  structured(result) as unknown as Pack;

afterAll(async () => {
  await server.stop();
});

describe("bundle source selection", () => {
  const rankedFor = (query: string, results: Parameters<typeof fakeResult>[0][]) =>
    shapeResults(normalize(results.map(fakeResult), query));

  test("bundle candidates keep Degoog order instead of promoting official-looking pages", () => {
    const ranked = rankedFor("kingdom hearts 4 info", [
      {
        url: "https://www.gamesradar.com/games/kingdom-hearts-4-everything-we-know",
        sources: ["Brave", "DuckDuckGo", "Mojeek"],
      },
      {
        url: "https://square-enix-games.com/press/kingdom-hearts-4",
        sources: ["Brave"],
      },
    ]);

    const picked = pickCandidates(ranked, 2);

    expect(picked[0]?.domain).toBe("gamesradar.com");
    expect(picked[1]?.domain).toBe("square-enix-games.com");
  });

  test("bundle candidates do not demote scrape hostile syndicators", () => {
    const ranked = rankedFor("kingdom hearts 4 info", [
      {
        url: "https://www.msn.com/en-gb/entertainment/kingdom-hearts-4-trailer",
        sources: ["Brave", "DuckDuckGo", "Mojeek"],
      },
      { url: "https://www.eurogamer.net/kingdom-hearts-4-coco-world", sources: ["Brave"] },
    ]);

    expect(pickCandidates(ranked, 2).map((entry) => entry.domain)).toEqual([
      "msn.com",
      "eurogamer.net",
    ]);
  });

  test("selection still keeps one source per root domain and honours the cap", () => {
    const ranked = rankedFor("kingdom hearts 4", [
      { url: "https://www.eurogamer.net/a", sources: ["Brave", "Mojeek"] },
      { url: "https://www.eurogamer.net/b", sources: ["Brave"] },
      { url: "https://www.polygon.com/c", sources: ["Brave"] },
    ]);

    const picked = pickCandidates(ranked, 5);

    expect(picked).toHaveLength(2);
    expect(new Set(picked.map((entry) => entry.domain)).size).toBe(2);
  });
});

describe("bundle search evidence pack", () => {
  test("returns sources, chunks and a compact directive", async () => {
    const ctx = makeCtx(server.url);

    const result = await runBundleTool(ctx, { query: "install the thing" });
    const pack = packOf(result);

    expect(pack.sources.length).toBeGreaterThan(1);
    expect(pack.evidence.length).toBeGreaterThan(0);
    expect(pack.sources.map((source) => source.id)).toEqual(
      pack.sources.map((_, i) => `S${i + 1}`),
    );
    expect(visibleText(result)).toContain("Bundle ready:");
    expect(visibleText(result)).toContain("Cite");
    expect(result.isError).toBeUndefined();
  });

  test("every evidence chunk points at a listed source", async () => {
    const pack = packOf(await runBundleTool(makeCtx(server.url), { query: "install the thing" }));
    const ids = new Set(pack.sources.map((source) => source.id));

    for (const chunk of pack.evidence) {
      expect(ids.has(chunk.id)).toBe(true);
    }
  });

  test("does not synthesise an answer", async () => {
    const result = await runBundleTool(makeCtx(server.url), { query: "install the thing" });
    const pack = packOf(result);

    expect(pack).not.toHaveProperty("answer");
    expect(pack).not.toHaveProperty("report");
    expect(pack).not.toHaveProperty("summary");
    expect(visibleText(result)).toContain("Answer using evidence first");
  });

  test("records why each source was selected", async () => {
    const pack = packOf(await runBundleTool(makeCtx(server.url), { query: "install the thing" }));

    for (const source of pack.sources) {
      expect(source.reason.length).toBeGreaterThan(0);
    }
  });

  test("failed sources are reported, never silently dropped", async () => {
    const pack = packOf(await runBundleTool(makeCtx(server.url), { query: "install the thing" }));

    expect(pack.failedSources.length).toBeGreaterThan(0);
    expect(pack.failedSources[0]?.reason.length).toBeGreaterThan(0);
    expect(pack.counts.failures).toBe(pack.failedSources.length);
    expect(pack.nextActions.join(" ")).toContain("failed");
  });
});

describe("bundle search text mode", () => {
  const fullCtx = () =>
    makeCtx(server.url, { bundleSearch: { textMode: TextMode.Full } });

  test("the default keeps the compact summary and nothing else", async () => {
    const result = await runBundleTool(makeCtx(server.url), {
      query: "install the thing",
    });
    const text = visibleText(result);

    expect(packOf(result).textMode).toBe(TextMode.Compact);
    expect(text).toContain("Bundle ready:");
    expect(text).not.toContain("Sources:");
    expect(text).not.toContain("Evidence:");
    expect(text.split("\n").filter(Boolean).length).toBeLessThan(5);
  });

  test("full mode prints source rows and evidence in visible text", async () => {
    const result = await runBundleTool(fullCtx(), { query: "install the thing" });
    const pack = packOf(result);
    const text = visibleText(result);
    const first = pack.sources[0];

    expect(pack.textMode).toBe(TextMode.Full);
    expect(text).toContain("Bundle ready:");
    expect(text).toContain("Sources:");
    expect(text).toContain(`[S1] ${first?.title} - ${first?.url}`);
    expect(text).toContain("Evidence:");
    expect(text).toContain(pack.evidence[0]?.text as string);
  });

  test("full mode reuses the structured source ids", async () => {
    const result = await runBundleTool(fullCtx(), { query: "install the thing" });
    const pack = packOf(result);
    const text = visibleText(result);

    for (const source of pack.sources) {
      expect(text).toContain(`[${source.id}] `);
    }
    for (const chunk of pack.evidence) {
      expect(text).toContain(`[${chunk.id}] `);
    }
  });

  test("full mode leaves the structured pack alone", async () => {
    const compact = packOf(
      await runBundleTool(makeCtx(server.url), { query: "install the thing" }),
    );
    const full = packOf(
      await runBundleTool(fullCtx(), { query: "install the thing" }),
    );

    expect(full.sources).toEqual(compact.sources);
    expect(full.evidence).toEqual(compact.evidence);
    expect(full.counts).toEqual(compact.counts);
  });

  test("full mode still refuses to synthesise an answer", async () => {
    const result = await runBundleTool(fullCtx(), { query: "install the thing" });
    const pack = packOf(result);
    const text = visibleText(result);

    expect(pack).not.toHaveProperty("answer");
    expect(pack).not.toHaveProperty("report");
    expect(pack).not.toHaveProperty("summary");
    expect(text).toContain("not an answer");
    expect(text).not.toContain("Answer:");
    expect(text).not.toContain("Report:");
    expect(text).not.toContain("Summary:");
  });

  test("full mode stays inside the evidence budget", async () => {
    const result = await runBundleTool(fullCtx(), {
      query: "install the thing",
      maxEvidenceChars: 900,
    });
    const pack = packOf(result);
    const evidence = visibleText(result).split("Evidence:")[1] ?? "";

    expect(pack.counts.evidenceChars).toBeLessThanOrEqual(900);
    expect(evidence.length).toBeLessThan(2000);
  });
});

describe("bundle search timeout", () => {
  test("a run past the budget returns a timeout error naming the tool", async () => {
    const ctx = makeCtx(server.url, { bundleSearch: { timeout: 50 } });

    const result = await runBundleTool(ctx, { query: `${SLOW_QUERY} install` });
    const error = structured(result).error as Record<string, string>;

    expect(result.isError).toBe(true);
    expect(error.kind).toBe("timeout");
    expect(error.message).toContain("bundle_search timed out after 50ms");
    expect(error.hint).toContain("bundleSearch.timeout");
  });

  test("the generous default lets a normal run finish", async () => {
    const result = await runBundleTool(makeCtx(server.url), {
      query: "install the thing",
    });

    expect(result.isError).toBeUndefined();
    expect(DEFAULT_CONFIG.bundleSearch.timeout).toBe(90000);
  });
});

describe("bundle search query control", () => {
  test("uses only the queries the agent asked for", async () => {
    const ctx = makeCtx(server.url);

    const pack = packOf(
      await runBundleTool(ctx, { queries: ["first query", "second query"] }),
    );

    expect(pack.originalQueries).toEqual(["first query", "second query"]);
    expect(pack.searchedQueries).toEqual(["first query", "second query"]);
    expect(pack.expansion.used).toBe(false);
  });

  test("caps an oversized query list and says how many were dropped", async () => {
    const ctx = makeCtx(server.url);
    const limit = DEFAULT_CONFIG.bundleSearch.maxQueries;
    const queries = Array.from({ length: limit + 2 }, (_, i) => `query ${i}`);

    const pack = packOf(await runBundleTool(ctx, { queries }));

    expect(pack.searchedQueries).toHaveLength(limit);
    expect(pack.queriesOmitted).toBe(2);
  });

  test("a single query respects the configured maxQueries", async () => {
    const ctx = makeCtx(server.url);

    const pack = packOf(await runBundleTool(ctx, { query: "install the thing" }));

    expect(pack.searchedQueries).toEqual(["install the thing"]);
  });

  test("no expansion happens by default", async () => {
    const ctx = makeCtx(server.url);
    const before = server.hits.length;

    const pack = packOf(await runBundleTool(ctx, { query: "no expansion please" }));
    const hits = server.hits.slice(before);

    expect(pack.expansion.used).toBe(false);
    expect(pack.expansion.added).toEqual([]);
    expect(hits.some((hit) => hit.includes("/api/suggest"))).toBe(false);
  });

  test("opt-in expansion is disclosed and searched", async () => {
    const ctx = makeCtx(server.url);

    const pack = packOf(
      await runBundleTool(ctx, { query: "install the thing", expandQueries: true }),
    );

    expect(pack.expansion.used).toBe(true);
    expect(pack.expansion.source).toBe(QueryExpansion.Suggestions);
    expect(pack.expansion.added.length).toBeGreaterThan(0);
    expect(pack.searchedQueries).toEqual([
      "install the thing",
      ...pack.expansion.added,
    ]);
  });

  test("expandQueries false beats a config that enables expansion", async () => {
    const ctx = makeCtx(server.url, {
      bundleSearch: { queryExpansion: QueryExpansion.Suggestions },
    });

    const pack = packOf(
      await runBundleTool(ctx, { query: "config wants expansion", expandQueries: false }),
    );

    expect(pack.expansion.used).toBe(false);
  });

  test("missing query and queries is an input error", async () => {
    const result = await runBundleTool(makeCtx(server.url), {});
    const error = structured(result).error as Record<string, string>;

    expect(result.isError).toBe(true);
    expect(error.kind).toBe("input");
  });
});

describe("bundle search caps", () => {
  test("keeps at most the requested number of useful sources", async () => {
    const ctx = makeCtx(server.url);

    const pack = packOf(
      await runBundleTool(ctx, { query: "install the thing", maxScrapeUrls: 2 }),
    );

    expect(pack.sources.length).toBe(2);
    expect(pack.selection.target).toBe(2);
  });

  test("may attempt more than the target so failures do not shrink the pack", async () => {
    const ctx = makeCtx(server.url);

    const pack = packOf(
      await runBundleTool(ctx, { query: "install the thing", maxScrapeUrls: 2 }),
    );

    expect(pack.selection.attempted).toBeGreaterThanOrEqual(2);
    expect(pack.selectionPolicy).toBe("degoog_order_readable_sources");
  });

  test("reports the dead link it walked past instead of hiding it", async () => {
    const ctx = makeCtx(server.url);

    const pack = packOf(
      await runBundleTool(ctx, { query: "install the thing", maxScrapeUrls: 2 }),
    );

    expect(pack.failedSources.some((entry) => entry.url.endsWith("/gone"))).toBe(true);
  });

  test("respects a hard attempt ceiling", async () => {
    const ctx = makeCtx(server.url, {
      bundleSearch: { maxScrapeAttempts: 2, scrapeOverage: 0 },
    });

    const pack = packOf(
      await runBundleTool(ctx, { query: "install the thing", maxScrapeUrls: 2 }),
    );

    expect(pack.selection.attempted).toBeLessThanOrEqual(2);
  });

  test("keeps evidence inside the character budget and reports omissions", async () => {
    const ctx = makeCtx(server.url);

    const pack = packOf(
      await runBundleTool(ctx, { query: "install the thing", maxEvidenceChars: 900 }),
    );

    expect(pack.counts.evidenceChars).toBeLessThanOrEqual(900);
    expect(pack.counts.chunksOmitted).toBeGreaterThan(0);
    expect(pack.nextActions.join(" ")).toContain("capped");
  });

  test("raw ranked results stay out unless asked for", async () => {
    const lean = packOf(await runBundleTool(makeCtx(server.url), { query: "install the thing" }));
    const verbose = packOf(
      await runBundleTool(
        makeCtx(server.url, { bundleSearch: { includeRawResults: true } }),
        { query: "install the thing" },
      ),
    );

    expect(lean.rankedResults).toBeUndefined();
    expect(verbose.rankedResults).toBeDefined();
  });
});
