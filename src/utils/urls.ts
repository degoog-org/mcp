const TRACKING_PREFIXES = ["utm_", "ga_", "mc_", "pk_", "hsa_"];

const TRACKING_KEYS = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "msclkid",
  "igshid",
  "mkt_tok",
  "ref",
  "ref_src",
  "referrer",
  "spm",
  "yclid",
  "_hsenc",
  "_hsmi",
]);

export const isHttpUrl = (raw: string): URL | null => {
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
};

const stripTracking = (url: URL): void => {
  for (const key of [...url.searchParams.keys()]) {
    const lower = key.toLowerCase();
    if (TRACKING_KEYS.has(lower) || TRACKING_PREFIXES.some((p) => lower.startsWith(p))) {
      url.searchParams.delete(key);
    }
  }
};

export const canonicalUrl = (raw: string): string => {
  const url = isHttpUrl(raw);
  if (!url) return raw.trim();

  url.hash = "";
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  stripTracking(url);
  url.searchParams.sort();

  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }
  if (
    (url.protocol === "http:" && url.port === "80") ||
    (url.protocol === "https:" && url.port === "443")
  ) {
    url.port = "";
  }

  return url.toString();
};

export const domainOf = (raw: string): string => {
  const url = isHttpUrl(raw);
  return url ? url.hostname.replace(/^www\./, "") : "";
};

export const rootDomain = (raw: string): string => {
  const host = domainOf(raw);
  const parts = host.split(".");
  return parts.length > 2 ? parts.slice(-2).join(".") : host;
};

export const pathDepth = (raw: string): number => {
  const url = isHttpUrl(raw);
  if (!url) return 0;
  return url.pathname.split("/").filter(Boolean).length;
};
