import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG } from "../src/config/defaults.ts";
import { ScrapeRenderer, type FetcherConfig } from "../src/config/schema.ts";
import { fetchVia, FetcherError, rendererOf } from "../src/scrape/fetcher.ts";
import { scrapeUrls } from "../src/scrape/pipeline.ts";
import { scrapeAbout } from "../src/tools/scrape.ts";
import { pageHtml, serveFake } from "./helpers.ts";

const OPTIONS = {
  timeoutMs: 5000,
  maxResponseBytes: 1_000_000,
  allowPrivateIps: true,
};

const fetcherOf = (overrides: Partial<FetcherConfig>): FetcherConfig => ({
  ...DEFAULT_CONFIG.scrape.fetcher,
  ...overrides,
});

const TARGET = "https://example.com/article?a=1&b=two";
const HTML = pageHtml("Delegated", ["Bun is a fast javascript runtime.", "It bundles too."]);

describe("delegated fetcher", () => {
  test("passes the target on a query string and takes the body as html", async () => {
    const server = serveFake(() => new Response(HTML, { headers: { "Content-Type": "text/html" } }));

    const outcome = await fetchVia(
      TARGET,
      fetcherOf({ url: `${server.url}/get?url={{url}}` }),
      OPTIONS,
    );

    expect(outcome.ok).toBe(true);
    expect(outcome.html).toContain("Delegated");
    expect(outcome.url).toBe(TARGET);
    expect(server.hits[0]).toBe(`GET /get?url=${encodeURIComponent(TARGET)}`);

    await server.stop();
  });

  test("posts a json envelope and digs the html out of a dot path", async () => {
    const server = serveFake(() =>
      Response.json({ solution: { response: HTML, status: 200 } }),
    );

    const outcome = await fetchVia(
      TARGET,
      fetcherOf({
        url: `${server.url}/v1`,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"cmd":"get","url":"{{url}}","maxTimeout":{{timeout}}}',
        html: "solution.response",
      }),
      OPTIONS,
    );

    expect(outcome.ok).toBe(true);
    expect(outcome.html).toContain("Delegated");
    expect(server.bodies[0]).toEqual({ cmd: "get", url: TARGET, maxTimeout: 5000 });

    await server.stop();
  });

  test("json escapes a target carrying quotes so the envelope survives", async () => {
    const server = serveFake(() => Response.json({ page: { body: HTML } }));
    const nasty = 'https://example.com/a"b\\c';

    const outcome = await fetchVia(
      nasty,
      fetcherOf({
        url: `${server.url}/v1`,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"url":"{{url}}"}',
        html: "page.body",
      }),
      { ...OPTIONS, allowPrivateIps: true },
    );

    expect(outcome.ok).toBe(true);
    expect(server.bodies[0]).toEqual({ url: nasty });

    await server.stop();
  });

  test("reports a missing html path instead of scraping an empty string", async () => {
    const server = serveFake(() => Response.json({ solution: {} }));

    const outcome = await fetchVia(
      TARGET,
      fetcherOf({ url: `${server.url}/v1`, html: "solution.response" }),
      OPTIONS,
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBe(FetcherError.NoHtml);

    await server.stop();
  });

  test("reports a non json reply when a dot path was configured", async () => {
    const server = serveFake(() => new Response("<html>nope</html>"));

    const outcome = await fetchVia(
      TARGET,
      fetcherOf({ url: `${server.url}/v1`, html: "solution.response" }),
      OPTIONS,
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBe(FetcherError.BadJson);

    await server.stop();
  });

  test("surfaces the fetcher own http status when it refuses", async () => {
    const server = serveFake(() => new Response("busy", { status: 503 }));

    const outcome = await fetchVia(TARGET, fetcherOf({ url: `${server.url}/v1` }), OPTIONS);

    expect(outcome.ok).toBe(false);
    expect(outcome.status).toBe(503);
    expect(outcome.error).toContain("503");

    await server.stop();
  });

  test("still guards the target against private addresses", async () => {
    const server = serveFake(() => new Response(HTML));

    const outcome = await fetchVia(
      "http://127.0.0.1:9/secret",
      fetcherOf({ url: `${server.url}/get?url={{url}}` }),
      { ...OPTIONS, allowPrivateIps: false },
    );

    expect(outcome.ok).toBe(false);
    expect(server.hits.length).toBe(0);

    await server.stop();
  });

  test("caps the bytes it reads back from the fetcher", async () => {
    const server = serveFake(() => new Response("x".repeat(50_000)));

    const outcome = await fetchVia(TARGET, fetcherOf({ url: `${server.url}/get` }), {
      ...OPTIONS,
      maxResponseBytes: 1000,
    });

    expect(outcome.truncated).toBe(true);
    expect(outcome.html.length).toBeLessThanOrEqual(1000);

    await server.stop();
  });
});

describe("pipeline with a fetcher configured", () => {
  test("scrapes through the fetcher and reports the delegated renderer", async () => {
    const server = serveFake(() => Response.json({ page: HTML }));
    const config = {
      ...DEFAULT_CONFIG.scrape,
      allowPrivateIps: true,
      fetcher: fetcherOf({ url: `${server.url}/v1`, html: "page" }),
    };

    const rows = await scrapeUrls([TARGET], { query: "javascript runtime", config });

    expect(rows[0]?.ok).toBe(true);
    expect(rows[0]?.title).toBe("Delegated");
    expect(rendererOf(config)).toBe(ScrapeRenderer.Delegated);

    await server.stop();
  });

  test("falls back to static fetch when no fetcher url is set", () => {
    expect(rendererOf(DEFAULT_CONFIG.scrape)).toBe(ScrapeRenderer.Static);
  });
});

describe("scrape tool description", () => {
  test("warns about static fetch when no fetcher is configured", () => {
    const about = scrapeAbout(DEFAULT_CONFIG.scrape);

    expect(about).toContain("Static fetch only");
    expect(about).toContain("One row per URL");
  });

  test("says nothing about rendering once a fetcher url is set", () => {
    const about = scrapeAbout({
      ...DEFAULT_CONFIG.scrape,
      fetcher: fetcherOf({ url: "http://renderer:8080/content" }),
    });

    expect(about).not.toContain("Static fetch only");
    expect(about).not.toContain("JavaScript");
    expect(about).not.toContain("render");
    expect(about).toContain("One row per URL");
  });
});
