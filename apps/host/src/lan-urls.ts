import { fitLanUrls } from "@doriface/crypto";
import { networkInterfaces } from "node:os";
import { formatHost } from "./listen.ts";

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/** A dotted-quad whose four octets are each at most 255. */
const isIpv4 = (hostname: string): boolean =>
  IPV4.test(hostname) && hostname.split(".").every((octet) => Number(octet) <= 255);

/** The canonical form of an IPv6 literal (`::0` and `0:0::0` both become `::`), or undefined for anything else. */
function canonicalIpv6(hostname: string): string | undefined {
  const bare = hostname.replace(/^\[(.*)\]$/, "$1");
  if (!bare.includes(":") || !URL.canParse(`ws://[${bare}]/`)) return undefined;
  return new URL(`ws://[${bare}]/`).hostname.slice(1, -1);
}

const isLinkLocal = (ipv6: string): boolean => /^fe[89ab]/i.test(ipv6);

/** This machine's non-internal addresses, IPv4 first (link-local IPv6 needs a zone id, so it is left out). */
function interfaceAddresses(): string[] {
  const addresses = Object.values(networkInterfaces()).flatMap((entries) => entries ?? []);
  const usable = addresses.filter((entry) => !entry.internal && !isLinkLocal(entry.address));
  return [
    ...usable.filter((entry) => entry.family === "IPv4"),
    ...usable.filter((entry) => entry.family === "IPv6"),
  ].map((entry) => entry.address);
}

/** The addresses a client can dial for this bind: every interface for a wildcard, the literal itself, or none. */
function dialableHosts(hostname: string): string[] {
  if (isIpv4(hostname)) return hostname === "0.0.0.0" ? interfaceAddresses() : [hostname];
  const ipv6 = canonicalIpv6(hostname);
  if (ipv6 === undefined || isLinkLocal(ipv6)) return [];
  return ipv6 === "::" ? interfaceAddresses() : [ipv6];
}

/**
 * The `ws://<IP literal>:<port>/v1/e2ee` URLs a client can try directly: the bound address when it is a literal, every
 * interface address for a wildcard bind, nothing for a hostname (clients never resolve names on this path) or for a
 * link-local address (it needs a zone id). The list is cut to what fits message 2's 256-byte reply line.
 */
export function lanUrlsFor(hostname: string, port: number): readonly string[] {
  return fitLanUrls(dialableHosts(hostname).map((host) => `ws://${formatHost(host)}:${port}/v1/e2ee`));
}
