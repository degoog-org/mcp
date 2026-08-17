import { afterAll, describe, expect, test } from "bun:test";
import { EVAL_SYSTEM } from "../src/deep-search/evaluate.ts";
import { DISABLED_MESSAGE, runDeepSearch } from "../src/deep-search/orchestrator.ts";
import { PLAN_SYSTEM } from "../src/deep-search/plan.ts";
import { MISSING_CITATIONS, REPORT_SYSTEM } from "../src/deep-search/report.ts";
import { ProviderFallback, TextMode } from "../src/config/schema.ts";
import { ProviderId } from "../src/llm/types.ts";
import { runDeepTool } from "../src/tools/deep-search.ts";
import { fakeResult, fakeSearch, longText, makeCtx, pageHtml, serveFake, structured, visibleText } from "./helpers.ts";

interface Replies {
  plan?: string;
  evaluate?: string[];
  report?: string;
}

const DEFAULT_PLAN = '{"queries":["planned query"],"focus":"the basics"}';
const DEFAULT_EVAL = '{"sufficient":true,"gaps":[],"conflicts":[],"followUps":[]}';
const DEFAULT_REPORT = "The thing installs with one command [S1].";

let replies: Replies = {};
let evaluations = 0;
let failProvider = false;
let deadLinksFirst = false;
const askedSystems: string[] = [];

