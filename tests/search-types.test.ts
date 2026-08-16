import { afterAll, describe, expect, test } from "bun:test";
import {
  matchType,
  plainType,
  SearchTypeKind,
  toSearchTypes,
  toTypeCatalog,
} from "../src/degoog/search-types.ts";
import { runBundleTool } from "../src/tools/bundle-search.ts";
import { runDiscoverTool } from "../src/tools/discover.ts";
import { runRetryTool } from "../src/tools/retry-engine.ts";
import { runSearchTool } from "../src/tools/search.ts";
import { fakeResult, fakeSearch, makeCtx, serveFake, structured, visibleText } from "./helpers.ts";

const TABS = [
  { id: "engine:images", name: "Images", icon: null },
  { id: "engine:news", name: "News", icon: null },
  { id: "engine:videos", name: "Videos", icon: null },
  { id: "engine:file", name: "File", icon: null },
  { id: "engine:weeb", name: "Weeb", icon: null },
  { id: "engine:engine-news", name: "Engine-news", icon: null },
  { id: "recipes", name: "Recipes", icon: null },
];

const hit = fakeResult({ url: "https://bun.sh/docs/cli/test" });

const server = serveFake((_request, url) => {
  if (url.pathname === "/api/search-tabs") return Response.json({ tabs: TABS });
  if (url.pathname === "/api/extensions") {
    return Response.json(
      url.searchParams.get("type") === "engine"
        ? { engines: [{ id: "brave-engine", name: "Brave", enabled: true }] }
        : { autocomplete: [] },
    );
  }
  if (url.pathname === "/api/commands") return Response.json({ commands: [] });
  if (url.pathname === "/api/search" || url.pathname === "/api/tab-search") {
    return Response.json(fakeSearch([hit]));
  }
  if (url.pathname === "/api/search/retry") return Response.json(fakeSearch([hit]));

  return new Response("not found", { status: 404 });
});

afterAll(async () => {
  await server.stop();
});

describe("search type normalization", () => {
  test("strips the engine and tab prefixes Degoog uses internally", () => {
    expect(plainType("engine:news")).toBe("news");
    expect(plainType("tab:engine:images")).toBe("images");
    expect(plainType("tab:recipes")).toBe("recipes");
    expect(plainType("  news  ")).toBe("news");
    expect(plainType("web")).toBe("web");
  });

  test("keeps engine types that legitimately start with engine-", () => {
    expect(plainType("engine:engine-news")).toBe("engine-news");
  });

  test("classifies engine backed tabs apart from plugin tabs", () => {
    const types = toSearchTypes(TABS);

    expect(types[0]).toEqual({ id: "web", name: "Web", kind: SearchTypeKind.Web });
    expect(types.find((entry) => entry.id === "news")?.kind).toBe(SearchTypeKind.Engine);

    const plugin = types.find((entry) => entry.id === "recipes");
    expect(plugin?.kind).toBe(SearchTypeKind.Tab);
    expect(plugin?.tabId).toBe("recipes");
  });

  test("matches legacy and differently cased values", () => {
    const types = toSearchTypes(TABS);

    expect(matchType("engine:news", types)?.id).toBe("news");
    expect(matchType("News", types)?.id).toBe("news");
    expect(matchType("nonsense", types)).toBeNull();
  });
});

