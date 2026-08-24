import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { DEFAULT_CONFIG } from "../src/config/defaults.ts";
import { EnvVar } from "../src/config/env.ts";
import { configPath, loadConfig } from "../src/config/load.ts";
import { OutputMode, QueryExpansion, TextMode } from "../src/config/schema.ts";
import { ProviderId } from "../src/llm/types.ts";

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "degoog-mcp-config-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  delete process.env[EnvVar.ConfigPath];
  delete process.env[EnvVar.DegoogUrl];
  delete process.env[EnvVar.Port];
  delete process.env[EnvVar.BindHost];
});

describe("config resolution", () => {
  test("uses DEGOOG_MCP_CONFIG when set", () => {
    process.env[EnvVar.ConfigPath] = "/custom/place.yml";
    expect(configPath()).toBe("/custom/place.yml");
  });

  test("falls back to /data/mcp.yml", () => {
    expect(configPath()).toBe("/data/mcp.yml");
  });

  test("explicit path beats the environment variable", () => {
    process.env[EnvVar.ConfigPath] = "/custom/place.yml";
    expect(configPath("/override.yml")).toBe("/override.yml");
  });
});

describe("first run", () => {
  test("creates the config file when missing and reloads it", async () => {
    const path = join(dir, "nested", "mcp.yml");

    const first = await loadConfig({ path });
    expect(first.created).toBe(true);
    expect(first.path).toBe(path);
    expect(first.config.degoog.url).toBe(DEFAULT_CONFIG.degoog.url);

    const written = await readFile(path, "utf8");
    expect(written).toContain("degoog:");
    expect(written).toContain("deepSearch:");
    expect(written).not.toContain("DEGOOG_MCP_AUTH_TOKEN: ");

    const second = await loadConfig({ path });
    expect(second.created).toBe(false);
    expect(second.config).toEqual(first.config);
  });

  test("the seeded yaml spells out every config key", async () => {
    const path = join(dir, "mcp.yml");
    await loadConfig({ path });
    const seeded = parse(await readFile(path, "utf8")) as Record<
      string,
      Record<string, unknown>
    >;

    for (const [section, values] of Object.entries(DEFAULT_CONFIG)) {
      expect({ [section]: Object.keys(seeded[section] ?? {}).sort() }).toEqual({
        [section]: Object.keys(values).sort(),
      });
    }
  });

  test("seeded config keeps deep search disabled", async () => {
    const path = join(dir, "mcp.yml");
    const { config } = await loadConfig({ path });

    expect(config.deepSearch.enabled).toBe(false);
    expect(config.deepSearch.provider).toBe(ProviderId.Ollama);
    expect(config.deepSearch.model).toBe("");
  });

  test("does not create a file when creation is disabled", async () => {
    const path = join(dir, "absent.yml");
    const { created, config } = await loadConfig({
      path,
      createIfMissing: false,
    });

    expect(created).toBe(false);
    expect(config.server.port).toBe(DEFAULT_CONFIG.server.port);
    expect(await Bun.file(path).exists()).toBe(false);
  });
});

