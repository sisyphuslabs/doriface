import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base64urlDecode, base64urlEncode, utf8 } from "./encoding.ts";
import { hostIdOf } from "./identity.ts";

export const PAIRING_TTL_MS = 10 * 60 * 1000;
export const DEFAULT_RELAY_URL = "https://relay-doriface.omo.dev";
const MAX_DEVICE_NAME = 64;
/** Crockford base32: no I, L, O or U. */
export const PAIRING_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const PAIRING_CODE_LENGTH = 8;
/** The leading characters that name the relay pairing slot; the rest is the secret. */
export const PAIRING_SLOT_LENGTH = 3;
/** Failed handshakes after which the host burns a code. */
export const MAX_PAIRING_FAILURES = 3;

/** 8 Crockford base32 characters; each byte's low 5 bits pick one, so every character is uniform. */
export function generatePairingCode(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(PAIRING_CODE_LENGTH)), (byte) =>
    PAIRING_ALPHABET.charAt(byte & 31),
  ).join("");
}

/**
 * The canonical form of a typed code: uppercase, separators dropped, and Crockford's look-alikes mapped (O to 0,
 * I and L to 1). Throws unless 8 alphabet characters remain.
 */
export function normalizePairingCode(input: string): string {
  const code = input.toUpperCase().replaceAll(/[\s-]/g, "").replaceAll("O", "0").replaceAll(/[IL]/g, "1");
  if (code.length !== PAIRING_CODE_LENGTH || [...code].some((char) => !PAIRING_ALPHABET.includes(char))) {
    throw new Error(`a pairing code is ${PAIRING_CODE_LENGTH} characters of ${PAIRING_ALPHABET}`);
  }
  return code;
}

/** `XXXX XXXX`, the way people read and type it. */
export const formatPairingCode = (code: string): string => {
  const canonical = normalizePairingCode(code);
  return `${canonical.slice(0, 4)} ${canonical.slice(4)}`;
};

/** The relay pairing slot: the code's first 3 characters. */
export const pairingSlotOf = (code: string): string => normalizePairingCode(code).slice(0, PAIRING_SLOT_LENGTH);

/** psk = HKDF-SHA256(ikm = UTF-8 of all 8 code characters, salt = empty, info = "doriface pair v1", 32 bytes). */
export const pairingPsk = (code: string): Uint8Array =>
  hkdf(sha256, utf8(normalizePairingCode(code)), new Uint8Array(0), utf8("doriface pair v1"), 32);

export interface PairingOffer {
  readonly code: string;
  /** Milliseconds since the epoch. */
  readonly expiresAt: number;
}

export const createPairingOffer = (now = Date.now()): PairingOffer => ({
  code: generatePairingCode(),
  expiresAt: now + PAIRING_TTL_MS,
});

export type PairingGuardState = "open" | "claimed" | "used" | "burned";

/**
 * One offer's single-use lifecycle on the host. A handshake claims it, so a concurrent second attempt is refused,
 * then either uses it up on success or counts a failure and reopens it; the third failure burns it. An expired offer
 * never yields a psk.
 */
export class PairingGuard {
  readonly offer: PairingOffer;
  #state: PairingGuardState = "open";
  #failures: number;

  constructor(offer: PairingOffer, failures = 0) {
    this.offer = offer;
    this.#failures = failures;
    if (failures >= MAX_PAIRING_FAILURES) this.#state = "burned";
  }

  get state(): PairingGuardState {
    return this.#state;
  }

  get failures(): number {
    return this.#failures;
  }

  claim(now = Date.now()): Uint8Array | undefined {
    if (this.#state !== "open" || now >= this.offer.expiresAt) return undefined;
    this.#state = "claimed";
    return pairingPsk(this.offer.code);
  }

  /** The claimed handshake failed: reopen the code, or burn it on the third failure. */
  fail(): void {
    if (this.#state !== "claimed") return;
    this.#failures++;
    this.#state = this.#failures >= MAX_PAIRING_FAILURES ? "burned" : "open";
  }

  use(): void {
    this.#state = "used";
  }
}

/** Message 1's payload for the pairing session: UTF-8 JSON `{"name": "<device name>"}`. */
export const encodePairingHello = (name: string): Uint8Array => utf8(JSON.stringify({ name: deviceName(name) }));

export function decodePairingHello(payload: Uint8Array): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload));
  } catch (error) {
    throw new Error("the pairing hello is not UTF-8 JSON", { cause: error });
  }
  if (typeof parsed !== "object" || parsed === null || !("name" in parsed) || typeof parsed.name !== "string") {
    throw new Error('the pairing hello must be {"name": string}');
  }
  return deviceName(parsed.name);
}

function deviceName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === "" || trimmed.length > MAX_DEVICE_NAME)
    throw new Error(`a device name is 1-${MAX_DEVICE_NAME} characters`);
  return trimmed;
}

export interface PairingLink {
  readonly webOrigin: string;
  readonly hostId: string;
  readonly noiseStaticPub: Uint8Array;
  readonly signPub: Uint8Array;
  readonly code: string;
  readonly relayUrl: string;
}

/** `<web origin>/pair#h=…&k=…&s=…&c=…&r=…`; everything sits in the fragment, which never reaches a server. */
export function buildPairingUrl(link: PairingLink): string {
  const fragment = new URLSearchParams({
    h: link.hostId,
    k: base64urlEncode(link.noiseStaticPub),
    s: base64urlEncode(link.signPub),
    c: link.code,
    r: link.relayUrl,
  });
  return `${new URL(link.webOrigin).origin}/pair#${fragment.toString()}`;
}

/** Parses and checks a pairing URL: key lengths, the code's shape, and that `h` is the hostId of `s`. */
export function parsePairingUrl(url: string): PairingLink {
  const parsed = new URL(url);
  const fragment = new URLSearchParams(parsed.hash.slice(1));
  const get = (key: string): string => {
    const value = fragment.get(key);
    if (value === null || value === "") throw new Error(`the pairing URL lacks ${key}=`);
    return value;
  };
  const noiseStaticPub = base64urlDecode(get("k"));
  const signPub = base64urlDecode(get("s"));
  if (noiseStaticPub.byteLength !== 32 || signPub.byteLength !== 32) throw new Error("the pairing URL has a bad key");
  const hostId = get("h");
  if (hostIdOf(signPub) !== hostId) throw new Error("the pairing URL's hostId does not match its signing key");
  const code = normalizePairingCode(get("c"));
  const relayUrl = get("r");
  if (!URL.canParse(relayUrl)) throw new Error("the pairing URL's relay is not a URL");
  return { webOrigin: parsed.origin, hostId, noiseStaticPub, signPub, code, relayUrl };
}
