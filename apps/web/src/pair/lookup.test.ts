import { afterEach, expect, test } from "bun:test";
import { generateHostIdentity, generateX25519, PAIRING_TTL_MS } from "@doriface/crypto";
import { PAIR_OFFER_TTL_MS, pairSlotRefusal, UNSIGNED_SLOT_REASON } from "@doriface/relay-client";
import { pairSlotStatement, toBase64Url } from "@doriface/relay-client/wire";
import { ed25519 } from "@noble/curves/ed25519.js";
import { lookupCode } from "./lookup.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** The relay answers the lookup with this body, as `GET /v1/pair/<slot>` does. */
function relayAnswers(body: unknown): void {
  globalThis.fetch = Object.assign(async () => Response.json(body), { preconnect: realFetch.preconnect });
}

test("a relay answer with the host's real hostId and signPub but an attacker's noiseStaticPub is refused (#22)", async () => {
  const host = generateHostIdentity();
  const attacker = generateX25519();
  relayAnswers({
    hostId: host.hostId,
    signPub: toBase64Url(host.sign.publicKey),
    noiseStaticPub: toBase64Url(attacker.publicKey),
  });
  const parsed = await lookupCode("AB3K9XQZ", "wss://relay.example");
  expect(parsed.ok).toBe(false);
});

/** What a v1.9 relay answers for a host that signed slot `AB3` with its own keys. */
function signedBody(host = generateHostIdentity(), expiresAt = Date.now() + 5 * 60 * 1000) {
  const slotSig = ed25519.sign(pairSlotStatement("AB3", host.noise.publicKey, expiresAt), host.sign.secretKey);
  return {
    hostId: host.hostId,
    signPub: toBase64Url(host.sign.publicKey),
    noiseStaticPub: toBase64Url(host.noise.publicKey),
    expiresAt,
    slotSig: toBase64Url(slotSig),
  };
}

test("a relay answer the host signed for this slot is the offer to pair with (#22)", async () => {
  const host = generateHostIdentity();
  relayAnswers(signedBody(host));
  const parsed = await lookupCode("AB3K9XQZ", "wss://relay.example");
  expect(parsed.ok).toBe(true);
  if (parsed.ok) expect(parsed.offer.noiseStaticPub).toEqual(host.noise.publicKey);
});

test("the host's signature with an attacker's Noise key swapped in is refused, saying so (#22)", async () => {
  relayAnswers({ ...signedBody(), noiseStaticPub: toBase64Url(generateX25519().publicKey) });
  expect(await lookupCode("AB3K9XQZ", "wss://relay.example")).toEqual({
    ok: false,
    reason: "The relay's pairing answer is not signed by the host it names; do not pair through this relay.",
  });
  expect(pairSlotRefusal("bad-signature").startsWith("the relay's pairing answer is not signed")).toBe(true);
});

test("an unsigned answer names an old host or an old relay and the link or QR code way (#22)", async () => {
  const { expiresAt: _expiresAt, slotSig: _slotSig, ...unsigned } = signedBody();
  relayAnswers(unsigned);
  const parsed = await lookupCode("AB3K9XQZ", "wss://relay.example");
  expect(parsed).toEqual({ ok: false, reason: `T${UNSIGNED_SLOT_REASON.slice(1)}.` });
});

test("an answer whose signed expiry is past the clock allowance is refused (#22)", async () => {
  relayAnswers(signedBody(generateHostIdentity(), Date.now() - 11 * 60 * 1000));
  const parsed = await lookupCode("AB3K9XQZ", "wss://relay.example");
  expect(parsed.ok).toBe(false);
});

test("relay-client's offer TTL is the crypto package's PAIRING_TTL_MS", () => {
  expect(PAIR_OFFER_TTL_MS).toBe(PAIRING_TTL_MS);
});
