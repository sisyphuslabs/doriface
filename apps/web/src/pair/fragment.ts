import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { normalizeCode } from "./code.ts";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

/** RFC 4648 base32, lowercase, no padding. */
export function base32(bytes: Uint8Array): string {
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(buffer >> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(buffer << (5 - bits)) & 31];
  return out;
}

export function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** hostId = base32(SHA-256(signPub)[0..16]): 26 characters. */
export function hostIdOf(signPub: Uint8Array): string {
  return base32(sha256(signPub).subarray(0, 16));
}

/** The fingerprint people compare: SHA-256(noiseStaticPub)[0..20] as uppercase hex, 10 groups of 4. */
export function fingerprintOf(noiseStaticPub: Uint8Array): string {
  const hex = bytesToHex(sha256(noiseStaticPub).subarray(0, 20)).toUpperCase();
  return hex.match(/.{4}/g)?.join(" ") ?? hex;
}

export interface PairingOffer {
  readonly hostId: string;
  readonly noiseStaticPub: Uint8Array;
  readonly signPub: Uint8Array;
  readonly code: string;
  readonly relayUrl: string;
  readonly fingerprint: string;
}

export type PairingParse =
  | { readonly ok: true; readonly offer: PairingOffer }
  | { readonly ok: false; readonly reason: string };

/** Parses `#h=&k=&s=&c=&r=` and checks that hostId belongs to the signing key it came with. */
export function parsePairingFragment(hash: string): PairingParse {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const hostId = params.get("h") ?? "";
  const noiseStaticPub = fromBase64Url(params.get("k") ?? "");
  const signPub = fromBase64Url(params.get("s") ?? "");
  const code = normalizeCode(params.get("c") ?? "");
  const relayUrl = params.get("r") ?? "";
  if (noiseStaticPub === null || signPub === null) return { ok: false, reason: "The host's keys are missing." };
  if (code === null) return { ok: false, reason: "The pairing code is malformed." };
  if (!/^wss?:\/\//.test(relayUrl)) return { ok: false, reason: "The relay address is not a WebSocket URL." };
  return offerFrom({ hostId, noiseStaticPub, signPub }, code, relayUrl);
}

export interface HostKeys {
  readonly hostId: string;
  readonly noiseStaticPub: Uint8Array;
  readonly signPub: Uint8Array;
}

/** Checks that hostId belongs to the signing key, then attaches the fingerprint to show. */
export function offerFrom(keys: HostKeys, code: string, relayUrl: string): PairingParse {
  if (keys.noiseStaticPub.byteLength !== 32 || keys.signPub.byteLength !== 32) {
    return { ok: false, reason: "The host's keys are malformed." };
  }
  if (hostIdOf(keys.signPub) !== keys.hostId)
    return { ok: false, reason: "The host ID does not match its signing key." };
  return { ok: true, offer: { ...keys, code, relayUrl, fingerprint: fingerprintOf(keys.noiseStaticPub) } };
}
