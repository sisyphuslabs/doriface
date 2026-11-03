import { describe, expect, test } from "bun:test";
import { ed25519 } from "@noble/curves/ed25519.js";
import { concatBytes, utf8 } from "./encoding.ts";
import { generateHostIdentity, hostIdOf } from "./identity.ts";
import { relayChallengeMessage, relayOriginOf, signRelayChallenge, verifyRelayAnswer } from "./relay-auth.ts";

const identity = generateHostIdentity();
const origin = "wss://relay-doriface.omo.dev";
const challenge = crypto.getRandomValues(new Uint8Array(32));
const answer = signRelayChallenge(identity, origin, challenge);

describe("relay origin", () => {
  test.each([
    ["https://relay-doriface.omo.dev", "wss://relay-doriface.omo.dev"],
    ["https://relay.example:8443/", "wss://relay.example:8443"],
    ["wss://relay.example/v1/host/x", "wss://relay.example"],
    ["http://127.0.0.1:8787", "ws://127.0.0.1:8787"],
  ])("%p signs as %p", (url, expected) => {
    expect(relayOriginOf(url)).toBe(expected);
  });

  test("other schemes are refused", () => {
    expect(() => relayOriginOf("ftp://relay.example")).toThrow();
  });
});

describe("uplink challenge", () => {
  test("signs doriface-relay-v1 || relayOrigin || hostId || challenge", () => {
    const signed = concatBytes(utf8("doriface-relay-v1"), utf8(origin), utf8(identity.hostId), challenge);
    expect(relayChallengeMessage(origin, identity.hostId, challenge)).toEqual(signed);
    expect(answer.subarray(0, 32)).toEqual(identity.sign.publicKey);
    expect(ed25519.verify(answer.subarray(32), signed, identity.sign.publicKey)).toBe(true);
    expect(verifyRelayAnswer(origin, identity.hostId, challenge, answer)).toBe(true);
  });

  test.each([
    [
      "an answer relayed from another relay's challenge",
      () => verifyRelayAnswer("wss://evil.example", identity.hostId, challenge, answer),
    ],
    ["another challenge", () => verifyRelayAnswer(origin, identity.hostId, utf8("x".repeat(32)), answer)],
    ["another hostId", () => verifyRelayAnswer(origin, hostIdOf(utf8("y".repeat(32))), challenge, answer)],
    ["a truncated answer", () => verifyRelayAnswer(origin, identity.hostId, challenge, answer.subarray(0, 95))],
  ])("refuses %s", (_, verdict) => {
    expect(verdict()).toBe(false);
  });
});
