import { x25519 } from "@noble/curves/ed25519.js";
import { concatBytes } from "../encoding.ts";
import { generateX25519, type KeyPair, x25519FromSecret } from "../identity.ts";
import type { StaticKey } from "../static-key.ts";
import { type CipherState, MAX_MESSAGE, TAG_LENGTH } from "./cipher-state.ts";
import { SymmetricState } from "./symmetric-state.ts";

export type Pattern = "IK" | "IKpsk2";
export type Role = "initiator" | "responder";

export const PROTOCOL_NAMES = {
  IK: "Noise_IK_25519_ChaChaPoly_BLAKE2s",
  IKpsk2: "Noise_IKpsk2_25519_ChaChaPoly_BLAKE2s",
} as const;

const KEY_LENGTH = 32;

export interface HandshakeOptions {
  readonly pattern: Pattern;
  readonly role: Role;
  readonly prologue: Uint8Array;
  /** The local static key; its DH may be async (a WebCrypto key). */
  readonly staticKey: StaticKey;
  /** The responder's static public key; required for the initiator, learned from message 1 by the responder. */
  readonly remoteStatic?: Uint8Array | undefined;
  /** Required for IKpsk2 before message 2 is written or read; the responder may set it after reading message 1. */
  readonly psk?: Uint8Array | undefined;
  /** Fixed ephemeral secret, for test vectors only. */
  readonly ephemeralSecret?: Uint8Array | undefined;
}

export interface HandshakeResult {
  readonly send: CipherState;
  readonly receive: CipherState;
  readonly handshakeHash: Uint8Array;
  readonly remoteStatic: Uint8Array;
}

/**
 * The two-message IK handshake (`-> e, es, s, ss` / `<- e, ee, se`), optionally with `psk` after message 2.
 * Each instance runs exactly one handshake; any authentication failure throws and leaves it unusable.
 */
export class Handshake {
  readonly #options: HandshakeOptions;
  readonly #symmetric: SymmetricState;
  #remoteStatic: Uint8Array | undefined;
  #remoteEphemeral: Uint8Array | undefined;
  #ephemeral: KeyPair | undefined;
  #psk: Uint8Array | undefined;
  #step = 0;

  constructor(options: HandshakeOptions) {
    if (options.psk !== undefined) assertPsk(options.psk);
    this.#options = options;
    this.#psk = options.psk;
    this.#symmetric = new SymmetricState(PROTOCOL_NAMES[options.pattern]);
    this.#symmetric.mixHash(options.prologue);
    const responderStatic = options.role === "initiator" ? options.remoteStatic : options.staticKey.publicKey;
    if (responderStatic === undefined) throw new Error("the initiator needs the responder's static key");
    this.#remoteStatic = options.role === "initiator" ? responderStatic : undefined;
    this.#symmetric.mixHash(responderStatic);
  }

  get remoteStatic(): Uint8Array | undefined {
    return this.#remoteStatic;
  }

  get pattern(): Pattern {
    return this.#options.pattern;
  }

  setPsk(psk: Uint8Array): void {
    assertPsk(psk);
    this.#psk = psk;
  }

  async writeMessage(payload: Uint8Array): Promise<Uint8Array> {
    const expected = this.#options.role === "initiator" ? 0 : 1;
    if (this.#step !== expected) throw new Error("handshake message out of turn");
    this.#step++;
    const e = this.#ephemeralKey();
    const parts: Uint8Array[] = [e.publicKey];
    this.#mixEphemeral(e.publicKey);
    const remoteStatic = this.#required(this.#remoteStatic, "remote static");
    if (this.#step === 1) {
      this.#symmetric.mixKey(dh(e, remoteStatic));
      parts.push(this.#symmetric.encryptAndHash(this.#options.staticKey.publicKey));
      this.#symmetric.mixKey(await this.#options.staticKey.dh(remoteStatic));
    } else {
      this.#symmetric.mixKey(dh(e, this.#required(this.#remoteEphemeral, "remote ephemeral")));
      this.#symmetric.mixKey(dh(e, remoteStatic));
      this.#mixPsk();
    }
    parts.push(this.#symmetric.encryptAndHash(payload));
    const message = concatBytes(...parts);
    if (message.byteLength > MAX_MESSAGE) throw new Error("handshake message exceeds 65535 bytes");
    return message;
  }

  async readMessage(message: Uint8Array): Promise<Uint8Array> {
    const expected = this.#options.role === "responder" ? 0 : 1;
    if (this.#step !== expected) throw new Error("handshake message out of turn");
    if (message.byteLength > MAX_MESSAGE) throw new Error("handshake message exceeds 65535 bytes");
    this.#step++;
    const re = this.#slice(message, 0, KEY_LENGTH);
    this.#remoteEphemeral = re;
    this.#mixEphemeral(re);
    const s = this.#options.staticKey;
    let offset = KEY_LENGTH;
    if (this.#step === 1) {
      this.#symmetric.mixKey(await s.dh(re));
      const rs = this.#symmetric.decryptAndHash(this.#slice(message, offset, offset + KEY_LENGTH + TAG_LENGTH));
      offset += KEY_LENGTH + TAG_LENGTH;
      this.#remoteStatic = rs;
      this.#symmetric.mixKey(await s.dh(rs));
    } else {
      this.#symmetric.mixKey(dh(this.#ephemeralKey(), re));
      this.#symmetric.mixKey(await s.dh(re));
      this.#mixPsk();
    }
    return this.#symmetric.decryptAndHash(message.subarray(offset));
  }

  /** Splits into transport states once both messages are done. */
  finish(rekeyInterval?: number): HandshakeResult {
    if (this.#step !== 2) throw new Error("the handshake is not complete");
    const [first, second] = this.#symmetric.split(rekeyInterval);
    const initiator = this.#options.role === "initiator";
    return {
      send: initiator ? first : second,
      receive: initiator ? second : first,
      handshakeHash: this.#symmetric.handshakeHash,
      remoteStatic: this.#required(this.#remoteStatic, "remote static"),
    };
  }

  #ephemeralKey(): KeyPair {
    const fixed = this.#options.ephemeralSecret;
    this.#ephemeral ??= fixed === undefined ? generateX25519() : x25519FromSecret(fixed);
    return this.#ephemeral;
  }

  #mixEphemeral(publicKey: Uint8Array): void {
    this.#symmetric.mixHash(publicKey);
    if (this.#options.pattern === "IKpsk2") this.#symmetric.mixKey(publicKey);
  }

  #mixPsk(): void {
    if (this.#options.pattern !== "IKpsk2") return;
    this.#symmetric.mixKeyAndHash(this.#required(this.#psk, "psk"));
  }

  #slice(message: Uint8Array, start: number, end: number): Uint8Array {
    if (message.byteLength < end) throw new Error("handshake message is truncated");
    return message.slice(start, end);
  }

  #required<T>(value: T | undefined, what: string): T {
    if (value === undefined) throw new Error(`handshake is missing the ${what}`);
    return value;
  }
}

function assertPsk(psk: Uint8Array): void {
  if (psk.byteLength !== KEY_LENGTH) throw new Error("a psk is 32 bytes");
}

/** X25519; noble rejects low-order points (an all-zero shared secret), which aborts the handshake. */
const dh = (own: KeyPair, remote: Uint8Array): Uint8Array => x25519.getSharedSecret(own.secretKey, remote);
