import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { EnvVar } from "../src/config/env.ts";
import { createSidecar, HttpPath, startServer, type Sidecar } from "../src/server/http.ts";
import { SESSION_HEADER } from "../src/server/mcp.ts";
import { ToolName } from "../src/tools/context.ts";
import { fakeResult, fakeSearch, makeCtx, serveFake } from "./helpers.ts";

const JSON_HEADERS = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};

const degoog = serveFake((_request, url) => {
  if (url.pathname === "/healthz") return Response.json({ ok: true });
  if (url.pathname === "/api/search-tabs") {
    return Response.json({
      tabs: [
        { id: "engine:images", name: "Images", icon: null },
        { id: "engine:news", name: "News", icon: null },
      ],
    });
  }
  if (url.pathname === "/api/extensions") {
    return Response.json(
      url.searchParams.get("type") === "engine"
        ? { engines: [{ id: "brave-engine", name: "Brave", enabled: true }] }
        : { autocomplete: [] },
    );
  }
  if (url.pathname === "/api/commands") return Response.json({ commands: [] });

  return Response.json(
    fakeSearch([fakeResult({ url: "https://www.eurogamer.net/kingdom-hearts-4" })]),
  );
});

interface Sidecarland {
  sidecar: Sidecar;
  mcpUrl: URL;
  stop: () => Promise<void>;
}

const liveSidecar = async (): Promise<Sidecarland> => {
  const ctx = makeCtx(degoog.url, { server: { port: 0 } });
  const sidecar = await createSidecar(ctx);
  const running = await startServer(sidecar, ctx.config);

  return {
    sidecar,
    mcpUrl: new URL(`http://127.0.0.1:${running.port}${HttpPath.Mcp}`),
    stop: () => running.stop(),
  };
};

const dialClient = async (mcpUrl: URL, token?: string) => {
  const transport = new StreamableHTTPClientTransport(mcpUrl, {
    requestInit: token ? { headers: { authorization: `Bearer ${token}` } } : undefined,
  });
  const client = new Client({ name: "session-test", version: "0.0.0" });

  await client.connect(transport);

  return { client, transport };
};

afterEach(() => {
  delete process.env[EnvVar.AuthToken];
});

afterAll(async () => {
  await degoog.stop();
});

