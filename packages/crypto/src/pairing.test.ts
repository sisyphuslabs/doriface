import { describe, expect, test } from "bun:test";
import { hkdfSync } from "node:crypto";
import { generateHostIdentity } from "./identity.ts";
import {
  buildPairingUrl,
  createPairingOffer,
  decodePairingHello,
  DEFAULT_RELAY_URL,
  encodePairingHello,
  PAIRING_TTL_MS,
  pairingCodeBytes,
  pairingPsk,
  PairingSlot,
  parsePairingUrl,
} from "./pairing.ts";

const identity = generateHostIdentity();

describe("pairing code", () => {
  test("is 26 base32 characters of 16 random bytes and expires after 10 minutes", () => {
    const offer = createPairingOffer(1_000);
    expect(offer.code).toMatch(/^[a-z2-7]{26}$/);
    expect(pairingCodeBytes(offer.code).byteLength).toBe(16);
    expect(offer.expiresAt).toBe(1_000 + PAIRING_TTL_MS);
    expect(createPairingOffer().code).not.toBe(offer.code);
  });

  test("psk is HKDF-SHA256(code bytes, empty salt, 'doriface pair v1', 32)", () => {
    const { code } = createPairingOffer();
    const expected = new Uint8Array(
      hkdfSync("sha256", pairingCodeBytes(code), new Uint8Array(0), "doriface pair v1", 32),
    );
    expect(pairingPsk(code)).toEqual(expected);
  });

  test.each(["", "abc", "a".repeat(27), "1".repeat(26)])("rejects code %p", (bad) => {
    expect(() => pairingPsk(bad)).toThrow();
  });
});

describe("PairingSlot", () => {
  test("yields the psk once; a release reopens it, a burn ends it", () => {
    const slot = new PairingSlot(createPairingOffer(0));
    expect(slot.claim(1)).toEqual(pairingPsk(slot.offer.code));
    expect(slot.claim(1)).toBeUndefined();
    slot.release();
    expect(slot.claim(1)).toBeDefined();
    slot.burn();
    slot.release();
    expect([slot.state, slot.claim(1)]).toEqual(["used", undefined]);
  });

  test("never yields after expiry", () => {
    const slot = new PairingSlot(createPairingOffer(0));
    expect(slot.claim(PAIRING_TTL_MS)).toBeUndefined();
    expect(slot.state).toBe("open");
  });
});

describe("pairing URL", () => {
  const link = {
    webOrigin: "https://doriface.omo.dev/",
    hostId: identity.hostId,
    noiseStaticPub: identity.noise.publicKey,
    signPub: identity.sign.publicKey,
    code: createPairingOffer().code,
    relayUrl: DEFAULT_RELAY_URL,
  };
  const url = buildPairingUrl(link);

  test("puts everything in the fragment and parses back", () => {
    expect(url.startsWith(`https://doriface.omo.dev/pair#h=${identity.hostId}&k=`)).toBe(true);
    expect(new URL(url).search).toBe("");
    expect(parsePairingUrl(url)).toEqual({ ...link, webOrigin: "https://doriface.omo.dev" });
  });

  test.each([
    ["a hostId of another key", url.replace(identity.hostId, generateHostIdentity().hostId)],
    ["a missing code", url.replace(/&c=[^&]+/, "")],
    ["a short key", url.replace(/k=[^&]+/, "k=AAAA")],
    ["a relay that is not a URL", url.replace(/r=[^&]+$/, "r=relay")],
  ])("rejects %s", (_, bad) => {
    expect(() => parsePairingUrl(bad)).toThrow();
  });
});

describe("pairing hello", () => {
  test("round-trips the device name as {name} JSON", () => {
    const payload = encodePairingHello("  Pixel 9 ");
    expect(new TextDecoder().decode(payload)).toBe('{"name":"Pixel 9"}');
    expect(decodePairingHello(payload)).toBe("Pixel 9");
  });

  test.each(['{"nam":"x"}', '{"name":""}', '{"name":1}', "not json", `{"name":"${"x".repeat(65)}"}`])(
    "rejects %p",
    (bad) => {
      expect(() => decodePairingHello(new TextEncoder().encode(bad))).toThrow();
    },
  );
});
