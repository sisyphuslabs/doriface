import { chacha20poly1305 } from "@noble/ciphers/chacha.js";

export const MAX_MESSAGE = 65_535;
export const TAG_LENGTH = 16;
const MAX_NONCE = 2n ** 64n - 1n;
const ZEROS = new Uint8Array(32);
const EMPTY = new Uint8Array(0);

/** The ChaChaPoly nonce: 32 zero bits followed by the 64-bit counter, little-endian. */
function nonceBytes(n: bigint): Uint8Array {
  const nonce = new Uint8Array(12);
  new DataView(nonce.buffer).setBigUint64(4, n, true);
  return nonce;
}

export class DecryptError extends Error {
  override readonly name = "DecryptError";
}

/**
 * A Noise CipherState. With a `rekeyInterval`, it runs `REKEY()` after every `rekeyInterval` messages; the nonce
 * keeps counting across rekeys, as the spec defines.
 */
export class CipherState {
  #key: Uint8Array | undefined;
  #nonce = 0n;
  readonly #rekeyInterval: bigint | undefined;

  constructor(key?: Uint8Array, rekeyInterval?: number) {
    this.#key = key;
    this.#rekeyInterval = rekeyInterval === undefined ? undefined : BigInt(rekeyInterval);
  }

  get hasKey(): boolean {
    return this.#key !== undefined;
  }

  get nonce(): bigint {
    return this.#nonce;
  }

  encryptWithAd(ad: Uint8Array, plaintext: Uint8Array): Uint8Array {
    const key = this.#key;
    if (key === undefined) return plaintext;
    const out = chacha20poly1305(key, this.#take(), ad).encrypt(plaintext);
    this.#afterMessage();
    return out;
  }

  decryptWithAd(ad: Uint8Array, ciphertext: Uint8Array): Uint8Array {
    const key = this.#key;
    if (key === undefined) return ciphertext;
    if (ciphertext.byteLength < TAG_LENGTH) throw new DecryptError("ciphertext shorter than its tag");
    let plaintext: Uint8Array;
    try {
      plaintext = chacha20poly1305(key, nonceBytes(this.#nonce), ad).decrypt(ciphertext);
    } catch (error) {
      throw new DecryptError("authentication failed", { cause: error });
    }
    this.#nonce += 1n;
    this.#afterMessage();
    return plaintext;
  }

  /** Noise `REKEY()`: the first 32 bytes of ENCRYPT(k, 2^64-1, empty, zeros). */
  rekey(): void {
    const key = this.#key;
    if (key === undefined) return;
    this.#key = chacha20poly1305(key, nonceBytes(MAX_NONCE), EMPTY).encrypt(ZEROS).subarray(0, 32);
  }

  #take(): Uint8Array {
    if (this.#nonce >= MAX_NONCE) throw new Error("nonce space exhausted");
    const nonce = nonceBytes(this.#nonce);
    this.#nonce += 1n;
    return nonce;
  }

  #afterMessage(): void {
    if (this.#rekeyInterval !== undefined && this.#nonce % this.#rekeyInterval === 0n) this.rekey();
  }
}
