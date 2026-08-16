import { afterAll, describe, expect, test } from "bun:test";
import { ProviderFallback } from "../src/config/schema.ts";
import { runCommandTool } from "../src/tools/command.ts";
import { ToolName } from "../src/tools/context.ts";
import { runDiscoverTool } from "../src/tools/discover.ts";
import { runRetryTool } from "../src/tools/retry-engine.ts";
import { suggestCached } from "../src/degoog/cached.ts";
import { fakeResult, fakeSearch, makeCtx, serveFake, structured, visibleText } from "./helpers.ts";

const server = serveFake((_request, url) => {
  if (url.pathname === "/api/search-tabs") {
    return Response.json({ tabs: [{ id: "images", label: "Images" }] });
  }
  if (url.pathname === "/api/extensions") {
    const type = url.searchParams.get("type");
    if (type === "engine") {
      return Response.json({
        engines: [
          { id: "brave-engine", name: "Brave", enabled: true },
          { id: "mojeek-engine", name: "Mojeek", enabled: false },
        ],
      });
    }
    return Response.json({ autocomplete: [{ id: "duck-suggest", name: "Duck" }] });
  }
  if (url.pathname === "/api/commands") {
    return Response.json({
      commands: [{ trigger: "!uuid", category: "generators" }],
    });
  }
  if (url.pathname === "/api/command") {
    return Response.json({
      type: "generator",
      trigger: "!uuid",
      title: "UUID",
      html: [
        '<div class="command-result command-uuid">',
        '<div class="uuid-row"><code class="uuid-value">1f0b0c1e-dead-beef</code>',
        '<button type="button" class="uuid-copy" data-uuid="1f0b0c1e-dead-beef">Copy</button></div>',
        '<div class="uuid-row"><code class="uuid-value">2a1c9d7f-cafe-f00d</code>',
        '<button type="button" class="uuid-copy" data-uuid="2a1c9d7f-cafe-f00d">Copy</button></div>',
        "<script>alert(1)</script></div>",
      ].join(""),
      page: 1,
      totalPages: 1,
    });
  }
  if (url.pathname === "/api/suggest") {
    return Response.json(["bun test", "bun test runner", { text: "bun testing" }]);
  }
  if (url.pathname === "/api/search/retry") {
    return Response.json({
      ...fakeSearch([fakeResult({ url: "https://bun.sh/docs/cli/test" })]),
      engineTimings: [{ name: "Brave", time: 90, resultCount: 1 }],
    });
  }

  return new Response("not found", { status: 404 });
});

afterAll(async () => {
  await server.stop();
});

describe("discover tool", () => {
  test("reports tabs, engines, commands and caps", async () => {
    const ctx = makeCtx(server.url);

    const result = await runDiscoverTool(ctx);
    const data = structured(result);

    expect(data.searchTypes).toEqual(["web", "images"]);
    expect(data.engines).toHaveLength(2);
    expect(data.commands).toEqual([{ trigger: "!uuid", category: "generators" }]);
    expect(data.suggestionsAvailable).toBe(true);
    expect(data.deepSearchEnabled).toBe(false);
    expect(data.problems).toEqual([]);
    expect((data.caps as Record<string, unknown>).scrapeRenderer).toBe("static");
  });

  test("hides deep search from the enabled tool list while it is off", async () => {
    const data = structured(await runDiscoverTool(makeCtx(server.url)));

    expect(data.enabledTools).not.toContain(ToolName.DeepSearch);
    expect(data.enabledTools).toContain(ToolName.BundleSearch);
  });

  test("names the disabled tool, why it is off and what to use instead", async () => {
    const result = await runDiscoverTool(makeCtx(server.url));
    const off = structured(result).disabledTools as Array<Record<string, string>>;

    expect(off).toEqual([
      {
        name: ToolName.DeepSearch,
        reason: "deepSearch.enabled is false in mcp.yml",
        onCall:
          "it stays registered and every call returns a degraded bundle_search evidence pack, labelled as such",
        useInstead: ToolName.BundleSearch,
      },
    ]);
    expect(visibleText(result)).toContain("Unavailable tools: deep_search (use bundle_search)");
  });

  test("offers no substitute when the fallback is off", async () => {
    const ctx = makeCtx(server.url, {
      deepSearch: { onProviderUnavailable: ProviderFallback.Off },
    });
    const result = await runDiscoverTool(ctx);
    const off = structured(result).disabledTools as Array<Record<string, string>>;

    expect(off[0]?.useInstead).toBeUndefined();
    expect(off[0]?.onCall).toContain("nothing runs in its place");
    expect(visibleText(result)).toContain("Unavailable tools: deep_search (no substitute)");
  });

  test("lists deep search once it is enabled and configured", async () => {
    const ctx = makeCtx(server.url, {
      deepSearch: { enabled: true, model: "qwen3:8b" },
    });

    const data = structured(await runDiscoverTool(ctx));

    expect(data.enabledTools).toContain(ToolName.DeepSearch);
    expect(data.deepSearchEnabled).toBe(true);
    expect(data.deepSearchReady).toBe(true);
    expect(data.disabledTools).toEqual([]);
  });

  test("enabled but unconfigured deep search is not reported as available", async () => {
    const ctx = makeCtx(server.url, { deepSearch: { enabled: true } });

    const data = structured(await runDiscoverTool(ctx));
    const off = data.disabledTools as Array<Record<string, string>>;

    expect(data.deepSearchEnabled).toBe(true);
    expect(data.deepSearchReady).toBe(false);
    expect(data.enabledTools).not.toContain(ToolName.DeepSearch);
    expect(off[0]?.reason).toContain("deepSearch.model is empty");
  });

  test("capabilities are cached between calls", async () => {
    const ctx = makeCtx(server.url);
    const before = server.hits.length;

    await runDiscoverTool(ctx);
    const firstRound = server.hits.length - before;
    await runDiscoverTool(ctx);

    expect(server.hits.length - before).toBe(firstRound);
  });
});

