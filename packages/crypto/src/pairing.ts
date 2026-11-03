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
  if (input.length > 4 * PAIRING_CODE_LENGTH) throw new Error("a pairing code is 8 characters");
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

export type PairingGuardState = "open" | "used" | "expired";

/**
 * One offer's single-use lifecycle on the host: it ends only on the first confirmed handshake or at expiry, never on
 * failures (the relay bounds guesses per slot), so nobody can burn a code they do not know. Claiming only reads the
 * psk, so an attempt in flight never locks another out; expiry is latched against a clock that later goes back.
 */
export class PairingGuard {
  readonly offer: PairingOffer;
  #state: PairingGuardState = "open";

  constructor(offer: PairingOffer) {
    this.offer = offer;
  }

  get state(): PairingGuardState {
    return this.#state;
  }

  claim(now = Date.now()): Uint8Array | undefined {
    if (this.#state === "open" && now >= this.offer.expiresAt) this.#state = "expired";
    return this.#state === "open" ? pairingPsk(this.offer.code) : undefined;
  }

  /** A handshake with this code completed; true only for the first, which uses the code up. */
  use(): boolean {
    if (this.#state !== "open") return false;
    this.#state = "used";
    return true;
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

/** Control, format and bidi characters could rewrite a terminal or a UI line that shows the name. */
const UNSAFE_NAME_CHARACTER = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

function deviceName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === "" || trimmed.length > MAX_DEVICE_NAME) {
    throw new Error(`a device name is 1-${MAX_DEVICE_NAME} characters`);
  }
  if (UNSAFE_NAME_CHARACTER.test(trimmed)) throw new Error("a device name cannot contain control characters");
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
  const webOrigin = new URL(link.webOrigin);
  if (webOrigin.protocol !== "https:" && webOrigin.protocol !== "http:") {
    throw new Error("the web origin must be an HTTP(S) URL");
  }
  return `${webOrigin.origin}/pair#${fragment.toString()}`;
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
  const key = (name: string): Uint8Array => {
    const encoded = get(name);
    if (encoded.length !== 43) throw new Error("the pairing URL has a bad key");
    return base64urlDecode(encoded);
  };
  const noiseStaticPub = key("k");
  const signPub = key("s");
  if (noiseStaticPub.byteLength !== 32 || signPub.byteLength !== 32) throw new Error("the pairing URL has a bad key");
  const hostId = get("h");
  if (hostIdOf(signPub) !== hostId) throw new Error("the pairing URL's hostId does not match its signing key");
  const code = normalizePairingCode(get("c"));
  const relayUrl = get("r");
  if (!URL.canParse(relayUrl)) throw new Error("the pairing URL's relay is not a URL");
  return { webOrigin: parsed.origin, hostId, noiseStaticPub, signPub, code, relayUrl };
}