const sse = (text: string): Response =>
  new Response(
    [
      `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}`,
      "",
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}`,
      "",
      "data: [DONE]",
      "",
      "",
    ].join("\n"),
    { headers: { "content-type": "text/event-stream" } },
  );

const replyFor = (system: string): string => {
  if (system === PLAN_SYSTEM) return replies.plan ?? DEFAULT_PLAN;
  if (system === EVAL_SYSTEM) {
    const sequence = replies.evaluate;
    const reply = sequence?.[evaluations] ?? sequence?.at(-1) ?? DEFAULT_EVAL;
    evaluations++;
    return reply;
  }
  if (system === REPORT_SYSTEM) return replies.report ?? DEFAULT_REPORT;
  return "";
};

let port = "";

const alias = (host: string, path: string): string =>
  `http://${host}:${port}${path}`;

const liveResults = () => [
  fakeResult({ url: alias("localhost", "/docs"), title: "Official docs" }),
  fakeResult({ url: alias("127.0.0.1", "/guide"), title: "Community guide" }),
];

const deadLinkResults = () => [
  fakeResult({ url: alias("localhost", "/gone"), title: "Dead one" }),
  fakeResult({ url: alias("127.0.0.1", "/gone"), title: "Dead two" }),
  fakeResult({ url: alias("0.0.0.0", "/docs"), title: "Live one" }),
  fakeResult({ url: alias("127.0.0.2", "/guide"), title: "Live two" }),
];

const server = serveFake(async (request, url) => {
  if (url.pathname === "/chat/completions") {
    if (failProvider) return new Response("nope", { status: 500 });
    const body = (await request.clone().json()) as {
      messages: Array<{ role: string; content: string }>;
    };
    const system = body.messages.find((m) => m.role === "system")?.content ?? "";
    askedSystems.push(system);
    return sse(replyFor(system));
  }

  if (url.pathname === "/api/search") {
    const query =
      url.searchParams.get("q") ??
      ((await request.clone().json()) as { query?: string }).query ??
      "";
    return Response.json(
      fakeSearch(deadLinksFirst ? deadLinkResults() : liveResults(), query),
    );
  }

  if (url.pathname === "/gone") return new Response("gone", { status: 410 });

  return new Response(
    pageHtml("Deep page", [longText("install", 12), longText("configure", 12)]),
    { headers: { "content-type": "text/html" } },
  );
});

port = new URL(server.url).port;

const reset = () => {
  replies = {};
  evaluations = 0;
  failProvider = false;
  deadLinksFirst = false;
  askedSystems.length = 0;
};

const enabled = (overrides: Record<string, unknown> = {}) =>
  makeCtx(server.url, {
    deepSearch: {
      enabled: true,
      provider: ProviderId.OpenAICompat,
      baseUrl: server.url,
      model: "test-model",
      ...overrides,
    },
  });

const strict = (overrides: Record<string, unknown> = {}) =>
  enabled({ onProviderUnavailable: ProviderFallback.Off, ...overrides });

afterAll(async () => {
  await server.stop();
});

describe("deep search availability", () => {
  test("is disabled by default", async () => {
    reset();
    const ctx = makeCtx(server.url);

    expect(ctx.config.deepSearch.enabled).toBe(false);
    expect(ctx.config.deepSearch.onProviderUnavailable).toBe(
      ProviderFallback.BundleSearch,
    );
  });

  test("a disabled instance never calls the provider", async () => {
    reset();

    await runDeepSearch(makeCtx(server.url), { query: "anything" });

    expect(askedSystems).toHaveLength(0);
  });

  test("the tool rejects an empty question before anything else", async () => {
    reset();
    const result = await runDeepTool(enabled(), { query: "  " });
    const error = structured(result).error as Record<string, string>;

    expect(result.isError).toBe(true);
    expect(error.kind).toBe("input");
  });
});

describe("onProviderUnavailable", () => {
  test("bundle_search degrades instead of erroring, and says so", async () => {
    reset();

    const result = await runDeepSearch(makeCtx(server.url), {
      query: "how do i install",
    });
    const data = structured(result);
    const degraded = data.degraded as Record<string, string>;

    expect(result.isError).toBeFalsy();
    expect(degraded.requested).toBe("deep_search");
    expect(degraded.ran).toBe("bundle_search");
    expect(degraded.reason).toBe(DISABLED_MESSAGE);
    expect(visibleText(result)).toContain("DEGRADED RESULT");
    expect(visibleText(result)).toContain("no report was written");
    expect(data.report).toBeUndefined();
    expect(askedSystems).toHaveLength(0);
  });

  test("the degraded pack respects bundleSearch.textMode", async () => {
    reset();

    const ctx = makeCtx(server.url, {
      bundleSearch: { textMode: TextMode.Full },
    });
    const result = await runDeepSearch(ctx, { query: "how do i install" });
    const sources = structured(result).sources as Array<Record<string, string>>;
    const text = visibleText(result);

    expect(text).toContain("DEGRADED RESULT");
    expect(text).toContain("Sources:");
    expect(text).toContain("Evidence:");
    expect(text).toContain(`[${sources[0]?.id}] ${sources[0]?.title}`);
  });

  test("off errors and never points at bundle_search", async () => {
    reset();
    const ctx = makeCtx(server.url, {
      deepSearch: { onProviderUnavailable: ProviderFallback.Off },
    });

    const result = await runDeepSearch(ctx, { query: "how do i install" });
    const error = structured(result).error as Record<string, string>;

    expect(result.isError).toBe(true);
    expect(error.kind).toBe("disabled");
    expect(error.message).toBe(DISABLED_MESSAGE);
    expect(visibleText(result)).not.toContain("bundle_search");
    expect(visibleText(result)).toContain("onProviderUnavailable is off");
  });

  test("off keeps bundle_search out of the empty query hint too", async () => {
    reset();

    expect(visibleText(await runDeepTool(strict(), {}))).not.toContain(
      "bundle_search",
    );
    expect(visibleText(await runDeepTool(enabled(), {}))).toContain(
      "bundle_search",
    );
  });

  test("a provider failure degrades rather than losing the call", async () => {
    reset();
    failProvider = true;

    const result = await runDeepSearch(enabled(), { query: "how do i install" });
    const degraded = structured(result).degraded as Record<string, string>;

    expect(result.isError).toBeFalsy();
    expect(degraded.ran).toBe("bundle_search");
    expect(degraded.reason).toContain("500");
  });
});

describe("provider configuration", () => {
  test("enabled without a model is a config error naming the field", async () => {
    reset();
    const ctx = strict({ model: "" });

    const result = await runDeepSearch(ctx, { query: "how do i install" });
    const error = structured(result).error as Record<string, string>;

    expect(result.isError).toBe(true);
    expect(error.kind).toBe("config");
    expect(error.message).toContain("deepSearch.model");
    expect(askedSystems).toHaveLength(0);
  });

  test("a provider needing a baseUrl says so when it is missing", async () => {
    reset();
    const ctx = strict({ baseUrl: "" });

    const error = structured(
      await runDeepSearch(ctx, { query: "how do i install" }),
    ).error as Record<string, string>;

    expect(error.kind).toBe("config");
    expect(error.message).toContain("deepSearch.baseUrl");
  });

  test("a provider needing an apiKey says so when it is missing", async () => {
    reset();
    const ctx = strict({ provider: ProviderId.Anthropic, apiKey: "" });

    const error = structured(
      await runDeepSearch(ctx, { query: "how do i install" }),
    ).error as Record<string, string>;

    expect(error.kind).toBe("config");
    expect(error.message).toContain("deepSearch.apiKey");
  });

  test("a provider failure comes back as an error result when off", async () => {
    reset();
    failProvider = true;

    const result = await runDeepSearch(strict(), { query: "how do i install" });

    expect(result.isError).toBe(true);
    expect(visibleText(result)).toContain("500");
  });
});

describe("source gathering", () => {
  test("walks past dead links to reach the target instead of shrinking the pack", async () => {
    reset();
    deadLinksFirst = true;

    const data = structured(
      await runDeepSearch(enabled({ maxScrapeUrls: 2 }), {
        query: "how do i install",
      }),
    );
    const selection = data.selection as Record<string, number | boolean>;
    const counts = data.counts as Record<string, number>;

    expect(counts.sources).toBe(2);
    expect(selection.useful).toBe(2);
    expect(selection.attempted).toBeGreaterThan(2);
    expect(counts.failures).toBeGreaterThan(0);
    expect(data.selectionPolicy).toBe("degoog_order_readable_sources");
  });

  test("a failed scrape no longer burns a source slot", async () => {
    reset();
    deadLinksFirst = true;

    const withFailures = structured(
      await runDeepSearch(enabled({ maxScrapeUrls: 2 }), {
        query: "how do i install",
      }),
    );

    reset();
    const clean = structured(
      await runDeepSearch(enabled({ maxScrapeUrls: 2 }), {
        query: "how do i install",
      }),
    );

    expect((withFailures.counts as Record<string, number>).sources).toBe(
      (clean.counts as Record<string, number>).sources,
    );
  });

  test("never attempts more scrapes than the configured ceiling", async () => {
    reset();
    deadLinksFirst = true;

    const data = structured(
      await runDeepSearch(
        enabled({ maxScrapeUrls: 8, scrapeOverage: 8, maxScrapeAttempts: 3 }),
        { query: "how do i install" },
      ),
    );
    const selection = data.selection as Record<string, number | boolean>;

    expect(selection.attempted).toBeLessThanOrEqual(3);
  });
});

describe("provider driven research loop", () => {
  test("plans, gathers evidence and returns a cited report", async () => {
    reset();

    const result = await runDeepSearch(enabled(), { query: "how do i install" });
    const data = structured(result);
    const counts = data.counts as Record<string, number>;

    expect(data.cited).toBe(true);
    expect(data.report).toContain("[S1]");
    expect(data.searchedQueries).toEqual(["planned query"]);
    expect(data.provider).toBe(ProviderId.OpenAICompat);
    expect(data.providerModel).toBe("test-model");
    expect(counts.sources).toBeGreaterThan(0);
    expect((data.trace as unknown[]).length).toBe(1);

    const sources = data.sources as Array<Record<string, number>>;
    const evidence = data.evidence as Array<Record<string, number>>;
    expect(sources.every((source) => typeof source.match === "number")).toBe(true);
    expect(evidence.every((chunk) => typeof chunk.match === "number")).toBe(true);
    expect(askedSystems).toEqual([PLAN_SYSTEM, EVAL_SYSTEM, REPORT_SYSTEM]);
  });

  test("stops early when the model judges the evidence sufficient", async () => {
    reset();
    const result = await runDeepSearch(enabled(), { query: "how do i install" });

    expect(structured(result).stoppedBecause).toBe(
      "evidence judged sufficient with no gaps left open",
    );
  });

  test("keeps going when the model calls it sufficient but still lists gaps", async () => {
    reset();
    replies = {
      plan: '{"queries":["first pass"],"focus":"start"}',
      evaluate: [
        '{"sufficient":true,"gaps":["pricing"],"conflicts":[],"followUps":["second pass"]}',
        DEFAULT_EVAL,
      ],
    };

    const data = structured(
      await runDeepSearch(enabled(), { query: "how do i install" }),
    );

    expect(data.searchedQueries).toEqual(["first pass", "second pass"]);
    expect((data.trace as unknown[]).length).toBe(2);
  });

  test("says which gaps were still open when the iteration budget runs out", async () => {
    reset();
    replies = {
      plan: '{"queries":["only pass"],"focus":"start"}',
      evaluate: [
        '{"sufficient":true,"gaps":["pricing"],"conflicts":[],"followUps":["another pass"]}',
        '{"sufficient":true,"gaps":["pricing"],"conflicts":[],"followUps":[]}',
      ],
    };

    const data = structured(
      await runDeepSearch(enabled({ maxIterations: 2 }), { query: "how do i install" }),
    );

    expect(data.stoppedBecause).toContain("gaps still open");
    expect(data.stoppedBecause).toContain("pricing");
  });

  test("follows up on gaps for another iteration", async () => {
    reset();
    replies = {
      plan: '{"queries":["first pass"],"focus":"start"}',
      evaluate: [
        '{"sufficient":false,"gaps":["pricing"],"conflicts":[],"followUps":["second pass"]}',
        DEFAULT_EVAL,
      ],
      report: "Report body [S1].",
    };

    const data = structured(
      await runDeepSearch(enabled(), { query: "how do i install" }),
    );

    expect(data.searchedQueries).toEqual(["first pass", "second pass"]);
    expect((data.trace as unknown[]).length).toBe(2);
  });

  test("falls back to the question when the plan is unusable", async () => {
    reset();
    replies = { plan: "sorry, I cannot help with that" };

    const data = structured(
      await runDeepSearch(enabled(), { query: "how do i install" }),
    );

    expect(data.searchedQueries).toEqual(["how do i install"]);
  });

  test("rejects an uncited report when citations are required", async () => {
    reset();
    replies = { report: "It just works, trust me." };

    const result = await runDeepSearch(enabled(), { query: "how do i install" });
    const data = structured(result);

    expect(data.cited).toBe(false);
    expect(visibleText(result)).toContain(MISSING_CITATIONS);
    expect((data.evidence as unknown[]).length).toBeGreaterThan(0);
  });

  test("keeps an uncited report when citations are not required", async () => {
    reset();
    replies = { report: "It just works, trust me." };
    const ctx = enabled({ requireCitations: false });

    const result = await runDeepSearch(ctx, { query: "how do i install" });

    expect(visibleText(result)).toBe("It just works, trust me.");
    expect(structured(result).cited).toBe(false);
  });
});
