import { describe, expect, test } from "bun:test";
import type { DesktopPairAnswer, DesktopPairOffer } from "../desktop/pair-bridge.ts";
import { countdown, expiryLine, linkOpens, offerCode, pairDeviceView, remainingMs, slotNote } from "./pair-device.ts";

const NOW = 1_800_000_000_000;

const offer = (over: Partial<DesktopPairOffer> = {}): DesktopPairOffer => ({
  code: "AB3K9XQZ",
  link: "doriface://pair#h=1&k=x",
  opens: "desktop",
  hostId: "h",
  fingerprint: "3FA9 4C0E 7B21 D855 9E04 A6C1 7F3B D2A0 8C4E 6F19",
  expiresAt: NOW + 90_000,
  slot: "registered",
  codeUsable: true,
  ...over,
});

describe("the pairing offer dialog's view of the host's answer", () => {
  test("no answer yet is asking", () => {
    expect(pairDeviceView(null, NOW)).toEqual({ kind: "asking" });
  });

  test("a pending offer carries the code, link, fingerprint and expiry", () => {
    const view = pairDeviceView({ state: "pending", offer: offer() }, NOW);
    if (view.kind !== "offer") throw new Error(view.kind);
    expect(view.expired).toBe(false);
    expect(offerCode(view.offer)).toBe("AB3K 9XQZ");
    expect(view.offer.fingerprint.split(" ")).toHaveLength(10);
  });

  test("a pending offer past its expiry reads as expired without waiting for the host", () => {
    const view = pairDeviceView({ state: "pending", offer: offer() }, NOW + 90_000);
    if (view.kind !== "offer") throw new Error(view.kind);
    expect(view.expired).toBe(true);
    expect(expiryLine(view.offer, NOW + 90_000)).toBe("This offer has expired.");
  });

  test("paired names the device, and pairs without one still say paired", () => {
    const withDevice: DesktopPairAnswer = {
      state: "paired",
      device: { name: "Safari on iOS", id: "3FA94C0E", pairedAt: new Date(NOW).toISOString() },
    };
    expect(pairDeviceView(withDevice, NOW)).toEqual({
      kind: "paired",
      device: { name: "Safari on iOS", id: "3FA94C0E", pairedAt: new Date(NOW).toISOString() },
    });
    expect(pairDeviceView({ state: "paired", device: null }, NOW)).toEqual({ kind: "paired", device: null });
  });

  test("the host's own expiry, an offer that is gone, and a host that did not answer each read plainly", () => {
    expect(pairDeviceView({ state: "expired" }, NOW)).toEqual({ kind: "expired" });
    expect(pairDeviceView({ state: "none" }, NOW)).toEqual({ kind: "expired" });
    expect(pairDeviceView({ state: "unavailable", reason: "no host" }, NOW)).toEqual({
      kind: "unavailable",
      reason: "no host",
    });
  });

  test("the countdown counts down and never goes negative", () => {
    expect(countdown(90_000)).toBe("1:30");
    expect(countdown(9_000)).toBe("0:09");
    expect(countdown(0)).toBe("0:00");
    expect(remainingMs(offer(), NOW + 200_000)).toBe(0);
  });

  test("a code the relay cannot serve says so, and a live one says nothing", () => {
    expect(slotNote(offer())).toBeUndefined();
    expect(slotNote(offer({ slot: "pending", codeUsable: false }))).toContain("not up yet");
    expect(slotNote(offer({ slot: "unavailable", codeUsable: false }))).toContain("needs the relay");
  });

  test("the link names what opens it, because the app has no hosted web page by default", () => {
    expect(linkOpens("desktop")).toBe(
      "Opens the doriface desktop app on another computer. On a phone, type the code above.",
    );
    expect(linkOpens("web")).toBe("Opens the doriface web app on the device you pair.");
  });
});
