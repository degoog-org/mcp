import { DegoogError } from "../degoog/client.ts";
import { TimeoutError } from "../utils/timeout.ts";
import type { ToolResult } from "./structured.ts";

export enum ToolErrorKind {
  Config = "config",
  Upstream = "upstream",
  Auth = "auth",
  Timeout = "timeout",
  Input = "input",
  Disabled = "disabled",
  Unsupported = "unsupported",
}

export const errorResult = (
  kind: ToolErrorKind,
  message: string,
  hint?: string,
): ToolResult => ({
  content: [{ type: "text", text: hint ? `${message}\n${hint}` : message }],
  structuredContent: { error: { kind, message, ...(hint ? { hint } : {}) } },
  isError: true,
});

export const kindOf = (err: unknown): ToolErrorKind => {
  if (err instanceof TimeoutError) return ToolErrorKind.Timeout;
  if (err instanceof DegoogError) {
    return err.status === 401 || err.status === 403
      ? ToolErrorKind.Auth
      : ToolErrorKind.Upstream;
  }
  return ToolErrorKind.Upstream;
};

export const messageOf = (err: unknown): string =>
  err instanceof Error ? err.message : "unexpected failure";

export const fromError = (err: unknown, hint?: string): ToolResult =>
  errorResult(kindOf(err), messageOf(err), hint);
