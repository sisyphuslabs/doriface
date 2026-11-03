import { ed25519 } from "@noble/curves/ed25519.js";
import { describe, expect, test } from "bun:test";
import { ed25519Signer, generateSigningKey } from "./signer.ts";

describe("ed25519Signer", () => {
  test("owns its key: overwriting the caller's buffer does not change what it signs with", async () => {
    const secretKey = generateSigningKey();
    const signer = ed25519Signer(secretKey);
    secretKey.fill(0);
    const message = new Uint8Array([1, 2, 3]);
    expect(ed25519.verify(await signer.sign(message), message, signer.publicKey)).toBe(true);
  });
});
