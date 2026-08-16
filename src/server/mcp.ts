import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { registerTools } from "../tools/register.ts";
import type { ToolContext } from "../tools/context.ts";
import { logger } from "../utils/logger.ts";

const LOG_NS = "mcp";

export const SERVER_NAME = "degoog-mcp";
export const SERVER_VERSION = "0.1.0";

export const SESSION_HEADER = "mcp-session-id";
export const SESSION_IDLE_MS = 30 * 60 * 1000;

export const SERVER_INSTRUCTIONS = [
  "Degoog search tools. Start with bundle_search when you need an answer backed by page content,",
  "or search then scrape when you want control. Cite the [S1] style ids returned in structured content.",
  "Use discover to learn valid search types, engine ids, and caps before guessing.",
].join(" ");

enum HttpMethod {
  Post = "POST",
}

enum RpcCode {
  ParseError = -32700,
  BadRequest = -32000,
  NotFound = -32001,
}

enum RpcMessage {
  BadJson = "Parse error: Invalid JSON",
  NeedSession = "Bad Request: Mcp-Session-Id header is required",
  NoSession = "Session not found",
}

interface Session {
  server: McpServer;
  transport: WebStandardStreamableHTTPServerTransport;
  touchedAt: number;
}

export interface McpEndpoint {
  handle: (request: Request) => Promise<Response>;
  sessionCount: () => number;
  close: () => Promise<void>;
}

const PARSE_FAILED = Symbol("parse-failed");

const rpcFail = (status: number, code: RpcCode, message: RpcMessage): Response =>
  Response.json({ jsonrpc: "2.0", error: { code, message }, id: null }, { status });

const readBody = async (request: Request): Promise<unknown> => {
  try {
    return await request.json();
  } catch {
    return PARSE_FAILED;
  }
};

const isHandshake = (body: unknown): boolean =>
  Array.isArray(body) ? body.some(isInitializeRequest) : isInitializeRequest(body);

export const createEndpoint = async (
  ctx: ToolContext,
  authRequired: boolean,
): Promise<McpEndpoint> => {
  const sessions = new Map<string, Session>();

  const forgeSession = (): Session => {
    const server = new McpServer(
      { name: SERVER_NAME, version: SERVER_VERSION },
      { capabilities: { tools: {}, logging: {} }, instructions: SERVER_INSTRUCTIONS },
    );

    registerTools(server, { ctx, authRequired });

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (sessionId) => {
        sessions.set(sessionId, session);
        logger.debug(LOG_NS, `session initialized ${sessionId.slice(0, 8)}`);
      },
      onsessionclosed: (sessionId) => {
        sessions.delete(sessionId);
        logger.debug(LOG_NS, `session closed ${sessionId.slice(0, 8)}`);
      },
    });

    const session: Session = { server, transport, touchedAt: Date.now() };

    return session;
  };

  const dropStale = async (): Promise<void> => {
    const cutoff = Date.now() - SESSION_IDLE_MS;

    for (const [sessionId, session] of [...sessions]) {
      if (session.touchedAt > cutoff) continue;

      sessions.delete(sessionId);
      logger.debug(LOG_NS, `session expired ${sessionId.slice(0, 8)}`);
      await session.server.close();
    }
  };

  const openSession = async (request: Request, body: unknown): Promise<Response> => {
    await dropStale();

    const session = forgeSession();
    await session.server.connect(session.transport);

    const response = await session.transport.handleRequest(request, { parsedBody: body });

    if (!session.transport.sessionId) {
      await session.server.close();
    }

    return response;
  };

  const handle = async (request: Request): Promise<Response> => {
    const sessionId = request.headers.get(SESSION_HEADER);

    if (sessionId) {
      const session = sessions.get(sessionId);
      if (!session) return rpcFail(404, RpcCode.NotFound, RpcMessage.NoSession);

      session.touchedAt = Date.now();
      return session.transport.handleRequest(request);
    }

    if (request.method !== HttpMethod.Post) {
      return rpcFail(400, RpcCode.BadRequest, RpcMessage.NeedSession);
    }

    const body = await readBody(request);
    if (body === PARSE_FAILED) return rpcFail(400, RpcCode.ParseError, RpcMessage.BadJson);
    if (!isHandshake(body)) return rpcFail(400, RpcCode.BadRequest, RpcMessage.NeedSession);

    return openSession(request, body);
  };

  logger.info(LOG_NS, `${SERVER_NAME} ${SERVER_VERSION} ready`);

  return {
    handle,
    sessionCount: () => sessions.size,
    close: async () => {
      const live = [...sessions.values()];
      sessions.clear();
      await Promise.all(live.map((session) => session.server.close()));
    },
  };
};
