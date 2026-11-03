import { blake2s } from "@noble/hashes/blake2.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { concatBytes, utf8 } from "../encoding.ts";
import { CipherState } from "./cipher-state.ts";

export const HASH_LENGTH = 32;
const EMPTY = new Uint8Array(0);

/**
 * Noise `HKDF(ck, ikm, n)` with HMAC-BLAKE2s: the spec's construction is RFC 5869 extract-then-expand with
 * salt = ck and empty info, so the outputs are consecutive 32-byte slices of one expansion.
 */
export function noiseHkdf(chainingKey: Uint8Array, ikm: Uint8Array, outputs: 2 | 3): Uint8Array[] {
  const okm = hkdf(blake2s, ikm, chainingKey, EMPTY, outputs * HASH_LENGTH);
  return Array.from({ length: outputs }, (_, i) => okm.slice(i * HASH_LENGTH, (i + 1) * HASH_LENGTH));
}

function pair(values: Uint8Array[]): readonly [Uint8Array, Uint8Array] {
  const [a, b] = values;
  if (a === undefined || b === undefined) throw new Error("HKDF returned too few outputs");
  return [a, b];
}

/** The Noise SymmetricState for a `*_25519_ChaChaPoly_BLAKE2s` protocol. */
export class SymmetricState {
  #chainingKey: Uint8Array;
  #hash: Uint8Array;
  #cipher = new CipherState();

  constructor(protocolName: string) {
    const name = utf8(protocolName);
    this.#hash =
      name.byteLength <= HASH_LENGTH ? concatBytes(name, new Uint8Array(HASH_LENGTH - name.byteLength)) : blake2s(name);
    this.#chainingKey = this.#hash;
  }

  get handshakeHash(): Uint8Array {
    return this.#hash;
  }

  mixHash(data: Uint8Array): void {
    this.#hash = blake2s(concatBytes(this.#hash, data));
  }

  mixKey(ikm: Uint8Array): void {
    const [chainingKey, key] = pair(noiseHkdf(this.#chainingKey, ikm, 2));
    this.#chainingKey = chainingKey;
    this.#cipher = new CipherState(key);
  }

  mixKeyAndHash(ikm: Uint8Array): void {
    const [chainingKey, hashInput, key] = noiseHkdf(this.#chainingKey, ikm, 3);
    if (chainingKey === undefined || hashInput === undefined || key === undefined) throw new Error("HKDF failed");
    this.#chainingKey = chainingKey;
    this.mixHash(hashInput);
    this.#cipher = new CipherState(key);
  }

  encryptAndHash(plaintext: Uint8Array): Uint8Array {
    const ciphertext = this.#cipher.encryptWithAd(this.#hash, plaintext);
    this.mixHash(ciphertext);
    return ciphertext;
  }

  decryptAndHash(ciphertext: Uint8Array): Uint8Array {
    const plaintext = this.#cipher.decryptWithAd(this.#hash, ciphertext);
    this.mixHash(ciphertext);
    return plaintext;
  }

  /** The two transport CipherStates: initiator-to-responder first. */
  split(rekeyInterval?: number): readonly [CipherState, CipherState] {
    const [first, second] = pair(noiseHkdf(this.#chainingKey, EMPTY, 2));
    return [new CipherState(first, rekeyInterval), new CipherState(second, rekeyInterval)];
  }
}
