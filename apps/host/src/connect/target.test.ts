import { buildPairingUrl, generateHostIdentity } from "@doriface/crypto";
import { describe, expect, test } from "bun:test";
import { parseTarget } from "./target.ts";

describe("parseTarget", () => {
  test("a hostId, a pairing link and a typed code (spaces, dashes and look-alikes allowed) are told apart", () => {
    const identity = generateHostIdentity();
    const url = buildPairingUrl({
      webOrigin: "https://web.example",
      hostId: identity.hostId,
      noiseStaticPub: identity.noise.publicKey,
      signPub: identity.sign.publicKey,
      linkSecret: new Uint8Array(32).fill(7),
      relayUrl: "https://relay.example",
    });
    expect(parseTarget(identity.hostId)).toEqual({ kind: "host", hostId: identity.hostId });
    const link = parseTarget(url);
    expect(link.kind === "link" && link.link.hostId).toBe(identity.hostId);
    expect(parseTarget("ab3k-9xqo")).toEqual({ kind: "code", code: "AB3K9XQ0" });
  });

  test("anything else is refused with what was expected", () => {
    expect(() => parseTarget("vps")).toThrow("expected a hostId, a pairing link or an 8-character pairing code");
  });
});
