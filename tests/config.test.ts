import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { DEFAULT_CONFIG } from "../src/config/defaults.ts";
import { EnvVar } from "../src/config/env.ts";
import { configPath, loadConfig } from "../src/config/load.ts";
import { OutputMode, QueryExpansion } from "../src/config/schema.ts";
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
