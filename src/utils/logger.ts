import { EnvVar, readEnv } from "../config/env.ts";

export enum LogLevel {
  Debug = "debug",
  Info = "info",
  Warn = "warn",
  Error = "error",
  Silent = "silent",
}

const RANKS: Record<LogLevel, number> = {
  [LogLevel.Debug]: 10,
  [LogLevel.Info]: 20,
  [LogLevel.Warn]: 30,
  [LogLevel.Error]: 40,
  [LogLevel.Silent]: 99,
};

const isLevel = (value: string): value is LogLevel =>
  Object.values(LogLevel).includes(value as LogLevel);

const currentLevel = (): LogLevel => {
  const raw = readEnv(EnvVar.LogLevel).toLowerCase();
  return isLevel(raw) ? raw : LogLevel.Info;
};

const stamp = (): string => new Date().toISOString();

const emit = (
  level: LogLevel,
  namespace: string,
  message: string,
  extra?: unknown,
): void => {
  if (RANKS[level] < RANKS[currentLevel()]) return;
  const line = `${stamp()} ${level.toUpperCase()} [${namespace}] ${message}`;
  const sink = level === LogLevel.Error ? console.error : console.log;
  if (extra === undefined) sink(line);
  else sink(line, extra instanceof Error ? extra.message : extra);
};

export const logger = {
  debug: (namespace: string, message: string, extra?: unknown) =>
    emit(LogLevel.Debug, namespace, message, extra),
  info: (namespace: string, message: string, extra?: unknown) =>
    emit(LogLevel.Info, namespace, message, extra),
  warn: (namespace: string, message: string, extra?: unknown) =>
    emit(LogLevel.Warn, namespace, message, extra),
  error: (namespace: string, message: string, extra?: unknown) =>
    emit(LogLevel.Error, namespace, message, extra),
};
