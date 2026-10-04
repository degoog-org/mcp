import { describe, expect, test } from "bun:test";
import { healthzUrl, probeHealth } from "../src/server/healthcheck.ts";
import { createSidecar, startServer } from "../src/server/http.ts";
import { makeCtx, mergeConfig } from "./helpers.ts";

describe("container healthcheck", () => {
  test("probes loopback when bound to every interface", () => {
    for (const host of ["", "0.0.0.0", "::"]) {
      expect(healthzUrl(mergeConfig({ server: { host, port: 5151 } }))).toBe(
        "http://127.0.0.1:5151/healthz",
      );
    }
  });

  test("probes the bind host when one is set", () => {
    expect(healthzUrl(mergeConfig({ server: { host: "10.0.0.5", port: 4443 } }))).toBe(
      "http://10.0.0.5:4443/healthz",
    );
    expect(healthzUrl(mergeConfig({ server: { host: "::1", port: 4443 } }))).toBe(
      "http://[::1]:4443/healthz",
    );
  });

  test("passes against a sidecar on a non default port and fails once it stops", async () => {
    const ctx = makeCtx("http://127.0.0.1:1", { server: { port: 0 } });
    const running = await startServer(await createSidecar(ctx), ctx.config);
    const config = mergeConfig({ server: { port: running.port } });

    expect(await probeHealth(config)).toBe(true);

    await running.stop();

    expect(await probeHealth(config)).toBe(false);
  });
});
