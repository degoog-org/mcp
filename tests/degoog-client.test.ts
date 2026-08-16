import { afterEach, describe, expect, test } from "bun:test";
import { createCache } from "../src/cache/memory.ts";
import { DEFAULT_CONFIG } from "../src/config/defaults.ts";
import { EnvVar } from "../src/config/env.ts";
import { createClient, DegoogError } from "../src/degoog/client.ts";
import { runSearch, searchBody, searchParams } from "../src/degoog/search.ts";
import { retryEngine } from "../src/degoog/retry.ts";
import { getSuggests } from "../src/degoog/suggest.ts";
import { listCommands } from "../src/degoog/command.ts";
import { getCapability } from "../src/degoog/discover.ts";
import { parseSse, readEvents, streamSearch } from "../src/degoog/stream.ts";
import { DegoogRoute } from "../src/degoog/types.ts";
import { fakeSearch, fakeResult, mergeConfig, serveFake } from "./helpers.ts";

const clientFor = (url: string) =>
  createClient(mergeConfig({ degoog: { url } }).degoog);

afterEach(() => {
  delete process.env[EnvVar.DegoogApiKey];
});

describe("request shaping", () => {
  test("drops undefined and empty query parameters", () => {
    const params = searchParams({ query: "bun", type: "web", lang: "" });
    const client = clientFor("http://degoog:4444");
    const url = client.buildUrl(DegoogRoute.Search, params);

    expect(url).toContain("q=bun");
    expect(url).toContain("type=web");
    expect(url).not.toContain("lang=");
    expect(url).not.toContain("page=");
  });

  test("body keeps engines and drops undefined keys", () => {
    const body = searchBody({ query: "bun", engines: ["brave-engine"] });
    expect(body).toEqual({ query: "bun", engines: ["brave-engine"] });
  });

  test("base url trailing slashes are normalized", () => {
    const client = clientFor("http://degoog:4444//");
    expect(client.buildUrl("/api/search")).toBe("http://degoog:4444/api/search");
  });
});

describe("search calls", () => {
  test("uses GET without engines and POST with engines", async () => {
    const server = serveFake(() => Response.json(fakeSearch([])));
    const client = clientFor(server.url);

    await runSearch(client, { query: "bun test", type: "web", page: 2 });
    await runSearch(client, { query: "bun test", engines: ["brave-engine"] });

    expect(server.hits[0]).toBe("GET /api/search?q=bun+test&type=web&page=2");
    expect(server.hits[1]).toBe("POST /api/search");
    expect(server.bodies[0]).toEqual({
      query: "bun test",
      engines: ["brave-engine"],
    });

    await server.stop();
  });

  test("retry adds the engine to query and body forms", async () => {
    const server = serveFake(() => Response.json(fakeSearch([])));
    const client = clientFor(server.url);

    await retryEngine(client, { query: "bun", engine: "Brave" });
    await retryEngine(client, {
      query: "bun",
      engine: "Brave",
      engines: ["brave-engine"],
    });

    expect(server.hits[0]).toBe("GET /api/search/retry?q=bun&engine=Brave");
    expect(server.bodies[0]).toEqual({
      query: "bun",
      engine: "Brave",
      engines: ["brave-engine"],
    });

    await server.stop();
  });
});

describe("authentication", () => {
  test("sends a bearer token only when the env secret is set", async () => {
    const server = serveFake(() => Response.json(fakeSearch([])));

    await runSearch(clientFor(server.url), { query: "no key" });
    expect(server.authHeaders[0]).toBeNull();

    process.env[EnvVar.DegoogApiKey] = "s3cr3t-key";
    const authed = clientFor(server.url);
    expect(authed.hasApiKey).toBe(true);

    await runSearch(authed, { query: "with key" });
    expect(server.authHeaders[1]).toBe("Bearer s3cr3t-key");

    await server.stop();
  });

  test("surfaces a 401 as an auth-flavoured DegoogError", async () => {
    const server = serveFake(() =>
      Response.json({ error: "You shall not pass!" }, { status: 401 }),
    );

    const promise = runSearch(clientFor(server.url), { query: "denied" });
    await expect(promise).rejects.toBeInstanceOf(DegoogError);
    await expect(promise).rejects.toThrow("authentication rejected");

    await server.stop();
  });

  test("invalid JSON becomes a clear upstream error", async () => {
    const server = serveFake(
      () => new Response("not json", { headers: { "content-type": "application/json" } }),
    );

    await expect(
      runSearch(clientFor(server.url), { query: "broken" }),
    ).rejects.toThrow("invalid JSON");

    await server.stop();
  });
});

