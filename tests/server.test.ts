import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { EnvVar } from "../src/config/env.ts";
import { createSidecar, HttpPath } from "../src/server/http.ts";
import { SERVER_NAME, SERVER_VERSION } from "../src/server/mcp.ts";
import { ToolName, type ToolContext } from "../src/tools/context.ts";
import { registerTools } from "../src/tools/register.ts";
import { fakeSearch, makeCtx, serveFake } from "./helpers.ts";

const degoog = serveFake((_request, url) =>
  url.pathname === "/healthz"
    ? Response.json({ ok: true })
    : Response.json(fakeSearch([])),
);

const connect = async (ctx: ToolContext) => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerTools(server, { ctx, authRequired: false });
  await server.connect(serverSide);

  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientSide);

  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
};

afterEach(() => {
  delete process.env[EnvVar.AuthToken];
});

afterAll(async () => {
  await degoog.stop();
});

describe("http endpoints", () => {
  test("health reports the sidecar name and uptime", async () => {
    const sidecar = await createSidecar(makeCtx(degoog.url));

    const response = await sidecar.fetch(new Request(`http://mcp${HttpPath.Healthz}`));
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.name).toBe(SERVER_NAME);
    expect(typeof body.uptimeSec).toBe("number");

    await sidecar.close();
  });

  test("both health aliases and both ready aliases answer", async () => {
    const sidecar = await createSidecar(makeCtx(degoog.url));

    for (const path of [HttpPath.Health, HttpPath.Healthz, HttpPath.Ready, HttpPath.Readyz]) {
      const response = await sidecar.fetch(new Request(`http://mcp${path}`));
      expect(response.status).toBe(200);
    }

    await sidecar.close();
  });

  test("unknown paths are a plain 404", async () => {
    const sidecar = await createSidecar(makeCtx(degoog.url));

    const response = await sidecar.fetch(new Request("http://mcp/nope"));

    expect(response.status).toBe(404);

    await sidecar.close();
  });

  test("no token configured means no guard", async () => {
    const sidecar = await createSidecar(makeCtx(degoog.url));

    expect(sidecar.guard.required).toBe(false);

    await sidecar.close();
  });
});

describe("auth guard", () => {
  test("rejects /mcp without a bearer token", async () => {
    process.env[EnvVar.AuthToken] = "speak-friend";
    const sidecar = await createSidecar(makeCtx(degoog.url));

    const response = await sidecar.fetch(
      new Request(`http://mcp${HttpPath.Mcp}`, { method: "POST" }),
    );
    const body = (await response.json()) as Record<string, unknown>;

    expect(sidecar.guard.required).toBe(true);
    expect(response.status).toBe(401);
    expect(body.error).toBe("You shall not pass!");

    await sidecar.close();
  });

  test("rejects a wrong token and lets the right one through", async () => {
    process.env[EnvVar.AuthToken] = "speak-friend";
    const sidecar = await createSidecar(makeCtx(degoog.url));

    const wrong = await sidecar.fetch(
      new Request(`http://mcp${HttpPath.Mcp}`, {
        method: "POST",
        headers: { Authorization: "Bearer mellon" },
      }),
    );
    const right = await sidecar.fetch(
      new Request(`http://mcp${HttpPath.Mcp}`, {
        method: "POST",
        headers: { Authorization: "Bearer speak-friend" },
      }),
    );

    expect(wrong.status).toBe(401);
    expect(right.status).not.toBe(401);

    await sidecar.close();
  });

  test("health stays open while a token is required", async () => {
    process.env[EnvVar.AuthToken] = "speak-friend";
    const sidecar = await createSidecar(makeCtx(degoog.url));

    const response = await sidecar.fetch(new Request(`http://mcp${HttpPath.Healthz}`));

    expect(response.status).toBe(200);

    await sidecar.close();
  });
});

describe("tool registration", () => {
  test("registers every expected tool", async () => {
    const session = await connect(makeCtx(degoog.url));

    const { tools } = await session.client.listTools();
    const names = tools.map((tool) => tool.name).sort();

    expect(names).toEqual([...Object.values(ToolName)].sort());

    await session.close();
  });

  test("every tool describes itself for the model", async () => {
    const session = await connect(makeCtx(degoog.url));

    const { tools } = await session.client.listTools();

    for (const tool of tools) {
      expect(tool.description?.length ?? 0).toBeGreaterThan(20);
      expect(tool.annotations?.readOnlyHint).toBe(true);
    }

    await session.close();
  });

  test("search advertises its query input", async () => {
    const session = await connect(makeCtx(degoog.url));

    const { tools } = await session.client.listTools();
    const search = tools.find((tool) => tool.name === ToolName.Search);
    const properties = search?.inputSchema.properties as Record<string, unknown>;

    expect(properties.query).toBeDefined();
    expect(search?.inputSchema.required).toContain("query");

    await session.close();
  });

  test("the health tool answers over a real MCP session", async () => {
    const ctx = makeCtx(degoog.url);
    const session = await connect(ctx);

    const result = await session.client.callTool({ name: ToolName.Health });
    const data = result.structuredContent as Record<string, unknown>;

    expect(data.healthy).toBe(true);
    expect(data.configPath).toBe(ctx.configPath);
    expect(data.enabledTools).not.toContain(ToolName.DeepSearch);

    await session.close();
  });

  test("deep search names the missing query and its own live status", async () => {
    const session = await connect(makeCtx(degoog.url));

    const result = await session.client.callTool({
      name: ToolName.DeepSearch,
      arguments: { question: "anything" },
    });
    const error = (result.structuredContent as Record<string, unknown>).error as Record<
      string,
      string
    >;

    expect(result.isError).toBe(true);
    expect(error.kind).toBe("input");
    expect(error.message).toContain("query must not be empty");
    expect(error.message).toContain("deep_search is disabled on this instance");

    await session.close();
  });
});