describe("merging", () => {
  test("keeps defaults for unspecified keys", async () => {
    const path = join(dir, "mcp.yml");
    await writeFile(path, 'degoog:\n  url: "http://degoog.local:4444"\n');

    const { config } = await loadConfig({ path });
    expect(config.degoog.url).toBe("http://degoog.local:4444");
    expect(config.search.maxResults).toBe(DEFAULT_CONFIG.search.maxResults);
    expect(config.output.mode).toBe(OutputMode.Compact);
  });

  test("rejects unknown enum values and trailing slashes", async () => {
    const path = join(dir, "mcp.yml");
    await writeFile(
      path,
      'degoog:\n  url: "http://degoog:4444///"\noutput:\n  mode: telepathy\n',
    );

    const { config } = await loadConfig({ path });
    expect(config.degoog.url).toBe("http://degoog:4444");
    expect(config.output.mode).toBe(OutputMode.Compact);
  });

  test("bundle text mode defaults to compact", async () => {
    const path = join(dir, "mcp.yml");
    await writeFile(path, 'degoog:\n  url: "http://degoog.local:4444"\n');

    const { config } = await loadConfig({ path });
    expect(config.bundleSearch.textMode).toBe(TextMode.Compact);
    expect(DEFAULT_CONFIG.bundleSearch.textMode).toBe(TextMode.Compact);
  });

  test("bundle text mode accepts full and refuses nonsense", async () => {
    const full = join(dir, "full.yml");
    const junk = join(dir, "junk.yml");
    await writeFile(full, "bundleSearch:\n  textMode: full\n");
    await writeFile(junk, "bundleSearch:\n  textMode: interpretive-dance\n");

    expect((await loadConfig({ path: full })).config.bundleSearch.textMode).toBe(
      TextMode.Full,
    );
    expect((await loadConfig({ path: junk })).config.bundleSearch.textMode).toBe(
      TextMode.Compact,
    );
  });

  test("guidance defaults on and can be switched off", async () => {
    const plain = join(dir, "plain-guidance.yml");
    const off = join(dir, "guidance-off.yml");
    await writeFile(plain, 'degoog:\n  url: "http://degoog.local:4444"\n');
    await writeFile(off, "output:\n  guidance: false\n");

    expect((await loadConfig({ path: plain })).config.output.guidance).toBe(true);
    expect(DEFAULT_CONFIG.output.guidance).toBe(true);
    expect((await loadConfig({ path: off })).config.output.guidance).toBe(false);
  });

  test("scrape text mode defaults to compact and accepts full", async () => {
    const plain = join(dir, "plain.yml");
    const full = join(dir, "scrape-full.yml");
    await writeFile(plain, 'degoog:\n  url: "http://degoog.local:4444"\n');
    await writeFile(full, "scrape:\n  textMode: full\n");

    expect((await loadConfig({ path: plain })).config.scrape.textMode).toBe(
      TextMode.Compact,
    );
    expect(DEFAULT_CONFIG.scrape.textMode).toBe(TextMode.Compact);
    expect((await loadConfig({ path: full })).config.scrape.textMode).toBe(
      TextMode.Full,
    );
  });

  test("scrape hide images defaults to false and accepts true", async () => {
    const plain = join(dir, "plain-images.yml");
    const hidden = join(dir, "scrape-hidden-images.yml");
    await writeFile(plain, 'degoog:\n  url: "http://degoog.local:4444"\n');
    await writeFile(hidden, "scrape:\n  hideImages: true\n");

    expect((await loadConfig({ path: plain })).config.scrape.hideImages).toBe(
      false,
    );
    expect(DEFAULT_CONFIG.scrape.hideImages).toBe(false);
    expect((await loadConfig({ path: hidden })).config.scrape.hideImages).toBe(
      true,
    );
  });

  test("scrape fetcher stays empty by default", async () => {
    const path = join(dir, "plain-fetcher.yml");
    await writeFile(path, 'degoog:\n  url: "http://degoog.local:4444"\n');

    const { config } = await loadConfig({ path });
    expect(config.scrape.fetcher.url).toBe("");
    expect(config.scrape.fetcher.method).toBe("GET");
    expect(config.scrape.fetcher.headers).toEqual({});
  });

  test("reads a delegated fetcher and normalises its method and headers", async () => {
    const path = join(dir, "fetcher.yml");
    await writeFile(
      path,
      [
        "scrape:",
        "  fetcher:",
        '    url: " http://renderer:8080/v1 "',
        "    method: post",
        "    headers:",
        '      Content-Type: "application/json"',
        "      X-Retries: 3",
        `    body: '{"url":"{{url}}"}'`,
        "    html: page.body",
        "",
      ].join("\n"),
    );

    const { config } = await loadConfig({ path });
    expect(config.scrape.fetcher.url).toBe("http://renderer:8080/v1");
    expect(config.scrape.fetcher.method).toBe("POST");
    expect(config.scrape.fetcher.headers).toEqual({
      "Content-Type": "application/json",
      "X-Retries": "3",
    });
    expect(config.scrape.fetcher.html).toBe("page.body");
  });

  test("coerces yaml false for query expansion", async () => {
    const path = join(dir, "mcp.yml");
    await writeFile(path, "bundleSearch:\n  queryExpansion: false\n");

    const { config } = await loadConfig({ path });
    expect(config.bundleSearch.queryExpansion).toBe(QueryExpansion.Off);
  });

  test("falls back to defaults on invalid yaml", async () => {
    const path = join(dir, "mcp.yml");
    await writeFile(path, "degoog: [unclosed\n");

    const { config } = await loadConfig({ path });
    expect(config.degoog.url).toBe(DEFAULT_CONFIG.degoog.url);
  });

  test("ignores non-positive numbers", async () => {
    const path = join(dir, "mcp.yml");
    await writeFile(path, "search:\n  maxResults: 0\nscrape:\n  maxUrls: -3\n");

    const { config } = await loadConfig({ path });
    expect(config.search.maxResults).toBe(DEFAULT_CONFIG.search.maxResults);
    expect(config.scrape.maxUrls).toBe(DEFAULT_CONFIG.scrape.maxUrls);
  });
});

