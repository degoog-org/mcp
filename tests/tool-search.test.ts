import { describe, expect, test } from "bun:test";
import { OutputMode } from "../src/config/schema.ts";
import { runSearchTool } from "../src/tools/search.ts";
import { fakeResult, fakeSearch, makeCtx, serveFake, structured, visibleText } from "./helpers.ts";

const results = [
  fakeResult({
    url: "https://bun.sh/docs/api/http",
    title: "Bun HTTP server API",
    snippet: "Bun serve creates an http server with a fetch handler.",
    sources: ["Brave", "DuckDuckGo"],
  }),
  fakeResult({
    url: "https://bun.sh/docs/api/http?utm_source=news",
    title: "Bun HTTP server API",
    snippet: "Duplicate of the same documentation page.",
    sources: ["Mojeek"],
  }),
  fakeResult({
    url: "https://example.org/blog/bun-http",
    title: "Writing an http server in Bun",
    snippet: "A walkthrough of Bun serve for a small http api.",
    sources: ["Brave"],
  }),
  fakeResult({
    url: "https://news.example.net/bun-http-roundup",
    title: "Bun http roundup",
    snippet: "Weekly roundup mentioning the Bun http server.",
    sources: ["DuckDuckGo"],
  }),
];

describe("search tool", () => {
  test("returns short visible text and cited structured results", async () => {
    const server = serveFake(() => Response.json(fakeSearch(results, "bun http")));
    const ctx = makeCtx(server.url);

    const result = await runSearchTool(ctx, { query: "bun http server" });
    const data = structured(result);
    const rows = data.results as Array<Record<string, unknown>>;

    expect(visibleText(result)).toContain("Search ready:");
    expect(visibleText(result).split("\n")).toHaveLength(3);
    expect(rows[0]?.id).toBe("S1");
    expect(rows.map((row) => row.id)).toEqual(rows.map((_, i) => `S${i + 1}`));
    expect(result.isError).toBeUndefined();

    expect(rows[0]).toHaveProperty("degoogScore");
    expect(rows[0]).not.toHaveProperty("score");
    expect(rows[0]).not.toHaveProperty("primary");
    expect(rows[0]).not.toHaveProperty("official");
    expect(visibleText(result)).not.toContain("Best sources");

    await server.stop();
  });

  test("merges duplicate urls and reports the merge", async () => {
    const server = serveFake(() => Response.json(fakeSearch(results)));
    const ctx = makeCtx(server.url);

    const data = structured(await runSearchTool(ctx, { query: "bun http server" }));
    const counts = data.counts as Record<string, number>;
    const rows = data.results as Array<{ url: string; engines: string[] }>;

    expect(counts.duplicatesMerged).toBe(1);
    expect(rows.filter((row) => row.url.startsWith("https://bun.sh"))).toHaveLength(1);
    expect(rows[0]?.engines.length).toBeGreaterThan(1);

    await server.stop();
  });

  test("caps results and reports what was omitted", async () => {
    const server = serveFake(() => Response.json(fakeSearch(results)));
    const ctx = makeCtx(server.url);

    const data = structured(
      await runSearchTool(ctx, { query: "bun http server", maxResults: 1 }),
    );
    const counts = data.counts as Record<string, number>;

    expect(counts.returned).toBe(1);
    expect(counts.omitted).toBeGreaterThan(0);

    await server.stop();
  });

  test("recommends one scrapable url per domain with matching ids", async () => {
    const server = serveFake(() => Response.json(fakeSearch(results)));
    const ctx = makeCtx(server.url);

    const data = structured(await runSearchTool(ctx, { query: "bun http server" }));
    const rows = data.results as Array<{ id: string; url: string }>;
    const picks = data.scrapeRecommendations as Array<{ id: string; url: string }>;
    const domains = picks.map((pick) => new URL(pick.url).hostname);

    expect(picks.length).toBeGreaterThan(0);
    expect(new Set(domains).size).toBe(domains.length);
    for (const pick of picks) {
      expect(rows.some((row) => row.id === pick.id && row.url === pick.url)).toBe(true);
    }

    await server.stop();
  });

  test("compact mode hides timings, balanced mode includes them", async () => {
    const server = serveFake(() => Response.json(fakeSearch(results)));

    const compact = structured(
      await runSearchTool(makeCtx(server.url), { query: "bun http server" }),
    );
    const balanced = structured(
      await runSearchTool(
        makeCtx(server.url, { output: { mode: OutputMode.Balanced } }),
        { query: "bun http server" },
      ),
    );

    expect(compact.timings).toBeUndefined();
    expect(compact.sourceOverlap).toBeUndefined();
    expect(balanced.timings).toBeDefined();
    expect(balanced.sourceOverlap).toBeDefined();

    await server.stop();
  });

  test("full mode adds the raw result count", async () => {
    const server = serveFake(() => Response.json(fakeSearch(results)));
    const ctx = makeCtx(server.url, { output: { mode: OutputMode.Full } });

    const data = structured(await runSearchTool(ctx, { query: "bun http server" }));

    expect(data.rawResultCount).toBe(results.length);

    await server.stop();
  });

  test("passes tab, page and engines through to Degoog", async () => {
    const server = serveFake((_request, url) =>
      url.pathname === "/api/search-tabs"
        ? Response.json({ tabs: [{ id: "engine:news", name: "News" }] })
        : Response.json(fakeSearch(results)),
    );
    const ctx = makeCtx(server.url);

    await runSearchTool(ctx, {
      query: "bun http server",
      type: "news",
      page: 2,
      engines: ["brave-engine"],
    });

    expect(server.hits).toContain("POST /api/search");
    expect(server.bodies[0]).toMatchObject({
      query: "bun http server",
      type: "news",
      page: 2,
      engines: ["brave-engine"],
    });

    await server.stop();
  });

  test("a repeated query is served from cache", async () => {
    const server = serveFake(() => Response.json(fakeSearch(results)));
    const ctx = makeCtx(server.url);

    await runSearchTool(ctx, { query: "bun http server" });
    await runSearchTool(ctx, { query: "bun http server" });

    expect(server.hits).toHaveLength(1);

    await server.stop();
  });

  test("an empty query is an input error", async () => {
    const ctx = makeCtx("http://127.0.0.1:1");

    const result = await runSearchTool(ctx, { query: "   " });
    const error = structured(result).error as Record<string, string>;

    expect(result.isError).toBe(true);
    expect(error.kind).toBe("input");
  });

  test("an upstream failure becomes an error result with a hint", async () => {
    const server = serveFake(() => new Response("nope", { status: 500 }));
    const ctx = makeCtx(server.url);

    const result = await runSearchTool(ctx, { query: "bun http server" });
    const error = structured(result).error as Record<string, string>;

    expect(result.isError).toBe(true);
    expect(error.kind).toBe("upstream");
    expect(visibleText(result)).toContain("health tool");

    await server.stop();
  });
});
