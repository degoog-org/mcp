import { describe, expect, test } from "bun:test";
import { capChars, capList } from "../src/search/caps.ts";
import { spreadDomains } from "../src/search/cluster.ts";
import { dedupe, dupeCount } from "../src/search/dedupe.ts";
import { normalize, toNormal } from "../src/search/normalize.ts";
import { pickScrapable, runPipeline } from "../src/search/pipeline.ts";
import { shapeResults } from "../src/search/shape.ts";
import { trimSnippet } from "../src/search/snippets.ts";
import { domainSpread, engineSpread, overlapRows } from "../src/search/source-overlap.ts";
import { canonicalUrl, domainOf, isHttpUrl, rootDomain } from "../src/utils/urls.ts";
import { fakeResult, fakeSearch } from "./helpers.ts";

const shapeOf = (results: Parameters<typeof normalize>[0], query: string) =>
  shapeResults(normalize(results, query));

describe("url canonicalization", () => {
  test("strips tracking, fragments, www, default ports and trailing slash", () => {
    expect(
      canonicalUrl("https://www.Example.com:443/docs/?utm_source=x&b=2&a=1#frag/"),
    ).toBe("https://example.com/docs?a=1&b=2");
  });

  test("rejects non http protocols", () => {
    expect(isHttpUrl("ftp://example.com")).toBeNull();
    expect(isHttpUrl("javascript:alert(1)")).toBeNull();
    expect(isHttpUrl("https://example.com")).not.toBeNull();
  });

  test("derives domain and root domain", () => {
    expect(domainOf("https://docs.example.co/page")).toBe("docs.example.co");
    expect(rootDomain("https://docs.example.co/page")).toBe("example.co");
  });
});

describe("normalize", () => {
  test("drops results whose url is not http(s)", () => {
    expect(toNormal(fakeResult({ url: "mailto:a@b.c" }), "q")).toBeNull();
    expect(normalize([fakeResult({ url: "https://ok.example/a" })], "q")).toHaveLength(1);
  });

  test("keeps engine names and falls back to content when snippet is empty", () => {
    const normal = toNormal(
      { ...fakeResult({ url: "https://a.example/x" }), snippet: "", content: "from content", sources: ["Brave", "DDG"] },
      "q",
    );

    expect(normal?.snippet).toBe("from content");
    expect(normal?.engines).toEqual(["Brave", "DDG"]);
  });

  test("strips html tags and decodes entities in titles", () => {
    const normal = toNormal(
      fakeResult({
        url: "https://square-enix-games.com/press/kh4",
        title: "<span style=\"font-size:11pt\">SQUARE ENIX Announces</span>",
      }),
      "kingdom hearts",
    );

    expect(normal?.title).toBe("SQUARE ENIX Announces");
  });

  test("decodes entities and collapses whitespace in titles", () => {
    const normal = toNormal(
      fakeResult({ url: "https://a.example/x", title: "Tom &amp; Jerry\n  the   show" }),
      "q",
    );

    expect(normal?.title).toBe("Tom & Jerry the show");
  });

  test("falls back to the domain when a title is empty", () => {
    const normal = toNormal(fakeResult({ url: "https://a.example/x", title: "" }), "q");
    expect(normal?.title).toBe("a.example");
  });

  test("strips markup from snippets too", () => {
    const normal = toNormal(
      { ...fakeResult({ url: "https://a.example/x" }), snippet: "<b>bold</b> &amp; clean" },
      "q",
    );

    expect(normal?.snippet).toBe("bold & clean");
  });
});

describe("dedupe", () => {
  test("merges equivalent urls and unions their engines", () => {
    const results = normalize(
      [
        { ...fakeResult({ url: "https://example.com/a?utm_source=x" }), sources: ["Brave"], title: "Short" },
        { ...fakeResult({ url: "https://www.example.com/a/" }), sources: ["DuckDuckGo"], title: "A longer title" },
      ],
      "example",
    );

    const merged = dedupe(results);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.engines.sort()).toEqual(["Brave", "DuckDuckGo"]);
    expect(merged[0]?.title).toBe("A longer title");
    expect(dupeCount(results, merged)).toBe(1);
  });
});

