import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { base32Decode } from "./encoding.ts";
import { fingerprintOf, generateHostIdentity, hostIdentityFromSecrets, prologueFor } from "./identity.ts";

const identity = generateHostIdentity();

describe("host identity", () => {
  test("hostId is the base32 of the first 16 bytes of SHA-256(signPub)", () => {
    const digest = createHash("sha256").update(identity.sign.publicKey).digest();
    expect(identity.hostId).toMatch(/^[a-z2-7]{26}$/);
    expect(base32Decode(identity.hostId)).toEqual(new Uint8Array(digest.subarray(0, 16)));
  });

  test("fingerprint is the first 20 bytes of SHA-256(noiseStaticPub) as ten uppercase hex groups of four", () => {
    const digest = createHash("sha256").update(identity.noise.publicKey).digest("hex").toUpperCase();
    const fingerprint = fingerprintOf(identity.noise.publicKey);
    expect(fingerprint).toMatch(/^[0-9A-F]{4}( [0-9A-F]{4}){9}$/);
    expect(fingerprint.replaceAll(" ", "")).toBe(digest.slice(0, 40));
  });

  test("rebuilding from the secrets yields the same identity", () => {
    expect(hostIdentityFromSecrets(identity.sign.secretKey, identity.noise.secretKey)).toEqual(identity);
  });

  test("the prologue is 64 6f 72 69 66 61 63 65 2f 31 followed by the 26 ASCII bytes of the hostId", () => {
    const prologue = prologueFor(identity.hostId);
    expect(prologue.byteLength).toBe(36);
    expect(prologue.subarray(0, 10).toHex()).toBe("646f7269666163652f31");
    expect(prologue.subarray(10)).toEqual(new Uint8Array(Buffer.from(identity.hostId, "ascii")));
  });
});
