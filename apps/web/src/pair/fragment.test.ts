import { describe, expect, test } from "bun:test";
import { base32, fingerprintOf, hostIdOf, parsePairingFragment } from "./fragment.ts";

const b64url = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");
const signPub = new Uint8Array(32).fill(7);
const noisePub = new Uint8Array(32).fill(9);
const fragment = (overrides: Readonly<Record<string, string>> = {}): string =>
  "#" +
  new URLSearchParams({
    h: hostIdOf(signPub),
    k: b64url(noisePub),
    s: b64url(signPub),
    p: b64url(new Uint8Array(32).fill(3)),
    r: "wss://relay.example",
    ...overrides,
  }).toString();

describe("pairing fragment", () => {
  test("base32 matches RFC 4648 lowercase without padding", () => {
    expect(base32(new TextEncoder().encode("foobar"))).toBe("mzxw6ytboi");
  });

  test("hostId is 26 chars and the fingerprint is 10 groups of 4 uppercase hex", () => {
    expect(hostIdOf(signPub)).toMatch(/^[a-z2-7]{26}$/);
    expect(fingerprintOf(noisePub)).toMatch(/^([0-9A-F]{4} ){9}[0-9A-F]{4}$/);
  });

  test("the fingerprint is the first 20 bytes of SHA-256 of the noise key", () => {
    const digest = new Bun.CryptoHasher("sha256").update(noisePub).digest("hex").slice(0, 40).toUpperCase();
    expect(fingerprintOf(noisePub).replaceAll(" ", "")).toBe(digest);
  });

  test("a well-formed link parses, carrying its 32-byte link secret", () => {
    const parsed = parsePairingFragment(fragment());
    expect(parsed.ok && parsed.offer.relayUrl).toBe("wss://relay.example");
    expect(parsed.ok && parsed.offer.secret).toEqual({ mode: "link", linkSecret: new Uint8Array(32).fill(3) });
  });

  test("a link with a code and no link secret comes from an older host", () => {
    const old =
      "#" +
      new URLSearchParams({
        h: hostIdOf(signPub),
        k: b64url(noisePub),
        s: b64url(signPub),
        c: "7KQ39D2M",
        r: "wss://relay.example",
      });
    const parsed = parsePairingFragment(old);
    expect(parsed.ok ? "" : parsed.reason).toContain("older doriface-host");
  });

  test.each([
    ["a hostId of another key", { h: hostIdOf(noisePub) }],
    ["a short noise key", { k: b64url(new Uint8Array(31)) }],
    ["a 42-character link secret", { p: "A".repeat(42) }],
    ["a 44-character link secret", { p: "A".repeat(44) }],
    ["a 45-character link secret", { p: "A".repeat(45) }],
    ["a 45-character noise key", { k: "A".repeat(45) }],
    ["a 45-character signing key", { s: "A".repeat(45) }],
    ["a non-WebSocket relay", { r: "https://relay.example" }],
  ])("rejects %s", (_name, overrides) => {
    expect(parsePairingFragment(fragment(overrides)).ok).toBe(false);
  });
});
