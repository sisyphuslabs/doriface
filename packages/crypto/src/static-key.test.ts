import { describe, expect, spyOn, test } from "bun:test";
import { supportsWebCryptoX25519 } from "./static-key.ts";

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