describe("suggest helper stays available for query expansion", () => {
  test("normalizes plain strings and objects", async () => {
    const ctx = makeCtx(server.url);

    const suggestions = await suggestCached(ctx.client, ctx.cache, "bun te");

    expect(suggestions).toEqual([
      { text: "bun test" },
      { text: "bun test runner" },
      { text: "bun testing" },
    ]);
  });

  test("is not registered as a public MCP tool", () => {
    expect(Object.values(ToolName)).not.toContain("suggest");
  });
});

describe("retry engine tool", () => {
  test("re-runs one engine and reports its timing", async () => {
    const ctx = makeCtx(server.url);

    const result = await runRetryTool(ctx, { query: "bun test", engine: "Brave" });
    const data = structured(result);

    expect(server.hits.some((hit) => hit.includes("/api/search/retry"))).toBe(true);
    expect(server.hits.some((hit) => hit.includes("engine=Brave"))).toBe(true);
    expect((data.results as unknown[]).length).toBe(1);
    expect(data.engineTiming).toMatchObject({ name: "Brave", resultCount: 1 });
    expect(visibleText(result)).toContain("Retried Brave");
  });
});

describe("retry engine visible text", () => {
  const ENGINE_ID = "degoog-org-official-extensions-bing-news-engine";

  const merged = serveFake(() =>
    Response.json({
      ...fakeSearch([
        fakeResult({ url: "https://www.gamesradar.com/kh4", source: "Bing News" }),
        fakeResult({ url: "https://www.eurogamer.net/kh4", source: "Bing News" }),
        fakeResult({ url: "https://www.polygon.com/kh4", source: "DuckDuckGo" }),
      ]),
      timing: { name: "Bing News", time: 210, resultCount: 8 },
      engineTimings: [
        { name: "DuckDuckGo", time: 190, resultCount: 5 },
        { name: "Bing News", time: 210, resultCount: 8 },
      ],
    }),
  );

  afterAll(async () => {
    await merged.stop();
  });

  test("does not claim zero results when the engine id differs from its name", async () => {
    const ctx = makeCtx(merged.url);

    const result = await runRetryTool(ctx, {
      query: "kingdom hearts 4 info",
      engine: ENGINE_ID,
      type: "engine:news",
    });
    const text = visibleText(result);
    const counts = structured(result).counts as Record<string, number>;

    expect(text).not.toContain("0 from that engine");
    expect(text).toContain("Bing News");
    expect(text).toContain("that engine returned 8 results");
    expect(counts.engineResults).toBe(8);
    expect(counts.fromEngine).toBe(2);
  });

  test("the visible counts match the structured content", async () => {
    const ctx = makeCtx(merged.url);

    const result = await runRetryTool(ctx, {
      query: "kingdom hearts 4 news",
      engine: ENGINE_ID,
    });
    const counts = structured(result).counts as Record<string, number>;
    const text = visibleText(result);

    expect(text).toContain(`${counts.merged} ranked results`);
    expect(text).toContain(`${counts.fromEngine} of the ranked results`);
  });

  test("says the per engine count is unknown instead of printing a fake zero", async () => {
    const bare = serveFake(() =>
      Response.json({
        ...fakeSearch([fakeResult({ url: "https://example.org/a", source: "Mojeek" })]),
        engineTimings: [],
      }),
    );
    const ctx = makeCtx(bare.url);

    const text = visibleText(
      await runRetryTool(ctx, { query: "kingdom hearts", engine: "Ghost Engine" }),
    );

    expect(text).not.toContain("0 from that engine");
    expect(text).toContain("did not report a per-engine count");

    await bare.stop();
  });
});

describe("command tool", () => {
  test("renders command html as plain text without scripts", async () => {
    const ctx = makeCtx(server.url);

    const result = await runCommandTool(ctx, { query: "!uuid" });
    const data = structured(result);

    expect(data.trigger).toBe("!uuid");
    expect(data.text).toContain("1f0b0c1e-dead-beef");
    expect(data.text).not.toContain("alert(1)");
    expect(visibleText(result)).toContain("UUID:");
  });

  test("copy button chrome never leaks into the uuid output", async () => {
    const ctx = makeCtx(server.url);

    const text = structured(await runCommandTool(ctx, { query: "!uuid" })).text as string;
    const lines = text.split("\n").filter((line) => line.trim());

    expect(text).not.toContain("Copy");
    expect(lines).toEqual(["1f0b0c1e-dead-beef", "2a1c9d7f-cafe-f00d"]);
  });

  test("an unreachable command api becomes an error result with a hint", async () => {
    const ctx = makeCtx("http://127.0.0.1:1");

    const result = await runCommandTool(ctx, { query: "!uuid" });

    expect(result.isError).toBe(true);
    expect(visibleText(result)).toContain("discover");
  });
});
