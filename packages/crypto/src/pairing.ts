import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base32Decode, base32Encode, base64urlDecode, base64urlEncode, utf8 } from "./encoding.ts";
import { hostIdOf } from "./identity.ts";

export const PAIRING_TTL_MS = 10 * 60 * 1000;
export const DEFAULT_RELAY_URL = "https://relay-doriface.omo.dev";
const CODE_BYTES = 16;
const MAX_DEVICE_NAME = 64;

/** 16 random bytes as 26 base32 characters. */
export const generatePairingCode = (): string => base32Encode(crypto.getRandomValues(new Uint8Array(CODE_BYTES)));

export function pairingCodeBytes(code: string): Uint8Array {
  const bytes = base32Decode(code);
  if (bytes.byteLength !== CODE_BYTES || code.length !== 26) throw new Error("a pairing code is 26 base32 characters");
  return bytes;
}

/** psk = HKDF-SHA256(ikm = code bytes, salt = empty, info = "doriface pair v1", 32 bytes). */
export const pairingPsk = (code: string): Uint8Array =>
  hkdf(sha256, pairingCodeBytes(code), new Uint8Array(0), utf8("doriface pair v1"), 32);

export interface PairingOffer {
  readonly code: string;
  /** Milliseconds since the epoch. */
  readonly expiresAt: number;
}

export const createPairingOffer = (now = Date.now()): PairingOffer => ({
  code: generatePairingCode(),
  expiresAt: now + PAIRING_TTL_MS,
});

export type PairingSlotState = "open" | "claimed" | "used";

/**
 * One offer's single-use lifecycle on the host: a handshake claims it (so a second concurrent attempt is refused),
 * then either burns it on success or releases it on failure. An expired offer never yields a psk.
 */
export class PairingSlot {
  readonly offer: PairingOffer;
  #state: PairingSlotState = "open";

  constructor(offer: PairingOffer) {
    this.offer = offer;
  }

  get state(): PairingSlotState {
    return this.#state;
  }

  claim(now = Date.now()): Uint8Array | undefined {
    if (this.#state !== "open" || now >= this.offer.expiresAt) return undefined;
    this.#state = "claimed";
    return pairingPsk(this.offer.code);
  }

  release(): void {
    if (this.#state === "claimed") this.#state = "open";
  }

  burn(): void {
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
  const code = get("c");
  pairingCodeBytes(code);
  const relayUrl = get("r");
  if (!URL.canParse(relayUrl)) throw new Error("the pairing URL's relay is not a URL");
  return { webOrigin: parsed.origin, hostId, noiseStaticPub, signPub, code, relayUrl };
}
