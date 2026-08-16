const SECRET_HINTS = [
  "authorization",
  "api_key",
  "apikey",
  "token",
  "secret",
  "password",
];

export const maskSecret = (value: string): string => {
  if (!value) return "";
  if (value.length <= 8) return "***";
  return `${value.slice(0, 3)}***${value.slice(-2)}`;
};

export const looksSecret = (key: string): boolean => {
  const lower = key.toLowerCase();
  return SECRET_HINTS.some((hint) => lower.includes(hint));
};

export const redactUrl = (raw: string): string => {
  try {
    const url = new URL(raw);
    url.username = "";
    url.password = "";
    for (const key of [...url.searchParams.keys()]) {
      if (looksSecret(key)) url.searchParams.set(key, "***");
    }
    return url.toString();
  } catch {
    return raw;
  }
};

export const shortQuery = (query: string, max = 48): string =>
  query.length > max ? `${query.slice(0, max)}...` : query;
