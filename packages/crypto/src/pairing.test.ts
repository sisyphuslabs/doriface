import { describe, expect, test } from "bun:test";
import { hkdfSync } from "node:crypto";
import { generateHostIdentity } from "./identity.ts";
import {
  buildPairingUrl,
  createPairingOffer,
  decodePairingHello,
  DEFAULT_RELAY_URL,
  encodePairingHello,
  formatPairingCode,
  MAX_PAIRING_FAILURES,
  normalizePairingCode,
  PAIRING_ALPHABET,
  PAIRING_TTL_MS,
  pairingPsk,
  pairingSlotOf,
  PairingGuard,
  parsePairingUrl,
} from "./pairing.ts";

const identity = generateHostIdentity();

describe("pairing code", () => {
  test("is 8 Crockford base32 characters, a 3-character slot then the secret, expiring after 10 minutes", () => {
    const offer = createPairingOffer(1_000);
    expect(offer.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(pairingSlotOf(offer.code)).toBe(offer.code.slice(0, 3));
    expect(formatPairingCode(offer.code)).toBe(`${offer.code.slice(0, 4)} ${offer.code.slice(4)}`);
    expect(offer.expiresAt).toBe(1_000 + PAIRING_TTL_MS);
  });

  test("draws every alphabet character", () => {
    const seen = new Set(Array.from({ length: 200 }, () => createPairingOffer().code).join(""));
    expect([...seen].toSorted().join("")).toBe(PAIRING_ALPHABET);
  });

  test("psk is HKDF-SHA256(UTF-8 of the 8 characters, empty salt, 'doriface pair v1', 32)", () => {
    const { code } = createPairingOffer();
    const expected = new Uint8Array(hkdfSync("sha256", code, new Uint8Array(0), "doriface pair v1", 32));
    expect(pairingPsk(code)).toEqual(expected);
  });

  test.each([
    ["3fa9 4c0e", "3FA94C0E"],
    ["3FA9-4C0E", "3FA94C0E"],
    ["oil1 abcd", "0111ABCD"],
  ])("a typed %p reads as %p", (typed, code) => {
    expect(normalizePairingCode(typed)).toBe(code);
    expect(pairingPsk(typed)).toEqual(pairingPsk(code));
  });

  test.each(["", "ABC", "ABCDEFGHJ", "ABCD EFGU", "ABCD!EFG"])("rejects code %p", (bad) => {
    expect(() => pairingPsk(bad)).toThrow();
  });
});

describe("PairingGuard", () => {
  test("an attempt in flight does not lock others out; the first success uses the code up", () => {
    const guard = new PairingGuard(createPairingOffer(0));
    expect(guard.claim(1)).toEqual(pairingPsk(guard.offer.code));
    expect(guard.claim(1)).toEqual(pairingPsk(guard.offer.code));
    expect(guard.use()).toBe(true);
    expect(guard.use()).toBe(false);
    expect([guard.state, guard.claim(1)]).toEqual(["used", undefined]);
  });

  test(`burns the code on failure number ${MAX_PAIRING_FAILURES}`, () => {
    const guard = new PairingGuard(createPairingOffer(0));
    for (let i = 1; i < MAX_PAIRING_FAILURES; i++) {
      guard.fail();
      expect([guard.state, guard.failures]).toEqual(["open", i]);
    }
    guard.fail();
    expect([guard.state, guard.claim(1)]).toEqual(["burned", undefined]);
    expect(new PairingGuard(guard.offer, MAX_PAIRING_FAILURES).state).toBe("burned");
  });

  test("never yields after expiry, even if the clock later goes back", () => {
    const guard = new PairingGuard(createPairingOffer(0));
    expect(guard.claim(PAIRING_TTL_MS)).toBeUndefined();
    expect([guard.state, guard.claim(1)]).toEqual(["expired", undefined]);
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
    ["an oversized key", url.replace(/k=[^&]+/, `k=${"A".repeat(100_000)}`)],
    ["an oversized code", url.replace(/c=[^&]+/, `c=${"A".repeat(100_000)}`)],
  ])("rejects %s", (_, bad) => {
    expect(() => parsePairingUrl(bad)).toThrow();
  });
});

describe("pairing URL origins", () => {
  test.each(["file:///tmp/x", "data:text/plain,x", "javascript:alert(1)"])("refuses web origin %p", (webOrigin) => {
    const identity2 = generateHostIdentity();
    const build = () =>
      buildPairingUrl({
        webOrigin,
        hostId: identity2.hostId,
        noiseStaticPub: identity2.noise.publicKey,
        signPub: identity2.sign.publicKey,
        code: createPairingOffer().code,
        relayUrl: DEFAULT_RELAY_URL,
      });
    expect(build).toThrow("HTTP(S)");
  });
});

describe("pairing hello", () => {
  test("round-trips the device name as {name} JSON", () => {
    const payload = encodePairingHello("  Pixel 9 ");
    expect(new TextDecoder().decode(payload)).toBe('{"name":"Pixel 9"}');
    expect(decodePairingHello(payload)).toBe("Pixel 9");
  });

  test.each([
    '{"name":"a\\u001b[2Jb"}',
    '{"name":"line\\nbreak"}',
    '{"name":"bidi\\u202e"}',
    '{"nam":"x"}',
    '{"name":""}',
    '{"name":1}',
    "not json",
    `{"name":"${"x".repeat(65)}"}`,
  ])("rejects %p", (bad) => {
    expect(() => decodePairingHello(new TextEncoder().encode(bad))).toThrow();
  });
});
