import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { describe, expect, test } from "bun:test";
import { CipherState } from "./cipher-state.ts";

/** An independent Noise CipherState: ChaChaPoly with nonce = 4 zero bytes || n (64-bit little-endian). */
function nonce(n: bigint): Uint8Array {
  const bytes = new Uint8Array(12);
  new DataView(bytes.buffer).setBigUint64(4, n, true);
  return bytes;
}
const rekeyed = (key: Uint8Array): Uint8Array =>
  chacha20poly1305(key, nonce(2n ** 64n - 1n), new Uint8Array(0))
    .encrypt(new Uint8Array(32))
    .subarray(0, 32);

describe("REKEY", () => {
  test("every interval swaps the key and the nonce keeps counting (2^20 in production, 2 here)", () => {
    const key = new Uint8Array(32).fill(7);
    const ad = new Uint8Array(0);
    const sender = new CipherState(key, 2);
    const records = [0, 1, 2, 3, 4].map((i) => sender.encryptWithAd(ad, Uint8Array.of(i)));
    const k1 = rekeyed(key);
    const k2 = rekeyed(k1);
    const keys = [key, key, k1, k1, k2];
    const expected = keys.map((k, i) => chacha20poly1305(k, nonce(BigInt(i)), ad).encrypt(Uint8Array.of(i)));
    expect(records.map((r) => r.toHex())).toEqual(expected.map((r) => r.toHex()));
    expect(sender.nonce).toBe(5n);

    const receiver = new CipherState(key, 2);
    expect(records.map((r) => receiver.decryptWithAd(ad, r)[0])).toEqual([0, 1, 2, 3, 4]);
  });
});
