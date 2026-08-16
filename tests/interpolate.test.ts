import { describe, expect, test } from "bun:test";
import { expandEnvDeep, expandEnvVars } from "../src/config/interpolate.ts";

describe("expandEnvVars", () => {
  const env = {
    TOKEN: "sk-live",
    EMPTY: "",
    PORT: "4443",
  };

  test("replaces ${VAR}", () => {
    expect(expandEnvVars("Bearer ${TOKEN}", env)).toBe("Bearer sk-live");
  });

  test("uses ${VAR:-default} when unset or empty", () => {
    expect(expandEnvVars("${MISSING:-fallback}", env)).toBe("fallback");
    expect(expandEnvVars("${EMPTY:-fallback}", env)).toBe("fallback");
    expect(expandEnvVars("${TOKEN:-fallback}", env)).toBe("sk-live");
  });

  test("unset ${VAR} becomes empty", () => {
    expect(expandEnvVars("key=${MISSING}", env)).toBe("key=");
  });

  test("$$ is a literal dollar", () => {
    expect(expandEnvVars("cost $$5 and $${TOKEN}", env)).toBe(
      "cost $5 and ${TOKEN}",
    );
  });

  test("does not expand $VAR without braces", () => {
    expect(expandEnvVars("pass=$TOKEN", env)).toBe("pass=$TOKEN");
  });
});

describe("expandEnvDeep", () => {
  test("walks strings in objects and arrays", () => {
    const env = { KEY: "secret", HOST: "gpu" };
    expect(
      expandEnvDeep(
        {
          apiKey: "${KEY}",
          nested: { baseUrl: "http://${HOST}:11434" },
          tags: ["${KEY}", 1],
        },
        env,
      ),
    ).toEqual({
      apiKey: "secret",
      nested: { baseUrl: "http://gpu:11434" },
      tags: ["secret", 1],
    });
  });
});
