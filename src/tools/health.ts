import { buildReport, HealthState } from "../server/health.ts";
import { toolResult, type ToolResult } from "../output/structured.ts";
import { capsOf, disabledTools, enabledTools } from "./discover.ts";
import type { ToolContext } from "./context.ts";

export const runHealthTool = async (
  ctx: ToolContext,
  authRequired: boolean,
): Promise<ToolResult> => {
  const report = await buildReport(ctx, authRequired);

  const text = [
    `MCP ${report.status}, up ${report.uptimeSec}s.`,
    `Degoog ${report.degoog.reachable ? "reachable" : "unreachable"} at ${report.degoog.url}.`,
    `Degoog API key ${report.degoog.apiKeyConfigured ? "configured" : "not configured"}, inbound token ${report.auth.inboundTokenRequired ? "required" : "not required"}.`,
  ].join("\n");

  return toolResult(text, {
    ...report,
    healthy: report.status === HealthState.Ok,
    enabledTools: enabledTools(ctx),
    disabledTools: disabledTools(ctx),
    caps: capsOf(ctx),
  });
};