describe("result shaping preserves Degoog order", () => {
  test("exposes the Degoog score as degoogScore", () => {
    const [shaped] = shapeOf(
      [{ ...fakeResult({ url: "https://a.example/x" }), score: 42 }],
      "topic",
    );

    expect(shaped?.degoogScore).toBe(42);
  });

  test("exposes engine agreement as a reason without reordering", () => {
    const shaped = shapeOf(
      [
        { ...fakeResult({ url: "https://solo.example/a" }), sources: ["Brave"] },
        {
          ...fakeResult({ url: "https://agreed.example/b" }),
          sources: ["Brave", "DuckDuckGo", "Mojeek"],
        },
      ],
      "topic",
    );

    expect(shaped[0]?.domain).toBe("solo.example");
    expect(shaped[1]?.domain).toBe("agreed.example");
    expect(shaped[1]?.reasons).toContain("3 engines agree");
  });

  test("does not promote press pages above Degoog order", () => {
    const shaped = shapeOf(
      [
        fakeResult({ url: "https://gamesradar.com/kingdom-hearts-4-everything" }),
        fakeResult({ url: "https://square-enix-games.com/press/kingdom-hearts-4" }),
      ],
      "kingdom hearts 4 info",
    );

    expect(shaped[0]?.domain).toBe("gamesradar.com");
    expect(shaped[1]?.domain).toBe("square-enix-games.com");
  });

  test("does not demote a syndicator below Degoog order", () => {
    const shaped = shapeOf(
      [
        fakeResult({ url: "https://www.msn.com/en-gb/news/kingdom-hearts-4-press-release" }),
        fakeResult({ url: "https://eurogamer.net/kingdom-hearts-4" }),
      ],
      "kingdom hearts 4",
    );

    expect(shaped[0]?.domain).toBe("msn.com");
  });

  test("emits no scoring fields beyond the Degoog score", () => {
    const [shaped] = shapeOf([fakeResult({ url: "https://a.example/x" })], "topic");

    expect(shaped).not.toHaveProperty("official");
    expect(shaped).not.toHaveProperty("primary");
    expect(shaped).not.toHaveProperty("rank");
    expect(shaped).not.toHaveProperty("score");
  });

  test("preserves input order exactly", () => {
    const input = normalize(
      [fakeResult({ url: "https://b.example/x" }), fakeResult({ url: "https://a.example/x" })],
      "topic",
    );

    expect(shapeResults(input).map((entry) => entry.url)).toEqual([
      "https://b.example/x",
      "https://a.example/x",
    ]);
    expect(shapeResults([...input].reverse()).map((entry) => entry.url)).toEqual([
      "https://a.example/x",
      "https://b.example/x",
    ]);
  });
});

describe("domain spread and caps", () => {
  test("spreadDomains limits results per root domain", () => {
    const shaped = shapeOf(
      [
        fakeResult({ url: "https://blog.example.com/1" }),
        fakeResult({ url: "https://blog.example.com/2" }),
        fakeResult({ url: "https://blog.example.com/3" }),
        fakeResult({ url: "https://other.org/1" }),
      ],
      "topic",
    );

    expect(spreadDomains(shaped, 2)).toHaveLength(3);
  });

  test("capList reports omitted counts", () => {
    expect(capList([1, 2, 3, 4], 2)).toEqual({ items: [1, 2], omitted: 2 });
    expect(capList([1], 5)).toEqual({ items: [1], omitted: 0 });
  });

  test("capChars and trimSnippet keep budgets", () => {
    expect(capChars("abcdefghij", 5)).toHaveLength(5);
    const trimmed = trimSnippet("2 days ago - " + "word ".repeat(80), 60);
    expect(trimmed.length).toBeLessThanOrEqual(60);
    expect(trimmed.startsWith("word")).toBe(true);
  });
});

describe("source overlap", () => {
  test("summarises engines, domains and agreement", () => {
    const results = normalize(
      [
        { ...fakeResult({ url: "https://a.example/1" }), sources: ["Brave", "DDG"] },
        { ...fakeResult({ url: "https://b.example/1" }), sources: ["Brave"] },
      ],
      "topic",
    );

    expect(domainSpread(results)).toBe(2);
    expect(engineSpread(results)).toBe(2);
    expect(overlapRows(results)).toHaveLength(1);
  });
});

describe("pipeline", () => {
  test("dedupes across queries, caps results and reports omissions", () => {
    const output = runPipeline({
      responses: [
        {
          query: "bun test",
          response: fakeSearch([
            fakeResult({ url: "https://one.example/a" }),
            fakeResult({ url: "https://two.example/b" }),
          ]),
        },
        {
          query: "bun test runner",
          response: fakeSearch([
            fakeResult({ url: "https://one.example/a?utm_source=x" }),
            fakeResult({ url: "https://three.example/c" }),
          ]),
        },
      ],
      rankQuery: "bun test",
      maxResults: 2,
      snippetChars: 50,
    });

    expect(output.results).toHaveLength(2);
    expect(output.merged).toBe(1);
    expect(output.omitted).toBe(1);
    expect(output.related).toEqual(["related one", "related two"]);
    expect(output.results.every((row) => row.snippet.length <= 50)).toBe(true);
  });

  test("pickScrapable takes one url per domain", () => {
    const shaped = shapeOf(
      [
        fakeResult({ url: "https://a.example/1" }),
        fakeResult({ url: "https://a.example/2" }),
        fakeResult({ url: "https://b.example/1" }),
      ],
      "topic",
    );

    const picked = pickScrapable(shaped, 3);
    expect(picked).toHaveLength(2);
    expect(new Set(picked.map((entry) => entry.domain)).size).toBe(2);
  });

  test("pickScrapable keeps Degoog order", () => {
    const shaped = shapeOf(
      [
        {
          ...fakeResult({ url: "https://www.msn.com/en-gb/kingdom-hearts-4" }),
          sources: ["Brave", "DuckDuckGo", "Mojeek"],
        },
        { ...fakeResult({ url: "https://eurogamer.net/kingdom-hearts-4" }), sources: ["Brave"] },
      ],
      "kingdom hearts 4",
    );

    expect(pickScrapable(shaped, 2)[0]?.domain).toBe("msn.com");
  });
});