describe("discover advertises types that search accepts", () => {
  test("every advertised search type reaches Degoog and returns results", async () => {
    const ctx = makeCtx(server.url);
    const advertised = structured(await runDiscoverTool(ctx)).searchTypes as string[];

    expect(advertised).toEqual([
      "web",
      "images",
      "news",
      "videos",
      "file",
      "weeb",
      "recipes",
    ]);

    for (const type of advertised) {
      const result = await runSearchTool(ctx, { query: `bun ${type}`, type });
      const data = structured(result);

      expect(result.isError).toBeUndefined();
      expect(data.typeWarning).toBeUndefined();
      expect(data.type).toBe(type);
      expect((data.results as unknown[]).length).toBeGreaterThan(0);
    }
  });

  test("aliases are listed separately and still resolve through search", async () => {
    const ctx = makeCtx(server.url);
    const data = structured(await runDiscoverTool(ctx));
    const aliases = data.aliasesAccepted as string[];

    expect(aliases).toContain("engine:news");
    expect(aliases).toContain("engine-news");
    expect(data.searchTypes as string[]).not.toContain("engine-news");

    for (const alias of ["engine:news", "engine-news"]) {
      const result = structured(
        await runSearchTool(ctx, { query: "bun alias", type: alias }),
      );
      expect(result.typeWarning).toBeUndefined();
      expect(result.type).toBe("news");
    }
  });

  test("an engine- type with no canonical twin stays canonical", () => {
    const catalog = toTypeCatalog([
      { id: "engine:news", name: "News", icon: null },
      { id: "engine:engine-orphan", name: "Orphan", icon: null },
    ]);

    expect(catalog.types.map((entry) => entry.id)).toContain("engine-orphan");
    expect(catalog.aliases).not.toContain("engine-orphan");
  });

  test("discover no longer advertises the engine prefixed ids", async () => {
    const result = await runDiscoverTool(makeCtx(server.url));
    const advertised = structured(result).searchTypes as string[];

    expect(advertised.some((type) => type.startsWith("engine:"))).toBe(false);
    expect(visibleText(result)).toContain("Search types usable as search(type=...)");
    expect(visibleText(result)).toContain("news");
  });
});

describe("search type routing", () => {
  test("an engine backed type goes to the plain search endpoint", async () => {
    const ctx = makeCtx(server.url);
    const before = server.hits.length;

    await runSearchTool(ctx, { query: "kingdom hearts", type: "news" });

    expect(server.hits.slice(before)).toContain("GET /api/search?q=kingdom+hearts&type=news");
  });

  test("a legacy engine prefixed type is normalized instead of failing", async () => {
    const ctx = makeCtx(server.url);
    const before = server.hits.length;

    const data = structured(
      await runSearchTool(ctx, { query: "kingdom hearts 4", type: "engine:news" }),
    );

    expect(data.type).toBe("news");
    expect(data.typeWarning).toBeUndefined();
    expect(server.hits.slice(before).join(" ")).toContain("type=news");
    expect(server.hits.slice(before).join(" ")).not.toContain("engine%3Anews");
  });

  test("a plugin tab type goes to the tab search endpoint", async () => {
    const ctx = makeCtx(server.url);
    const before = server.hits.length;

    const data = structured(await runSearchTool(ctx, { query: "carbonara", type: "recipes" }));

    expect(data.typeKind).toBe(SearchTypeKind.Tab);
    expect(server.hits.slice(before).join(" ")).toContain("/api/tab-search?tab=recipes");
  });

  test("an unknown type still runs but says so instead of pretending", async () => {
    const ctx = makeCtx(server.url);

    const result = await runSearchTool(ctx, { query: "bun", type: "podcasts" });
    const data = structured(result);

    expect(result.isError).toBeUndefined();
    expect(data.type).toBe("podcasts");
    expect(data.typeWarning).toContain("not an advertised search type");
    expect(visibleText(result)).toContain("discover");
  });

  test("bundle_search normalizes the type the same way", async () => {
    const ctx = makeCtx(server.url);
    const before = server.hits.length;

    const data = structured(
      await runBundleTool(ctx, { query: "kingdom hearts 4", type: "engine:news" }),
    );

    expect(data.typeWarning).toBeUndefined();
    expect(server.hits.slice(before).join(" ")).toContain("type=news");
  });

  test("retry_engine normalizes the type before hitting Degoog", async () => {
    const ctx = makeCtx(server.url);
    const before = server.hits.length;

    await runRetryTool(ctx, {
      query: "kingdom hearts 4",
      engine: "Brave",
      type: "engine:news",
    });

    const retried = server.hits.slice(before).find((entry) => entry.includes("/api/search/retry"));
    expect(retried).toContain("type=news");
  });
});
