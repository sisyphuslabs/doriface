import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { base32Decode, utf8 } from "./encoding.ts";
import {
  fingerprintOf,
  generateHostIdentity,
  hostIdentityFromSecrets,
  hostIdOf,
  prologueFor,
  signRelayChallenge,
  verifyRelayAnswer,
} from "./identity.ts";

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

  test("the prologue is doriface/1 followed by the hostId", () => {
    expect(new TextDecoder().decode(prologueFor(identity.hostId))).toBe(`doriface/1${identity.hostId}`);
  });
});

describe("relay challenge", () => {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const answer = signRelayChallenge(identity, challenge);

  test("a host's answer verifies", () => {
    expect(answer.byteLength).toBe(96);
    expect(verifyRelayAnswer(identity.hostId, challenge, answer)).toBe(true);
  });

  test.each([
    ["another challenge", () => verifyRelayAnswer(identity.hostId, utf8("x".repeat(32)), answer)],
    ["another hostId", () => verifyRelayAnswer(hostIdOf(utf8("y".repeat(32))), challenge, answer)],
    ["a truncated answer", () => verifyRelayAnswer(identity.hostId, challenge, answer.subarray(0, 95))],
  ])("refuses %s", (_, verdict) => {
    expect(verdict()).toBe(false);
  });
});
