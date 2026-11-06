import { describe, expect, test } from "bun:test";
import { pairAnswer } from "./pair-bridge.ts";

const OFFER = {
  code: "AB3K9XQZ",
  link: "doriface://pair#h=1&k=x",
  opens: "desktop",
  hostId: "h",
  fingerprint: "3FA9 4C0E",
  expiresAt: 1_800_000_000_000,
  slot: "registered",
  codeUsable: true,
} as const;

describe("the pairing offer the shell relays to the page", () => {
  test("carries the phone's web link when the host sends one, and takes an older host's offer without it", () => {
    const phoneLink = "https://doriface.omo.dev/pair#h=1&k=x";
    expect(pairAnswer({ state: "pending", offer: { ...OFFER, phoneLink } })).toEqual({
      state: "pending",
      offer: { ...OFFER, phoneLink },
    });
    expect(pairAnswer({ state: "pending", offer: OFFER })).toEqual({ state: "pending", offer: OFFER });
  });

  test("a phone link that is not a string refuses the whole offer", () => {
    expect(pairAnswer({ state: "pending", offer: { ...OFFER, phoneLink: 7 } })).toBeUndefined();
  });
});
