import { describe, expect, test } from "bun:test";
import { createCache } from "../src/cache/memory.ts";
import { DEFAULT_CONFIG } from "../src/config/defaults.ts";
import {
  noteScrapeFailure,
  recentScrapeFailure,
  RECENT_FAILURE,
} from "../src/scrape/failures.ts";

const cache = () => createCache(DEFAULT_CONFIG.cache);

describe("recent scrape failure awareness", () => {
  test("a 403 is remembered for the whole host", () => {
    const store = cache();
    noteScrapeFailure(store, "https://facilitiesdive.com/news/one", "HTTP 403");

    const note = recentScrapeFailure(store, "https://facilitiesdive.com/news/two");
    expect(note?.status).toBe(RECENT_FAILURE);
    expect(note?.reason).toBe("HTTP 403");
  });

  test("a 429 is also host wide", () => {
    const store = cache();
    noteScrapeFailure(store, "https://example.com/a", "HTTP 429");

    expect(recentScrapeFailure(store, "https://example.com/b")?.reason).toBe("HTTP 429");
  });

  test("a 404 stays scoped to the single url", () => {
    const store = cache();
    noteScrapeFailure(store, "https://example.com/gone", "HTTP 404");

    expect(recentScrapeFailure(store, "https://example.com/gone")?.reason).toBe("HTTP 404");
    expect(recentScrapeFailure(store, "https://example.com/other")).toBeNull();
  });

  test("a rendering failure stays scoped to the single url", () => {
    const store = cache();
    noteScrapeFailure(
      store,
      "https://getequiem.com/",
      "page needs browser rendering, this scraper is static fetch only",
    );

    expect(recentScrapeFailure(store, "https://getequiem.com/")).not.toBeNull();
    expect(recentScrapeFailure(store, "https://getequiem.com/blog/post")).toBeNull();
  });

  test("an unseen url reports nothing", () => {
    expect(recentScrapeFailure(cache(), "https://fresh.example/page")).toBeNull();
  });
});
