import { describe, expect, test } from "bun:test";
import { CacheNamespace, cacheKey } from "../src/cache/keys.ts";
import { createCache } from "../src/cache/memory.ts";
import { DEFAULT_CONFIG } from "../src/config/defaults.ts";
import type { CacheConfig } from "../src/config/schema.ts";

const cacheConfig = (overrides: Partial<CacheConfig> = {}): CacheConfig => ({
  ...DEFAULT_CONFIG.cache,
  ...overrides,
});

const fakeClock = (start = 1_000) => {
  let now = start;
  return {
    read: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
};

describe("cache keys", () => {
  test("key order does not change the key", () => {
    const first = cacheKey(CacheNamespace.Search, { a: 1, b: "two", c: [1, 2] });
    const second = cacheKey(CacheNamespace.Search, { c: [1, 2], b: "two", a: 1 });

    expect(first).toBe(second);
  });

  test("namespaces keep otherwise identical keys apart", () => {
    const search = cacheKey(CacheNamespace.Search, { query: "bun" });
    const suggest = cacheKey(CacheNamespace.Suggest, { query: "bun" });

    expect(search).not.toBe(suggest);
  });

  test("every part changes the key", () => {
    const base = cacheKey(CacheNamespace.Search, { query: "bun", page: 1 });

    expect(base).not.toBe(cacheKey(CacheNamespace.Search, { query: "bun", page: 2 }));
    expect(base).not.toBe(cacheKey(CacheNamespace.Search, { query: "deno", page: 1 }));
  });
});

describe("ttl", () => {
  test("entries expire once the ttl has passed", () => {
    const clock = fakeClock();
    const cache = createCache(cacheConfig({ ttlMs: 1000 }), clock.read);

    cache.set("k", { hello: "world" });
    expect(cache.get<Record<string, string>>("k")).toEqual({ hello: "world" });

    clock.advance(1000);
    expect(cache.get("k")).toBeNull();
    expect(cache.stats().evictions).toBe(1);
  });

  test("a per-entry ttl beats the configured one", () => {
    const clock = fakeClock();
    const cache = createCache(cacheConfig({ ttlMs: 60_000 }), clock.read);

    cache.set("short", "value", 100);
    clock.advance(200);

    expect(cache.get("short")).toBeNull();
  });

  test("expired entries are swept when something else is written", () => {
    const clock = fakeClock();
    const cache = createCache(cacheConfig({ ttlMs: 500 }), clock.read);

    cache.set("old", "value");
    clock.advance(600);
    cache.set("new", "value");

    expect(cache.stats().entries).toBe(1);
  });
});

describe("bounds", () => {
  test("evicts the least recently used entry over the entry cap", () => {
    const cache = createCache(cacheConfig({ maxEntries: 2 }));

    cache.set("a", "one");
    cache.set("b", "two");
    cache.get("a");
    cache.set("c", "three");

    expect(cache.get("b")).toBeNull();
    expect(cache.get<string>("a")).toBe("one");
    expect(cache.stats().entries).toBe(2);
  });

  test("evicts until the byte budget fits", () => {
    const cache = createCache(cacheConfig({ maxBytes: 60, maxEntries: 100 }));

    cache.set("a", "x".repeat(30));
    cache.set("b", "y".repeat(30));

    const stats = cache.stats();
    expect(stats.bytes).toBeLessThanOrEqual(60);
    expect(stats.entries).toBeLessThan(2);
    expect(stats.evictions).toBeGreaterThan(0);
  });

  test("a value larger than the whole budget is never stored", () => {
    const cache = createCache(cacheConfig({ maxBytes: 50 }));

    cache.set("huge", "x".repeat(500));

    expect(cache.get("huge")).toBeNull();
    expect(cache.stats().entries).toBe(0);
  });

  test("overwriting a key does not double count its bytes", () => {
    const cache = createCache(cacheConfig());

    cache.set("k", "x".repeat(100));
    const first = cache.stats().bytes;
    cache.set("k", "x".repeat(100));

    expect(cache.stats().bytes).toBe(first);
    expect(cache.stats().entries).toBe(1);
  });
});

describe("switches and stats", () => {
  test("a disabled cache stores nothing", () => {
    const cache = createCache(cacheConfig({ enabled: false }));

    cache.set("k", "value");

    expect(cache.get("k")).toBeNull();
    expect(cache.stats().entries).toBe(0);
  });

  test("counts hits and misses", () => {
    const cache = createCache(cacheConfig());

    cache.set("k", "value");
    cache.get("k");
    cache.get("nope");

    expect(cache.stats().hits).toBe(1);
    expect(cache.stats().misses).toBe(1);
  });

  test("clear empties the store and the byte count", () => {
    const cache = createCache(cacheConfig());

    cache.set("k", "value");
    cache.clear();

    expect(cache.stats().entries).toBe(0);
    expect(cache.stats().bytes).toBe(0);
  });
});
