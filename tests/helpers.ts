import { createCache } from "../src/cache/memory.ts";
import { DEFAULT_CONFIG } from "../src/config/defaults.ts";
import type { McpConfig, PartialConfig } from "../src/config/schema.ts";
import { createClient } from "../src/degoog/client.ts";
import type { DegoogResult, DegoogSearchResponse } from "../src/degoog/types.ts";
import type { ToolContext } from "../src/tools/context.ts";

export interface FakeServer {
  url: string;
  hits: string[];
  bodies: unknown[];
  authHeaders: Array<string | null>;
  stop: () => Promise<void>;
}

export const serveFake = (
  handler: (request: Request, url: URL) => Response | Promise<Response>,
): FakeServer => {
  const hits: string[] = [];
  const bodies: unknown[] = [];
  const authHeaders: Array<string | null> = [];

  const server = Bun.serve({
    port: 0,
    idleTimeout: 30,
    fetch: async (request) => {
      const url = new URL(request.url);
      hits.push(`${request.method} ${url.pathname}${url.search}`);
      authHeaders.push(request.headers.get("authorization"));

      if (request.method === "POST") {
        const text = await request.clone().text();
        try {
          bodies.push(JSON.parse(text));
        } catch {
          bodies.push(text);
        }
      }

      return handler(request, url);
    },
  });

  return {
    url: `http://127.0.0.1:${server.port}`,
    hits,
    bodies,
    authHeaders,
    stop: async () => {
      await server.stop(true);
    },
  };
};

export const mergeConfig = (overrides: PartialConfig = {}): McpConfig => ({
  server: { ...DEFAULT_CONFIG.server, ...overrides.server },
  degoog: { ...DEFAULT_CONFIG.degoog, ...overrides.degoog },
  output: { ...DEFAULT_CONFIG.output, ...overrides.output },
  search: { ...DEFAULT_CONFIG.search, ...overrides.search },
  scrape: { ...DEFAULT_CONFIG.scrape, ...overrides.scrape },
  bundleSearch: { ...DEFAULT_CONFIG.bundleSearch, ...overrides.bundleSearch },
  deepSearch: { ...DEFAULT_CONFIG.deepSearch, ...overrides.deepSearch },
  cache: { ...DEFAULT_CONFIG.cache, ...overrides.cache },
});

export const makeCtx = (
  baseUrl: string,
  overrides: PartialConfig = {},
): ToolContext => {
  const config = mergeConfig({
    ...overrides,
    degoog: { url: baseUrl, ...overrides.degoog },
    scrape: { allowPrivateIps: true, ...overrides.scrape },
  });

  return {
    config,
    client: createClient(config.degoog),
    cache: createCache(config.cache),
    configPath: "/tmp/mcp-test.yml",
    startedAt: Date.now(),
  };
};

export const fakeResult = (
  partial: Partial<DegoogResult> & { url: string },
): DegoogResult => ({
  title: partial.title ?? "Result",
  url: partial.url,
  snippet: partial.snippet ?? "A snippet about the topic being searched for.",
  source: partial.source ?? "Brave",
  score: partial.score ?? 10,
  sources: partial.sources ?? [partial.source ?? "Brave"],
});

export const fakeSearch = (
  results: DegoogResult[],
  query = "test query",
): DegoogSearchResponse => ({
  results,
  query,
  type: "web",
  totalTime: 120,
  engineTimings: [{ name: "Brave", time: 100, resultCount: results.length }],
  relatedSearches: ["related one", "related two"],
});

export const pageHtml = (title: string, paragraphs: string[]): string => `
<!doctype html>
<html>
  <head>
    <title>${title}</title>
    <link rel="canonical" href="https://example.com/canonical" />
    <meta property="article:published_time" content="2026-01-15T10:00:00Z" />
    <meta property="og:site_name" content="Example Site" />
  </head>
  <body>
    <nav>Home About Contact</nav>
    <article>
      <h1>${title}</h1>
      ${paragraphs.map((text) => `<p>${text}</p>`).join("\n")}
    </article>
    <footer>Copyright notice</footer>
  </body>
</html>`;

export const longText = (word: string, times: number): string =>
  Array.from({ length: times }, (_, i) => `${word} sentence ${i} with filler.`).join(" ");

export const structured = (result: {
  structuredContent?: Record<string, unknown>;
}): Record<string, unknown> => result.structuredContent ?? {};

export const visibleText = (result: {
  content: Array<{ type: "text"; text: string }>;
}): string => result.content.map((entry) => entry.text).join("\n");
