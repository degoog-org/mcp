import { OutputMode } from "../config/schema.ts";

export const wantsText = (mode: OutputMode): boolean =>
  mode !== OutputMode.StructuredOnly;

export const wantsDebug = (mode: OutputMode): boolean =>
  mode === OutputMode.Full;

export const wantsDetail = (mode: OutputMode): boolean =>
  mode === OutputMode.Full || mode === OutputMode.Balanced;

export const withDebug = <T extends Record<string, unknown>>(
  mode: OutputMode,
  base: T,
  debug: Record<string, unknown>,
): T | (T & { debug: Record<string, unknown> }) =>
  wantsDebug(mode) ? { ...base, debug } : base;

export const textFor = (mode: OutputMode, lines: string[]): string =>
  wantsText(mode) ? lines.filter(Boolean).join("\n") : "";
