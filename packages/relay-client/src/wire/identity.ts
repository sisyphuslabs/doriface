/** Host identity and the relay's challenge-response, shared by the relay and the host uplink. */

const BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
const encoder = new TextEncoder();

export const SIGN_PUB_BYTES = 32;
export const SIGNATURE_BYTES = 64;
export const CHALLENGE_BYTES = 32;
export const AUTH_ANSWER_BYTES = SIGN_PUB_BYTES + SIGNATURE_BYTES;
export const AUTH_CONTEXT = "doriface-relay-v1";
/** 16 bytes of SHA-256 as unpadded lowercase base32. */
export const HOST_ID_PATTERN = /^[a-z2-7]{26}$/;

/** RFC 4648 base32, lowercase, no padding. */
export function base32(bytes: Uint8Array): string {
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32_ALPHABET[(buffer >>> bits) & 31];
    }
    buffer &= (1 << bits) - 1;
  }
  if (bits > 0) out += BASE32_ALPHABET[(buffer << (5 - bits)) & 31];
  return out;
}

export async function hostIdOf(signPub: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", signPub));
  return base32(digest.subarray(0, 16));
}

/**
 * The relay origin both ends sign over (contract v1.2 C4): `wss://host[:port]` of the URL the host dialed, with the
 * default port omitted. `http(s)` URLs map to `ws(s)`, so a host and a relay on plain HTTP agree too.
 */
export function relayOriginOf(url: string): string {
  const parsed = new URL(url);
  const secure = parsed.protocol === "https:" || parsed.protocol === "wss:";
  if (!secure && parsed.protocol !== "http:" && parsed.protocol !== "ws:") {
    throw new Error(`relay URL must be http(s) or ws(s): ${url}`);
  }
  return `${secure ? "wss" : "ws"}://${parsed.host}`;
}

/** The bytes a host signs: `"doriface-relay-v1" || relayOrigin || hostId || challenge`, strings as ASCII. */
export function authMessage(relayOrigin: string, hostId: string, challenge: Uint8Array): Uint8Array<ArrayBuffer> {
  const prefix = encoder.encode(`${AUTH_CONTEXT}${relayOrigin}${hostId}`);
  const out = new Uint8Array(prefix.byteLength + challenge.byteLength);
  out.set(prefix, 0);
  out.set(challenge, prefix.byteLength);
  return out;
}

/** The host's answer to a challenge: `signPub(32) || signature(64)`. */
export function encodeAuthAnswer(signPub: Uint8Array, signature: Uint8Array): Uint8Array<ArrayBuffer> {
  if (signPub.byteLength !== SIGN_PUB_BYTES || signature.byteLength !== SIGNATURE_BYTES) {
    throw new RangeError(`auth answer wants a ${SIGN_PUB_BYTES}-byte key and a ${SIGNATURE_BYTES}-byte signature`);
  }
  const out = new Uint8Array(AUTH_ANSWER_BYTES);
  out.set(signPub, 0);
  out.set(signature, SIGN_PUB_BYTES);
  return out;
}
