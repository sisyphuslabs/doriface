/**
 * The rate-limit and eviction key for a connecting address: IPv4 per address, IPv6 per /64, because one IPv6
 * subscriber usually holds a whole /64 and could otherwise mint a fresh bucket per address. Anything that does not
 * parse is keyed as given.
 */
export function sourceKey(address: string): string {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address)?.[1];
  if (mapped !== undefined) return mapped;
  if (!address.includes(":")) return address;
  const groups = ipv6Groups(address.split("%")[0] ?? "");
  return groups === undefined ? address : `${groups.slice(0, 4).join(":")}::/64`;
}

const HEXTET = /^[0-9a-f]{1,4}$/i;

function ipv4Hextets(part: string): string[] | undefined {
  const digits = part.split(".");
  if (digits.length !== 4 || !digits.every((octet) => /^\d{1,3}$/.test(octet))) return undefined;
  const octets = digits.map(Number);
  if (!octets.every((octet) => octet <= 255)) return undefined;
  const [a = 0, b = 0, c = 0, d = 0] = octets;
  return [((a << 8) | b).toString(16), ((c << 8) | d).toString(16)];
}

function hextets(text: string): string[] | undefined {
  if (text === "") return [];
  const parts = text.split(":");
  const last = parts.at(-1) ?? "";
  const tail = last.includes(".") ? ipv4Hextets(last) : [last];
  if (tail === undefined) return undefined;
  const all = [...parts.slice(0, -1), ...tail];
  return all.every((part) => HEXTET.test(part)) ? all : undefined;
}

/** The 8 groups of an IPv6 address, lowercase without leading zeros, or undefined when it does not parse. */
function ipv6Groups(address: string): string[] | undefined {
  const halves = address.split("::");
  if (halves.length > 2) return undefined;
  const head = hextets(halves[0] ?? "");
  const tail = halves.length === 2 ? hextets(halves[1] ?? "") : [];
  if (head === undefined || tail === undefined) return undefined;
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return undefined;
  const zeros = Array.from({ length: missing }, () => "0");
  return [...head, ...zeros, ...tail].map((group) => Number.parseInt(group, 16).toString(16));
}
