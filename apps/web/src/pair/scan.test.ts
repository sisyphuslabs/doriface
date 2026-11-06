import { describe, expect, test } from "bun:test";
import { hostIdOf } from "./fragment.ts";
import { offerFromScan } from "./scan.ts";

const b64url = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");
const signPub = new Uint8Array(32).fill(7);
const noisePub = new Uint8Array(32).fill(9);
const inviteLink = (overrides: Readonly<Record<string, string>> = {}): string =>
  "https://app.doriterm.com/pair#" +
  new URLSearchParams({
    h: hostIdOf(signPub),
    k: b64url(noisePub),
    s: b64url(signPub),
    p: b64url(new Uint8Array(32).fill(3)),
    r: "wss://relay.invalid",
    ...overrides,
  }).toString();

describe("offerFromScan", () => {
  test("a scanned invite link becomes the same offer the pasted link makes", () => {
    const scanned = offerFromScan(inviteLink());
    expect(scanned.ok).toBe(true);
    if (!scanned.ok) return;
    expect(scanned.offer.hostId).toBe(hostIdOf(signPub));
    expect(scanned.offer.relayUrl).toBe("wss://relay.invalid");
  });

  test("a scan with no fragment is refused, and says why", () => {
    const scanned = offerFromScan("https://app.doriterm.com/pair");
    expect(scanned.ok).toBe(false);
    if (scanned.ok) return;
    expect(scanned.reason).toContain("no invite");
  });

  test("a code that is not an invite link is refused rather than navigated to", () => {
    expect(offerFromScan("https://example.com/").ok).toBe(false);
    expect(offerFromScan("hello").ok).toBe(false);
    expect(offerFromScan("").ok).toBe(false);
  });

  test("an invite link whose secret is the wrong length is refused by the spec's own parser", () => {
    expect(offerFromScan(inviteLink({ p: "short" })).ok).toBe(false);
  });

  test("an invite link whose hostId does not match its signing key is refused", () => {
    expect(offerFromScan(inviteLink({ h: hostIdOf(new Uint8Array(32).fill(1)) })).ok).toBe(false);
  });
});