describe("streamable http sessions", () => {
  test("two clients initialize one after another without a restart", async () => {
    const land = await liveSidecar();

    const first = await dialClient(land.mcpUrl);
    const firstTools = await first.client.listTools();
    await first.client.close();

    const second = await dialClient(land.mcpUrl);
    const secondTools = await second.client.listTools();
    await second.client.close();

    expect(firstTools.tools.length).toBeGreaterThan(0);
    expect(secondTools.tools.length).toBe(firstTools.tools.length);
    expect(first.transport.sessionId).toBeDefined();
    expect(second.transport.sessionId).toBeDefined();
    expect(second.transport.sessionId).not.toBe(first.transport.sessionId);

    await land.stop();
  });

  test("two clients stay usable at the same time", async () => {
    const land = await liveSidecar();

    const first = await dialClient(land.mcpUrl);
    const second = await dialClient(land.mcpUrl);

    expect(land.sidecar.endpoint.sessionCount()).toBe(2);

    const both = await Promise.all([
      first.client.callTool({ name: ToolName.Health }),
      second.client.listTools(),
    ]);
    const health = both[0].structuredContent as Record<string, unknown>;

    expect(health.healthy).toBe(true);
    expect(both[1].tools.map((tool) => tool.name)).toContain(ToolName.Search);

    await first.client.close();
    await second.client.close();
    await land.stop();
  });

  test("closing a client releases its session", async () => {
    const land = await liveSidecar();

    const session = await dialClient(land.mcpUrl);
    await session.client.listTools();

    expect(land.sidecar.endpoint.sessionCount()).toBe(1);

    await session.transport.terminateSession();

    expect(land.sidecar.endpoint.sessionCount()).toBe(0);

    await session.client.close();
    await land.stop();
  });

  test("an unknown session id is a 404 instead of a reused transport", async () => {
    const land = await liveSidecar();

    const response = await fetch(land.mcpUrl, {
      method: "POST",
      headers: { ...JSON_HEADERS, [SESSION_HEADER]: "ghost-session" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    const body = (await response.json()) as { error: { message: string } };

    expect(response.status).toBe(404);
    expect(body.error.message).toBe("Session not found");

    await land.stop();
  });

  test("a non initialize call without a session id is a 400", async () => {
    const land = await liveSidecar();

    const response = await fetch(land.mcpUrl, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    const body = (await response.json()) as { error: { message: string } };

    expect(response.status).toBe(400);
    expect(body.error.message).toBe("Bad Request: Mcp-Session-Id header is required");

    await land.stop();
  });

  test("broken json never opens a session", async () => {
    const land = await liveSidecar();

    const response = await fetch(land.mcpUrl, {
      method: "POST",
      headers: JSON_HEADERS,
      body: "{ not json",
    });

    expect(response.status).toBe(400);
    expect(land.sidecar.endpoint.sessionCount()).toBe(0);

    await land.stop();
  });

  test("the guard still gates real session handshakes", async () => {
    process.env[EnvVar.AuthToken] = "speak-friend";
    const land = await liveSidecar();

    await expect(dialClient(land.mcpUrl)).rejects.toThrow();

    const allowed = await dialClient(land.mcpUrl, "speak-friend");
    const { tools } = await allowed.client.listTools();

    expect(tools.length).toBeGreaterThan(0);

    await allowed.client.close();
    await land.stop();
  });

  test("a real client can feed discover output straight back into search", async () => {
    const land = await liveSidecar();
    const session = await dialClient(land.mcpUrl);

    const discovered = await session.client.callTool({ name: ToolName.Discover });
    const types = (discovered.structuredContent as { searchTypes: string[] }).searchTypes;

    expect(types).toEqual(["web", "images", "news"]);

    for (const type of types) {
      const searched = await session.client.callTool({
        name: ToolName.Search,
        arguments: { query: "kingdom hearts 4 info", type },
      });
      const data = searched.structuredContent as Record<string, unknown>;

      expect(searched.isError).toBeFalsy();
      expect(data.type).toBe(type);
      expect(data.typeWarning).toBeUndefined();
      expect((data.results as unknown[]).length).toBeGreaterThan(0);
    }

    await session.client.close();
    await land.stop();
  });

  test("deep_search stays listed and degrades to a labelled bundle pack", async () => {
    const land = await liveSidecar();
    const session = await dialClient(land.mcpUrl);

    const { tools } = await session.client.listTools();
    const deep = tools.find((tool) => tool.name === ToolName.DeepSearch);
    const called = await session.client.callTool({
      name: ToolName.DeepSearch,
      arguments: { query: "anything" },
    });
    const degraded = (called.structuredContent as Record<string, unknown>)
      .degraded as Record<string, string>;

    expect(deep?.description).toContain("deepSearch enabled and configured");
    expect(deep?.description).toContain(ToolName.BundleSearch);
    expect(called.isError).toBeFalsy();
    expect(degraded.requested).toBe(ToolName.DeepSearch);
    expect(degraded.ran).toBe(ToolName.BundleSearch);
    expect(JSON.stringify(called.content)).toContain("DEGRADED RESULT");

    await session.client.close();
    await land.stop();
  });

  test("disabled deep_search explains itself before validating arguments", async () => {
    const land = await liveSidecar();
    const session = await dialClient(land.mcpUrl);

    for (const args of [{}, { query: "" }, { lang: "en" }]) {
      const called = await session.client.callTool({
        name: ToolName.DeepSearch,
        arguments: args,
      });

      expect(called.isError).toBe(true);
      expect(JSON.stringify(called.content)).toContain(ToolName.BundleSearch);
      expect(JSON.stringify(called.content)).not.toContain("Invalid arguments");
    }

    await session.client.close();
    await land.stop();
  });

  test("suggest is not offered as a tool", async () => {
    const land = await liveSidecar();
    const session = await dialClient(land.mcpUrl);

    const { tools } = await session.client.listTools();

    expect(tools.map((tool) => tool.name)).not.toContain("suggest");
    expect(tools.map((tool) => tool.name)).toContain(ToolName.BundleSearch);

    await session.client.close();
    await land.stop();
  });

  test("healthz keeps answering while sessions are live", async () => {
    const land = await liveSidecar();

    const session = await dialClient(land.mcpUrl);
    const response = await fetch(
      new URL(HttpPath.Healthz, land.mcpUrl).toString(),
    );
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);

    await session.client.close();
    await land.stop();
  });
});
