import { DEFAULT_PUSH_PREFS, type PushClientLine, type PushHostLine } from "@doriface/protocol";
import { describe, expect, test } from "bun:test";
import { carryOver, reconcile } from "./reconcile.ts";

const sub = (endpoint: string) => ({
  endpoint,
  toJSON: () => ({ endpoint, keys: { p256dh: "B".repeat(87), auth: "C".repeat(22) } }),
});

describe("notifications that were on stay on", () => {
  test.each([
    ["the browser dropped its subscription", { browser: null, held: false }, "resubscribe"],
    ["the host's key changed", { browser: { keyMatches: false }, held: true }, "resubscribe"],
    ["the host lost the subscription", { browser: { keyMatches: true }, held: false }, "resend"],
    ["everything holds", { browser: { keyMatches: true }, held: true }, "on"],
  ] as const)("%s", (_, state, action) => {
    expect(reconcile({ granted: true, routeSaved: true, ...state })).toBe(action);
  });

  test("a withdrawn permission, or notifications never turned on here, are off", () => {
    expect(reconcile({ granted: false, routeSaved: true, browser: null, held: false })).toBe("off");
    expect(reconcile({ granted: true, routeSaved: false, browser: { keyMatches: true }, held: true })).toBe("off");
  });
});

describe("a replaced subscription is carried over", () => {
  test("the host drops the old endpoint and takes the new one with the same preferences", async () => {
    const lines: PushClientLine[] = [];
    const request = async (line: PushClientLine): Promise<PushHostLine> => {
      lines.push(line);
      return { t: "ok" };
    };
    const prefs = { ...DEFAULT_PUSH_PREFS, muted: ["machine:box"] };
    expect(
      await carryOver(sub("https://fcm.googleapis.com/old"), sub("https://fcm.googleapis.com/new"), prefs, request),
    ).toBe(true);
    expect(lines.map((line) => line.t)).toEqual(["unsubscribe", "subscribe"]);
    expect(lines[0]).toEqual({ t: "unsubscribe", endpoint: "https://fcm.googleapis.com/old" });
    expect(lines[1]).toMatchObject({
      t: "subscribe",
      subscription: { endpoint: "https://fcm.googleapis.com/new" },
      prefs,
    });
  });

  test("with no old subscription known, only the new one is sent", async () => {
    const lines: PushClientLine[] = [];
    await carryOver(null, sub("https://fcm.googleapis.com/new"), DEFAULT_PUSH_PREFS, async (line) => {
      lines.push(line);
      return { t: "ok" };
    });
    expect(lines.map((line) => line.t)).toEqual(["subscribe"]);
  });
});