describe("suggest, commands and discovery", () => {
  test("normalizes suggestion shapes and tolerates failure", async () => {
    const server = serveFake((_request, url) =>
      url.pathname === DegoogRoute.Suggest
        ? Response.json([{ text: "bun test", source: "Google" }, "plain string", 42])
        : Response.json({ error: "nope" }, { status: 500 }),
    );
    const client = clientFor(server.url);

    expect(await getSuggests(client, "bun")).toEqual([
      { text: "bun test", source: "Google" },
      { text: "plain string", source: undefined },
    ]);
    expect(await getSuggests(client, "   ")).toEqual([]);

    await server.stop();
  });

  test("commands accept both array and wrapped payloads", async () => {
    const wrapped = serveFake(() =>
      Response.json({ commands: [{ trigger: "!uuid", category: "tools" }] }),
    );
    expect(await listCommands(clientFor(wrapped.url))).toEqual([
      { trigger: "!uuid", aliases: undefined, description: undefined, category: "tools" },
    ]);
    await wrapped.stop();

    const bare = serveFake(() => Response.json([{ trigger: "!w" }]));
    expect((await listCommands(clientFor(bare.url)))[0]?.trigger).toBe("!w");
    await bare.stop();
  });

  test("discovery reports problems instead of throwing", async () => {
    const server = serveFake((_request, url) => {
      if (url.pathname === DegoogRoute.SearchTabs) {
        return Response.json({ tabs: [{ id: "images", name: "Images", icon: null }] });
      }
      if (url.pathname === DegoogRoute.Extensions) {
        return url.searchParams.get("type") === "engine"
          ? Response.json({ engines: [{ id: "brave-engine", name: "Brave", enabled: true }] })
          : Response.json({ autocomplete: [] });
      }
      return Response.json({ error: "boom" }, { status: 500 });
    });

    const capabilities = await getCapability(
      clientFor(server.url),
      createCache(DEFAULT_CONFIG.cache),
    );
    expect(capabilities.searchTypes.map((entry) => entry.id)).toEqual(["web", "images"]);
    expect(capabilities.engines[0]?.id).toBe("brave-engine");
    expect(capabilities.autocomplete).toEqual([]);
    expect(capabilities.problems).toContain("commands unavailable");
    expect(capabilities.reachable).toBe(true);

    await server.stop();
  });
});

describe("stream parsing", () => {
  test("parses named events and ignores comments", () => {
    const events = parseSse(
      ': keep-alive\n\nevent: engine-result\ndata: {"engine":"Brave"}\n\nevent: done\ndata: {"totalTime":42}\n\n',
    );

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ event: "engine-result", data: { engine: "Brave" } });
    expect(events[1]).toEqual({ event: "done", data: { totalTime: 42 } });
  });

  test("skips payloads that are not valid JSON", () => {
    expect(parseSse("event: done\ndata: {oops\n\n")).toEqual([]);
  });

  test("reassembles events split across chunks", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode('event: done\ndata: {"tot'));
        controller.enqueue(encoder.encode('alTime":7}\n\n'));
        controller.close();
      },
    });

    const seen = [];
    for await (const event of readEvents(stream)) seen.push(event);

    expect(seen).toEqual([{ event: "done", data: { totalTime: 7 } }]);
  });

  test("streamSearch keeps the last merged result list and done metadata", async () => {
    const server = serveFake(
      () =>
        new Response(
          [
            `event: engine-result\ndata: ${JSON.stringify({
              engine: "Brave",
              timing: { name: "Brave", time: 10, resultCount: 1 },
              results: [fakeResult({ url: "https://one.example/a" })],
            })}\n\n`,
            `event: engine-result\ndata: ${JSON.stringify({
              engine: "DuckDuckGo",
              timing: { name: "DuckDuckGo", time: 20, resultCount: 2 },
              results: [
                fakeResult({ url: "https://one.example/a" }),
                fakeResult({ url: "https://two.example/b" }),
              ],
            })}\n\n`,
            `event: done\ndata: ${JSON.stringify({
              totalTime: 99,
              engineTimings: [{ name: "Brave", time: 10, resultCount: 1 }],
              relatedSearches: ["more bun"],
            })}\n\n`,
          ].join(""),
          { headers: { "content-type": "text/event-stream" } },
        ),
    );

    const response = await streamSearch(clientFor(server.url), { query: "bun" });
    expect(response.results).toHaveLength(2);
    expect(response.totalTime).toBe(99);
    expect(response.relatedSearches).toEqual(["more bun"]);

    await server.stop();
  });
});
