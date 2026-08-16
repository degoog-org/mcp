import { secretFrom } from "../config/env.ts";
import type { ServerConfig } from "../config/schema.ts";

export interface Guard {
  required: boolean;
  allows: (request: Request) => boolean;
}

const timingSafe = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
};

export const bearerOf = (request: Request): string => {
  const header = request.headers.get("authorization") ?? "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
};

export const createGuard = (config: ServerConfig): Guard => {
  const token = secretFrom(config.authTokenEnv);

  return {
    required: Boolean(token),
    allows: (request) => (token ? timingSafe(bearerOf(request), token) : true),
  };
};

export const deniedResponse = (): Response =>
  Response.json({ error: "You shall not pass!" }, { status: 401 });
