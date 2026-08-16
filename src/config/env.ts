export enum EnvVar {
  ConfigPath = "DEGOOG_MCP_CONFIG",
  AuthToken = "DEGOOG_MCP_AUTH_TOKEN",
  DegoogApiKey = "DEGOOG_MCP_DEGOOG_API_KEY",
  DegoogUrl = "DEGOOG_MCP_DEGOOG_URL",
  Port = "DEGOOG_MCP_PORT",
  BindHost = "DEGOOG_MCP_BIND_HOST",
  LogLevel = "DEGOOG_MCP_LOG_LEVEL",
  UserAgent = "DEGOOG_MCP_USER_AGENT",
}

export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export const readEnv = (name: string): string => (process.env[name] ?? "").trim();

export const secretFrom = (envName: string): string =>
  envName ? readEnv(envName) : "";

export const userAgent = (): string =>
  readEnv(EnvVar.UserAgent) || DEFAULT_USER_AGENT;
