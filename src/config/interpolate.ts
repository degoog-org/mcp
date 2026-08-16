export type EnvLookup = { [key: string]: string | undefined };

const TOKEN = /\$\$|\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;

export const expandEnvVars = (
  value: string,
  env: EnvLookup = process.env,
): string =>
  value.replace(
    TOKEN,
    (match: string, name: string | undefined, fallback: string | undefined): string => {
      if (match === "$$") return "$";
      if (!name) return match;
      const found = env[name];
      if (found === undefined || found === "") return fallback ?? "";
      return found;
    },
  );

export const expandEnvDeep = (
  value: unknown,
  env: EnvLookup = process.env,
): unknown => {
  if (typeof value === "string") return expandEnvVars(value, env);
  if (Array.isArray(value)) return value.map((item) => expandEnvDeep(item, env));
  if (!value || typeof value !== "object") return value;

  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    out[key] = expandEnvDeep(nested, env);
  }
  return out;
};
