import { describe, expect, test } from "bun:test";
import { briefError, fetchPage } from "../src/scrape/fetch.ts";
import { BlockReason, checkHost, isPrivateIp, resolveHost } from "../src/scrape/safety.ts";
import { pageHtml, serveFake } from "./helpers.ts";

const OPEN = { timeoutMs: 5000, maxResponseBytes: 1_000_000, allowPrivateIps: true };
const GUARDED = { ...OPEN, allowPrivateIps: false };

describe("private address detection", () => {
  test("blocks loopback, link local, rfc1918, cgnat and multicast", () => {
    for (const address of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "::1",
      "fe80::1",
      "fd00::1",
      "::ffff:127.0.0.1",
    ]) {
      expect(isPrivateIp(address)).toBe(true);
    }
  });

  test("allows ordinary public addresses", () => {
    expect(isPrivateIp("8.8.8.8")).toBe(false);
    expect(isPrivateIp("172.32.0.1")).toBe(false);
    expect(isPrivateIp("2606:4700:4700::1111")).toBe(false);
  });

  test("only the reserved slices of 192.0 are blocked, not the whole 192.0.0.0/16", () => {
    expect(isPrivateIp("192.0.0.8")).toBe(true);
    expect(isPrivateIp("192.0.2.1")).toBe(true);
    expect(isPrivateIp("192.88.99.1")).toBe(true);
    expect(isPrivateIp("192.0.66.177")).toBe(false);
    expect(isPrivateIp("192.0.78.24")).toBe(false);
  });

  test("blocks the documentation and benchmark ranges", () => {
    expect(isPrivateIp("198.18.0.1")).toBe(true);
    expect(isPrivateIp("198.51.100.7")).toBe(true);
    expect(isPrivateIp("203.0.113.9")).toBe(true);
    expect(isPrivateIp("198.20.0.1")).toBe(false);
    expect(isPrivateIp("203.0.114.9")).toBe(false);
  });

  test("treats unparsable values as private", () => {
    expect(isPrivateIp("not-an-ip")).toBe(true);
    expect(isPrivateIp("999.1.1.1")).toBe(true);
  });
});

describe("host checks", () => {
  test("rejects non http(s) schemes and junk urls", async () => {
    expect((await checkHost("ftp://example.com", false)).reason).toBe(BlockReason.BadScheme);
    expect((await checkHost("not a url", false)).reason).toBe(BlockReason.BadUrl);
  });

  test("rejects hosts that resolve to loopback", async () => {
    const check = await checkHost("http://127.0.0.1:9999/page", false);
    expect(check.ok).toBe(false);
    expect(check.reason).toBe(BlockReason.PrivateIp);
  });

  test("keeps fetch errors short instead of echoing runtime advice", () => {
    expect(
      briefError(
        new Error(
          "The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()",
        ),
      ),
    ).toBe("The socket connection was closed unexpectedly.");
    expect(briefError("not an error")).toBe("fetch failed");
  });

  test("names the offending address and the setting that would allow it", async () => {
    const check = await checkHost("http://127.0.0.1:9999/page", false);

    expect(check.detail).toContain("127.0.0.1");
    expect(check.detail).toContain("SSRF guard");
    expect(check.detail).toContain("scrape.allowPrivateIps");
  });

  test("rejects hostnames that do not resolve", async () => {
    const check = await checkHost("http://nope.invalid/page", false);
    expect(check.ok).toBe(false);
    expect(check.reason).toBe(BlockReason.NoDns);
  });

  test("skips resolution when private addresses are explicitly allowed", async () => {
    const check = await checkHost("http://127.0.0.1:9999/page", true);
    expect(check.ok).toBe(true);
    expect(check.addresses).toEqual([]);
  });

  test("ip literals resolve to themselves", async () => {
    expect(await resolveHost("8.8.8.8")).toEqual(["8.8.8.8"]);
  });
});

describe("fetch guards", () => {
  test("rechecks the scheme of every redirect target", async () => {
    const server = serveFake((_request, url) =>
      url.pathname === "/redirect"
        ? new Response(null, { status: 302, headers: { location: "ftp://elsewhere.example/x" } })
        : new Response("should not be reached"),
    );

    const outcome = await fetchPage(`${server.url}/redirect`, OPEN);
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBe(BlockReason.BadScheme);
    expect(outcome.url).toBe("ftp://elsewhere.example/x");

    await server.stop();
  });

  test("blocks private destinations before any request is made", async () => {
    const server = serveFake(() => new Response("should not be reached"));

    const outcome = await fetchPage(`${server.url}/page`, GUARDED);
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain("resolves to a private or local address");
    expect(outcome.error).toContain("127.0.0.1");
    expect(outcome.error).toContain("allowPrivateIps");
    expect(server.hits).toEqual([]);

    await server.stop();
  });

  test("follows allowed redirects and records the hops", async () => {
    const server = serveFake((_request, url) => {
      if (url.pathname === "/start") {
        return new Response(null, { status: 301, headers: { location: "/final" } });
      }
      return new Response(pageHtml("Final", ["Body text that is long enough to matter."]), {
        headers: { "content-type": "text/html" },
      });
    });

    const outcome = await fetchPage(`${server.url}/start`, OPEN);
    expect(outcome.ok).toBe(true);
    expect(outcome.url).toBe(`${server.url}/final`);
    expect(outcome.redirects).toEqual([`${server.url}/final`]);

    await server.stop();
  });

  test("stops after too many redirects", async () => {
    const server = serveFake(() =>
      new Response(null, { status: 302, headers: { location: "/loop" } }),
    );

    const outcome = await fetchPage(`${server.url}/loop`, OPEN);
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBe("too many redirects");

    await server.stop();
  });

  test("rejects non textual content types", async () => {
    const server = serveFake(
      () => new Response("binary", { headers: { "content-type": "application/pdf" } }),
    );

    const outcome = await fetchPage(`${server.url}/file.pdf`, OPEN);
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain("unsupported content type");

    await server.stop();
  });

  test("reports upstream http failures", async () => {
    const server = serveFake(() => new Response("gone", { status: 404 }));

    const outcome = await fetchPage(`${server.url}/missing`, OPEN);
    expect(outcome.ok).toBe(false);
    expect(outcome.status).toBe(404);
    expect(outcome.error).toBe("HTTP 404");

    await server.stop();
  });

  test("caps the response body", async () => {
    const server = serveFake(
      () =>
        new Response("x".repeat(50_000), { headers: { "content-type": "text/html" } }),
    );

    const outcome = await fetchPage(`${server.url}/big`, { ...OPEN, maxResponseBytes: 1024 });
    expect(outcome.truncated).toBe(true);
    expect(outcome.bytes).toBeLessThanOrEqual(1024);
    expect(outcome.html.length).toBeLessThanOrEqual(1024);

    await server.stop();
  });

  test("times out slow responses without hanging", async () => {
    const server = serveFake(
      () =>
        new Promise<Response>((resolve) => {
          setTimeout(() => resolve(new Response("late")), 500);
        }),
    );

    const outcome = await fetchPage(`${server.url}/slow`, { ...OPEN, timeoutMs: 60 });
    expect(outcome.ok).toBe(false);

    await server.stop();
  });
});
