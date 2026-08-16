import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isHttpUrl } from "../utils/urls.ts";

export enum BlockReason {
  BadScheme = "url must use http or https",
  BadUrl = "url could not be parsed",
  NoDns = "hostname did not resolve",
  PrivateIp = "hostname resolves to a private or local address",
}

export interface HostCheck {
  ok: boolean;
  reason?: BlockReason;
  detail?: string;
  addresses: string[];
}

const privateV4 = (address: string): boolean => {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return true;

  const [a = 0, b = 0, c = 0] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
  if (a === 192 && b === 88 && c === 99) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;

  return false;
};

const privateV6 = (address: string): boolean => {
  const lower = address.toLowerCase().split("%")[0] ?? "";
  if (lower === "::" || lower === "::1") return true;
  if (lower.startsWith("fe80") || lower.startsWith("fc") || lower.startsWith("fd")) {
    return true;
  }
  if (lower.startsWith("ff")) return true;
  if (lower.startsWith("::ffff:")) {
    const mapped = lower.slice(7);
    return isIP(mapped) === 4 ? privateV4(mapped) : true;
  }
  return false;
};

export const isPrivateIp = (address: string): boolean => {
  const family = isIP(address);
  if (family === 4) return privateV4(address);
  if (family === 6) return privateV6(address);
  return true;
};

export const resolveHost = async (hostname: string): Promise<string[]> => {
  if (isIP(hostname)) return [hostname];
  const entries = await lookup(hostname, { all: true, verbatim: true });
  return entries.map((entry) => entry.address);
};

const noDns = (hostname: string): string =>
  `${hostname} did not resolve, DNS lookup failed`;

const blockedIp = (hostname: string, addresses: string[]): string =>
  `${hostname} resolves to a private or local address (${addresses.join(", ")}), blocked by the sidecar SSRF guard. Set scrape.allowPrivateIps in mcp.yml only if you meant to reach an internal host.`;

export const checkHost = async (
  raw: string,
  allowPrivateIps: boolean,
): Promise<HostCheck> => {
  const url = isHttpUrl(raw);
  if (!url) {
    const reason = raw.includes("://")
      ? BlockReason.BadScheme
      : BlockReason.BadUrl;
    return { ok: false, reason, detail: reason, addresses: [] };
  }
  if (allowPrivateIps) return { ok: true, addresses: [] };

  let addresses: string[] = [];
  try {
    addresses = await resolveHost(url.hostname);
  } catch {
    return { ok: false, reason: BlockReason.NoDns, detail: noDns(url.hostname), addresses: [] };
  }

  if (!addresses.length) {
    return { ok: false, reason: BlockReason.NoDns, detail: noDns(url.hostname), addresses };
  }

  const blocked = addresses.filter(isPrivateIp);
  if (blocked.length) {
    return {
      ok: false,
      reason: BlockReason.PrivateIp,
      detail: blockedIp(url.hostname, blocked),
      addresses,
    };
  }

  return { ok: true, addresses };
};
