import type { CacheConfig } from "../config/schema.ts";
import { isExpired, sizeOf, type Entry } from "./ttl.ts";

export interface CacheStats {
  entries: number;
  bytes: number;
  hits: number;
  misses: number;
  evictions: number;
}

export interface MemoryCache {
  get: <T>(key: string) => T | null;
  set: <T>(key: string, value: T, ttlMs?: number) => void;
  has: (key: string) => boolean;
  clear: () => void;
  stats: () => CacheStats;
}

export const createCache = (
  config: CacheConfig,
  clock: () => number = Date.now,
): MemoryCache => {
  const store = new Map<string, Entry<unknown>>();
  let bytes = 0;
  let hits = 0;
  let misses = 0;
  let evictions = 0;

  const drop = (key: string): void => {
    const entry = store.get(key);
    if (!entry) return;
    bytes -= entry.bytes;
    store.delete(key);
  };

  const evict = (): void => {
    for (const [key, entry] of store) {
      if (!isExpired(entry, clock())) continue;
      drop(key);
      evictions++;
    }
    while (store.size > config.maxEntries || bytes > config.maxBytes) {
      const oldest = store.keys().next();
      if (oldest.done) break;
      drop(oldest.value);
      evictions++;
    }
  };

  const get = <T>(key: string): T | null => {
    if (!config.enabled) return null;

    const entry = store.get(key);
    if (!entry) {
      misses++;
      return null;
    }
    if (isExpired(entry, clock())) {
      drop(key);
      evictions++;
      misses++;
      return null;
    }

    store.delete(key);
    store.set(key, entry);
    hits++;
    return entry.value as T;
  };

  const set = <T>(key: string, value: T, ttlMs?: number): void => {
    if (!config.enabled) return;

    const size = sizeOf(value);
    if (size > config.maxBytes) return;

    drop(key);
    store.set(key, {
      value,
      bytes: size,
      expiresAt: clock() + (ttlMs ?? config.ttlMs),
    });
    bytes += size;
    evict();
  };

  return {
    get,
    set,
    has: (key) => get(key) !== null,
    clear: () => {
      store.clear();
      bytes = 0;
    },
    stats: () => ({ entries: store.size, bytes, hits, misses, evictions }),
  };
};
