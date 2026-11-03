import { describe, expect, spyOn, test } from "bun:test";
import { generateX25519 } from "./identity.ts";
import { rawStaticKey, supportsWebCryptoX25519 } from "./static-key.ts";

describe("rawStaticKey", () => {
  test("a low-order peer key rejects the returned promise instead of throwing", async () => {
    const key = rawStaticKey(generateX25519());
    let dh: Promise<Uint8Array> | undefined;
    expect(() => {
      dh = key.dh(new Uint8Array(32));
    }).not.toThrow();
    await expect(dh).rejects.toThrow();
  });
});

describe("supportsWebCryptoX25519", () => {
  test("is true when WebCrypto can run an X25519 DH", async () => {
    expect(await supportsWebCryptoX25519()).toBe(true);
  });

  test("is false when keys generate but deriveBits fails", async () => {
    const derive = spyOn(crypto.subtle, "deriveBits").mockRejectedValue(new Error("X25519 deriveBits unsupported"));
    try {
      expect(await supportsWebCryptoX25519()).toBe(false);
    } finally {
      derive.mockRestore();
    }
  });
});
