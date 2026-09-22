import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";

export type Resolver = (host: string) => Promise<{ address: string; family: number }[]>;
export const systemResolver: Resolver = (host) => lookup(host, { all: true, verbatim: true });

export function isPublicAddress(address: string): boolean {
  try {
    // IPv4-mapped IPv6 must be checked as IPv4; reserved, multicast, link-local,
    // loopback, carrier NAT and unique-local ranges never pass.
    return ipaddr.process(address).range() === "unicast";
  } catch { return false; }
}

export function parseTarget(raw: string): URL {
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      (url.port && !["80", "443"].includes(url.port))) throw new Error("Disallowed target");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.includes("%")) {
    throw new Error("Local targets are not allowed");
  }
  return url;
}

export async function resolvePublicTarget(raw: string, resolve: Resolver = systemResolver) {
  const url = parseTarget(raw);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = ipaddr.isValid(host)
    ? [{ address: host, family: ipaddr.parse(host).kind() === "ipv4" ? 4 : 6 }]
    : await resolve(host);
  if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address))) {
    throw new Error("Target resolves to a private or reserved network");
  }
  return { url, address: addresses[0]!.address, family: addresses[0]!.family };
}
