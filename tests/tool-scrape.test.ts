import { afterAll, describe, expect, test } from "bun:test";
import { OutputMode } from "../src/config/schema.ts";
import { BROWSER_HINT } from "../src/scrape/pipeline.ts";
import { runScrapeTool } from "../src/tools/scrape.ts";
import { longText, makeCtx, pageHtml, serveFake, structured, visibleText } from "./helpers.ts";

interface Row {
  id: string;
  url: string;
  ok: boolean;
  title?: string;
  chunks: Array<{ heading?: string; text: string }>;
  error?: string;
}

const html = (title: string) =>
  pageHtml(title, [longText("install", 12), longText("configure", 12), longText("deploy", 12)]);

const pages = serveFake((_request, url) => {
  if (url.pathname === "/good") {
    return new Response(html("Good page"), {
      headers: { "content-type": "text/html" },
    });
  }
  if (url.pathname === "/spa") {
    return new Response(
      `<html><head><title>App</title></head><body><div id="root"></div><script>window.__NEXT_DATA__={}</script></body></html>`,
      { headers: { "content-type": "text/html" } },
    );
  }
  if (url.pathname === "/binary") {
    return new Response("payload", { headers: { "content-type": "image/png" } });
  }
  return new Response("missing", { status: 404 });
});

const rowsOf = (result: { structuredContent?: Record<string, unknown> }): Row[] =>
  structured(result).sources as Row[];

afterAll(async () => {
  await pages.stop();
});

describe("scrape tool", () => {
  test("returns one row per requested url, failures included", async () => {
    const ctx = makeCtx(pages.url);
    const urls = [`${pages.url}/good`, `${pages.url}/missing`, `${pages.url}/spa`];

    const result = await runScrapeTool(ctx, { urls });
    const data = structured(result);
    const rows = rowsOf(result);

    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.url)).toEqual(urls);
    expect(rows.map((row) => row.id)).toEqual(["S1", "S2", "S3"]);
    expect(data.counts).toEqual({ useful: 1, failed: 2 });
    expect(visibleText(result)).toContain("Scraped 3 URLs: 1 useful, 2 failed.");
  });

  test("a javascript shell fails loudly instead of pretending", async () => {
    const ctx = makeCtx(pages.url);

    const rows = rowsOf(await runScrapeTool(ctx, { urls: [`${pages.url}/spa`] }));

    expect(rows[0]?.ok).toBe(false);
    expect(rows[0]?.error).toBe(BROWSER_HINT);
    expect(rows[0]?.error).toContain("static fetch only");
    expect(rows[0]?.chunks).toHaveLength(0);
  });

  test("non textual responses fail with a reason", async () => {
    const ctx = makeCtx(pages.url);

    const rows = rowsOf(await runScrapeTool(ctx, { urls: [`${pages.url}/binary`] }));

    expect(rows[0]?.ok).toBe(false);
    expect(rows[0]?.error).toBeTruthy();
  });

  test("rejects urls that are not http(s)", async () => {
    const ctx = makeCtx(pages.url);

    const rows = rowsOf(
      await runScrapeTool(ctx, { urls: ["file:///etc/passwd", "not a url"] }),
    );

    expect(rows).toHaveLength(2);
    expect(rows.every((row) => !row.ok)).toBe(true);
  });

  test("caps the url list and reports the skipped ones", async () => {
    const ctx = makeCtx(pages.url, { scrape: { maxUrls: 2 } });
    const urls = [
      `${pages.url}/good`,
      `${pages.url}/good?a=1`,
      `${pages.url}/good?a=2`,
      `${pages.url}/good?a=3`,
    ];

    const data = structured(await runScrapeTool(ctx, { urls }));

    expect(data.requested).toBe(4);
    expect(data.scraped).toBe(2);
    expect(data.skipped).toBe(2);
  });

  test("honours the per url chunk cap", async () => {
    const ctx = makeCtx(pages.url);

    const rows = rowsOf(
      await runScrapeTool(ctx, {
        urls: [`${pages.url}/good`],
        query: "configure",
        maxChunks: 1,
      }),
    );

    expect(rows[0]?.ok).toBe(true);
    expect(rows[0]?.chunks).toHaveLength(1);
    expect(rows[0]?.chunks[0]?.text).toContain("configure");
  });

  test("honours the per url character budget", async () => {
    const ctx = makeCtx(pages.url);

    const rows = rowsOf(
      await runScrapeTool(ctx, { urls: [`${pages.url}/good`], maxChars: 400 }),
    );
    const chars = rows[0]?.chunks.reduce((total, chunk) => total + chunk.text.length, 0) ?? 0;

    expect(chars).toBeLessThanOrEqual(800);
  });

  test("keeps page metadata on successful rows", async () => {
    const ctx = makeCtx(pages.url);

    const rows = rowsOf(await runScrapeTool(ctx, { urls: [`${pages.url}/good`] }));

    expect(rows[0]?.title).toBe("Good page");
  });

  test("redirect detail only appears outside compact mode", async () => {
    const compact = structured(
      await runScrapeTool(makeCtx(pages.url), { urls: [`${pages.url}/good`] }),
    );
    const balanced = structured(
      await runScrapeTool(
        makeCtx(pages.url, { output: { mode: OutputMode.Balanced } }),
        { urls: [`${pages.url}/good`] },
      ),
    );

    expect(compact.redirects).toBeUndefined();
    expect(balanced.redirects).toBeDefined();
  });

  test("an empty url list is an input error", async () => {
    const result = await runScrapeTool(makeCtx(pages.url), { urls: ["   "] });
    const error = structured(result).error as Record<string, string>;

    expect(result.isError).toBe(true);
    expect(error.kind).toBe("input");
  });

  test("reports the renderer so clients know javascript is not executed", async () => {
    const data = structured(
      await runScrapeTool(makeCtx(pages.url), { urls: [`${pages.url}/good`] }),
    );

    expect(data.renderer).toBe("static");
  });
});