describe("environment overrides", () => {
  test("legacy sidecar variables win over file values", async () => {
    const path = join(dir, "mcp.yml");
    await writeFile(path, 'degoog:\n  url: "http://from-file:4444"\n');

    process.env[EnvVar.DegoogUrl] = "http://from-env:4444/";
    process.env[EnvVar.Port] = "9999";
    process.env[EnvVar.BindHost] = "127.0.0.1";

    const { config } = await loadConfig({ path });
    expect(config.degoog.url).toBe("http://from-env:4444");
    expect(config.server.port).toBe(9999);
    expect(config.server.host).toBe("127.0.0.1");
  });

  test("secrets are referenced by env name, never stored in config", async () => {
    const path = join(dir, "mcp.yml");
    const { config } = await loadConfig({ path });

    expect(config.server.authTokenEnv).toBe(EnvVar.AuthToken);
    expect(config.degoog.apiKeyEnv).toBe(EnvVar.DegoogApiKey);
    expect(JSON.stringify(config)).not.toContain("secret");
  });
});

describe("yaml interpolation", () => {
  const key = "DEGOOG_MCP_TEST_PROVIDER_KEY";
  const host = "DEGOOG_MCP_TEST_HOST";

  afterEach(() => {
    delete process.env[key];
    delete process.env[host];
  });

  test("expands ${VAR} in string values including secrets", async () => {
    process.env[key] = "sk-ant-test";
    process.env[host] = "gpu-box";
    const path = join(dir, "mcp.yml");
    await writeFile(
      path,
      [
        "degoog:",
        '  url: "http://${DEGOOG_MCP_TEST_HOST}:4444"',
        "deepSearch:",
        "  apiKey: ${DEGOOG_MCP_TEST_PROVIDER_KEY}",
        "",
      ].join("\n"),
    );

    const { config } = await loadConfig({ path });
    expect(config.degoog.url).toBe("http://gpu-box:4444");
    expect(config.deepSearch.apiKey).toBe("sk-ant-test");
  });

  test("uses ${VAR:-default} when the variable is unset", async () => {
    const path = join(dir, "mcp.yml");
    await writeFile(
      path,
      'degoog:\n  url: "${MISSING_DEGOOG_URL:-http://fallback:4444}"\n',
    );

    const { config } = await loadConfig({ path });
    expect(config.degoog.url).toBe("http://fallback:4444");
  });

  test("dedicated sidecar variables still win over interpolated file values", async () => {
    process.env[host] = "from-file";
    process.env[EnvVar.DegoogUrl] = "http://from-env:4444/";
    const path = join(dir, "mcp.yml");
    await writeFile(path, 'degoog:\n  url: "http://${DEGOOG_MCP_TEST_HOST}:9"\n');

    const { config } = await loadConfig({ path });
    expect(config.degoog.url).toBe("http://from-env:4444");
  });
});
