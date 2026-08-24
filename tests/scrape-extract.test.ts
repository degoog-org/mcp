import { describe, expect, test } from "bun:test";
import { chunkText, pickChunks, queryTerms, scoreChunks } from "../src/scrape/chunks.ts";
import { cleanText } from "../src/scrape/clean.ts";
import { extract } from "../src/scrape/extract.ts";
import { longText, pageHtml } from "./helpers.ts";

describe("extraction", () => {
  test("pulls title, canonical, date and site name from metadata", () => {
    const result = extract(pageHtml("Bun Test Runner", ["First paragraph about bun."]), "https://example.com/post");

    expect(result.title).toBe("Bun Test Runner");
    expect(result.canonical).toBe("https://example.com/canonical");
    expect(result.publishedAt).toBe("2026-01-15T10:00:00Z");
    expect(result.siteName).toBe("Example Site");
  });

  test("drops navigation, footer and script noise", () => {
    const html = `<html><body>
      <nav>Home About Contact</nav>
      <script>var tracker = 1;</script>
      <div class="cookie-banner">Accept all cookies</div>
      <article><h1>Real</h1><p>${longText("content", 4)}</p></article>
      <footer>Copyright notice</footer>
    </body></html>`;

    const result = extract(html, "https://example.com/x");
    expect(result.text).toContain("content sentence 0");
    expect(result.text).not.toContain("Home About Contact");
    expect(result.text).not.toContain("Copyright notice");
    expect(result.text).not.toContain("tracker");
  });

  test("keeps headings, lists and code as markdown", () => {
    const html = `<html><body><main>
      <h2>Install</h2>
      <ul><li>First step</li><li>Second step</li></ul>
      <pre>bun install</pre>
      <p>${longText("body", 6)}</p>
    </main></body></html>`;

    const result = extract(html, "https://example.com/x");
    expect(result.text).toContain("## Install");
    expect(result.text).toContain("- First step");
    expect(result.text).toContain("```");
    expect(result.text).toContain("bun install");
  });

  test("flags javascript app shells instead of pretending to succeed", () => {
    const html = `<html><body><div id="root"></div><script>window.__NEXT_DATA__={}</script></body></html>`;
    const result = extract(html, "https://spa.example/");

    expect(result.needsBrowser).toBe(true);
    expect(result.text.length).toBeLessThan(200);
  });

  test("does not flag a real page that happens to include scripts", () => {
    const html = `<html><body><div id="root"><article><p>${longText("real", 8)}</p></article></div><script>var a=1</script></body></html>`;
    expect(extract(html, "https://example.com/x").needsBrowser).toBe(false);
  });

  test("falls back to the hostname when there is no title", () => {
    expect(extract("<html><body><p>text</p></body></html>", "https://bare.example/x").title).toBe(
      "bare.example",
    );
  });

  test("prefers the article body over sidebar and latest-articles widgets", () => {
    const html = `<html><body><main>
      <div class="latest-articles"><h2>Latest</h2><ul>
        <li>${longText("roundup", 6)}</li><li>${longText("clickbait", 6)}</li>
      </ul></div>
      <article class="article-body"><h1>The real story</h1><p>${longText("story", 10)}</p></article>
      <div class="related-posts"><p>${longText("elsewhere", 6)}</p></div>
    </main></body></html>`;

    const result = extract(html, "https://news.example/story");

    expect(result.text).toContain("story sentence 0");
    expect(result.text).not.toContain("roundup sentence");
    expect(result.text).not.toContain("clickbait sentence");
    expect(result.text).not.toContain("elsewhere sentence");
  });

  test("a noise class on a wrapper never wipes the whole document", () => {
    const html = `<html class="feature-main-menu-pinned"><body>
      <main id="content"><p>${longText("survives", 12)}</p></main>
    </body></html>`;

    const result = extract(html, "https://wiki.example/page");

    expect(result.text).toContain("survives sentence 0");
    expect(result.needsBrowser).toBe(false);
  });

  test("keeps image labels inside tables, lists and text", () => {
    const html = `<html><body><main>
      <p>${longText("body", 8)}</p>
      <table><tr>
        <td><img src="octarine.png" alt="Octarine Core"></td>
        <td>20.7%</td>
        <td>51.1% wr</td>
      </tr></table>
      <ul><li><img src="hex.png" aria-label="Scythe of Vyse"> picked often</li></ul>
      <figure><img src="chart.png" title="Winrate chart"></figure>
    </main></body></html>`;

    const result = extract(html, "https://stats.example/hero");

    expect(result.text).toContain("| Octarine Core | 20.7% | 51.1% wr |");
    expect(result.text).toContain("Scythe of Vyse picked often");
    expect(result.text).toContain("Winrate chart");
  });

  test("drops image labels when hideImages is on", () => {
    const html = `<html><body><main>
      <p>${longText("body", 8)}</p>
      <table><tr>
        <td><img src="octarine.png" alt="Octarine Core"></td>
        <td>20.7%</td>
      </tr></table>
    </main></body></html>`;

    const result = extract(html, "https://stats.example/hero", {
      hideImages: true,
    });

    expect(result.text).not.toContain("Octarine Core");
    expect(result.text).toContain("| 20.7% |");
  });

  test("ignores decorative and unlabelled images", () => {
    const html = `<html><body><main>
      <p>${longText("body", 8)}</p>
      <table><tr>
        <td><img src="spacer.gif" alt=""></td>
        <td><img src="pixel.gif"></td>
        <td>20.7%</td>
      </tr></table>
    </main></body></html>`;

    const result = extract(html, "https://stats.example/hero");

    expect(result.text).toContain("| 20.7% |");
  });

  test("strips copy buttons and other interactive chrome", () => {
    const html = `<html><body><article>
      <p>${longText("readable", 8)}</p>
      <button class="copy">Copy</button>
      <div role="button">Share</div>
    </article></body></html>`;

    const result = extract(html, "https://example.com/x");

    expect(result.text).toContain("readable sentence 0");
    expect(result.text).not.toContain("Copy");
    expect(result.text).not.toContain("Share");
  });
});

