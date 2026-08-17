import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG } from "../src/config/defaults.ts";
import { BUN_MAX_IDLE_SECONDS, idleSeconds } from "../src/server/http.ts";
import { TimeoutError, withDeadline, withTimeLimit } from "../src/utils/timeout.ts";

const never = (signal: AbortSignal): Promise<never> =>
  new Promise((_, reject) => {
    if (signal.aborted) return reject(signal.reason);
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });

const forever = (): Promise<never> => new Promise(() => undefined);

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe("withDeadline", () => {
  test("returns the value when the run finishes in time", async () => {
    const value = await withDeadline(1000, async () => "done");
    expect(value).toBe("done");
  });

  test("aborts the inner signal once the deadline passes", async () => {
    const run = withDeadline(30, (signal) => never(signal));
    await expect(run).rejects.toBeInstanceOf(TimeoutError);
  });

  test("an outer abort reaches the inner signal", async () => {
    const outer = new AbortController();
    const run = withDeadline(5000, (signal) => never(signal), outer.signal);

    outer.abort(new Error("caller left"));
    await expect(run).rejects.toThrow("caller left");
  });

  test("an already aborted outer signal aborts immediately", async () => {
    const outer = AbortSignal.abort(new Error("gone before we started"));
    const run = withDeadline(5000, (signal) => never(signal), outer);

    await expect(run).rejects.toThrow("gone before we started");
  });
});

describe("withTimeLimit", () => {
  test("returns the value when the run finishes in time", async () => {
    const value = await withTimeLimit(1000, "bundle_search", async () => 42);
    expect(value).toBe(42);
  });

  test("rejects on time even when the run ignores its signal", async () => {
    const run = withTimeLimit(30, "bundle_search", forever);
    await expect(run).rejects.toBeInstanceOf(TimeoutError);
  });

  test("the timeout message names the label and the milliseconds", async () => {
    const run = withTimeLimit(30, "deep_search", forever);
    await expect(run).rejects.toThrow("deep_search timed out after 30ms");
  });

  test("an outer abort wins over the deadline", async () => {
    const outer = new AbortController();
    const run = withTimeLimit(5000, "bundle_search", forever, outer.signal);

    outer.abort(new Error("caller left"));
    await expect(run).rejects.toThrow("caller left");
  });

  test("an already aborted outer signal rejects immediately", async () => {
    const outer = AbortSignal.abort(new Error("gone before we started"));
    const run = withTimeLimit(5000, "bundle_search", forever, outer);

    await expect(run).rejects.toThrow("gone before we started");
  });

  test("a late rejection from an abandoned run stays unhandled-free", async () => {
    const run = withTimeLimit(20, "bundle_search", async (signal) => {
      await wait(60);
      throw signal.aborted ? new Error("late boom") : new Error("early boom");
    });

    await expect(run).rejects.toBeInstanceOf(TimeoutError);
    await wait(80);
  });
});

describe("bun idle timeout clamp", () => {
  test("milliseconds become whole seconds", () => {
    expect(idleSeconds(255000)).toBe(255);
    expect(idleSeconds(120000)).toBe(120);
  });

  test("the shipped default survives the clamp untouched", () => {
    expect(idleSeconds(DEFAULT_CONFIG.server.idleTimeout)).toBe(
      DEFAULT_CONFIG.server.idleTimeout / 1000,
    );
  });

  test("partial seconds round up", () => {
    expect(idleSeconds(1500)).toBe(2);
  });

  test("anything under a second still gets a second", () => {
    expect(idleSeconds(1)).toBe(1);
  });

  test("bun's 255 second ceiling is respected", () => {
    expect(idleSeconds(600000)).toBe(BUN_MAX_IDLE_SECONDS);
    expect(BUN_MAX_IDLE_SECONDS).toBe(255);
  });
});
