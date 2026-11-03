import { fitLanUrls } from "@doriface/crypto";
import { networkInterfaces } from "node:os";
import { formatHost } from "./listen.ts";

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

const isWildcard = (hostname: string): boolean => hostname === "0.0.0.0" || hostname === "::";

/** This machine's non-internal addresses, IPv4 first (link-local IPv6 needs a zone id, so it is left out). */
function interfaceAddresses(): string[] {
  const addresses = Object.values(networkInterfaces()).flatMap((entries) => entries ?? []);
  const usable = addresses.filter((entry) => !entry.internal && !entry.address.toLowerCase().startsWith("fe80:"));
  return [
    ...usable.filter((entry) => entry.family === "IPv4"),
    ...usable.filter((entry) => entry.family === "IPv6"),
  ].map((entry) => entry.address);
}

/**
 * The `ws://<IP literal>:<port>/v1/e2ee` URLs a client can try directly: the bound address when it is a literal, every
 * interface address for a wildcard bind, nothing for a hostname (clients never resolve names on this path). The list is
 * cut to what fits message 2's 256-byte reply line.
 */
export function lanUrlsFor(hostname: string, port: number): readonly string[] {
  const literal = IPV4.test(hostname) || hostname.includes(":");
  const hosts = isWildcard(hostname) ? interfaceAddresses() : literal ? [hostname] : [];
  return fitLanUrls(hosts.map((host) => `ws://${formatHost(host)}:${port}/v1/e2ee`));
}