describe("cleaning", () => {
  test("removes boilerplate lines and repeated blocks", () => {
    const cleaned = cleanText(
      ["Accept all cookies", "Skip to main content", "A real sentence that stays here.", "A real sentence that stays here.", "Another real sentence."].join("\n"),
    );

    expect(cleaned).not.toContain("cookies");
    expect(cleaned).not.toContain("Skip to");
    expect(cleaned.match(/A real sentence/g)).toHaveLength(1);
    expect(cleaned).toContain("Another real sentence.");
  });

  test("collapses runs of blank lines", () => {
    expect(cleanText("one\n\n\n\n\ntwo")).toBe("one\n\ntwo");
  });
});

describe("chunking", () => {
  const document = [
    "# Guide",
    "",
    "## Installing bun",
    "",
    longText("install", 20),
    "",
    "## Unrelated trivia",
    "",
    longText("trivia", 20),
  ].join("\n");

  test("splits on headings and keeps heading context", () => {
    const chunks = chunkText(document, 400);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.some((chunk) => chunk.heading === "Installing bun")).toBe(true);
  });

  test("drops fragments that are too small to be evidence", () => {
    expect(chunkText("tiny", 400)).toEqual([]);
  });

  test("scores chunks against the query", () => {
    const scored = scoreChunks(chunkText(document, 400), "installing bun");
    const best = [...scored].sort((a, b) => b.score - a.score)[0];

    expect(best?.heading).toBe("Installing bun");
  });

  test("uses document order when there is no query", () => {
    const scored = scoreChunks(chunkText(document, 400), "");
    expect(scored[0]?.score).toBeGreaterThan(scored[1]?.score ?? 0);
  });

  test("tokenises non latin scripts instead of dropping them", () => {
    expect(queryTerms("Привет мир")).toEqual(["привет", "мир"]);
    expect(queryTerms("Γειά σου κόσμε")).toEqual(["γειά", "σου", "κόσμε"]);
    expect(queryTerms("مرحبا بالعالم")).toEqual(["مرحبا", "بالعالم"]);
    expect(queryTerms("Überwachung der Daten")).toEqual([
      "überwachung",
      "der",
      "daten",
    ]);
    expect(queryTerms("人工知能")).toEqual(["人工知能"]);
  });

  test("keeps punctuation that belongs to a technology name", () => {
    expect(queryTerms("c++ c# .net")).toEqual(["c++", "c#", ".net"]);
  });

  test("no longer strips english stop words", () => {
    expect(queryTerms("how to use the bun test runner")).toEqual([
      "how",
      "to",
      "use",
      "the",
      "bun",
      "test",
      "runner",
    ]);
  });

  test("scores chunks for a non latin query instead of falling back to position", () => {
    const filler = (word: string, times: number) =>
      Array.from({ length: times }, (_, i) => `${word} предложение ${i}.`).join(" ");

    const cyrillic = [
      "# Введение",
      "",
      filler("общее", 20),
      "",
      "# Установка",
      "",
      filler("установка", 20),
    ].join("\n");

    const scored = scoreChunks(chunkText(cyrillic, 400), "установка пакета");
    const best = [...scored].sort((a, b) => b.score - a.score)[0];

    expect(best?.heading).toBe("Установка");
  });

  test("reports match as the share of query terms present, free of the position bonus", () => {
    const scored = scoreChunks(chunkText(document, 400), "installing bun");
    const best = [...scored].sort((a, b) => b.score - a.score)[0];
    const worst = [...scored].sort((a, b) => a.score - b.score)[0];

    expect(best?.match).toBeGreaterThan(worst?.match ?? 0);
    for (const chunk of scored) {
      expect(chunk.match).toBeGreaterThanOrEqual(0);
      expect(chunk.match).toBeLessThanOrEqual(100);
      expect(chunk.match % 1).toBe(0);
    }
  });

  test("match stays zero when there is no query to match against", () => {
    for (const chunk of scoreChunks(chunkText(document, 400), "")) {
      expect(chunk.match).toBe(0);
    }
  });

  test("pickChunks honours chunk and character caps and restores order", () => {
    const picked = pickChunks(document, "installing bun", 300, 2, 10_000);

    expect(picked.chunks).toHaveLength(2);
    expect(picked.omitted).toBeGreaterThan(0);
    expect(picked.chunks[0]!.index).toBeLessThan(picked.chunks[1]!.index);
  });

  test("character budget wins over the chunk count", () => {
    const picked = pickChunks(document, "installing bun", 300, 5, 350);
    const used = picked.chunks.reduce((total, chunk) => total + chunk.text.length, 0);

    expect(picked.chunks.length).toBeGreaterThan(0);
    expect(used).toBeLessThanOrEqual(400);
  });
});
