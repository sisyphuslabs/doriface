import { describe, expect, test } from "bun:test";
import type { ApprovalRecord } from "@doriface/protocol";
import { stateAfterAnswer, stateAfterPrompt } from "./approval-view.ts";

const self = { by: "Chrome on macOS", client: "tab-a" };
const phone: ApprovalRecord = {
  prompt: "1.1.abc",
  answer: "deny",
  by: "Safari on iOS",
  client: "phone",
  atMs: 1,
  outcome: "sent",
};

describe("the banner after an answer", () => {
  test("sent from here reads as answered from this device", () => {
    expect(stateAfterAnswer({ kind: "sent" }, "allow", self)).toEqual({
      kind: "answered",
      answer: "allow",
      where: "from this device",
    });
  });

  test("losing the race shows the winner's answer, not ours, and where it came from", () => {
    expect(stateAfterAnswer({ kind: "lost", record: phone }, "allow", self)).toEqual({
      kind: "answered",
      answer: "deny",
      where: "Answered on another device (Safari on iOS)",
    });
  });

  test("losing to a client that found the prompt gone is stale here too", () => {
    expect(stateAfterAnswer({ kind: "lost", record: { ...phone, outcome: "stale" } }, "allow", self)).toEqual({
      kind: "stale",
    });
  });

  test("a prompt that went away before the key was pressed is stale", () => {
    expect(stateAfterAnswer({ kind: "stale" }, "allow", self)).toEqual({ kind: "stale" });
  });
});

describe("the banner once the agent moved on", () => {
  test("a recorded answer from another device is shown with its device", () => {
    expect(stateAfterPrompt(phone, self)).toMatchObject({
      kind: "answered",
      where: "Answered on another device (Safari on iOS)",
    });
  });

  test("no record means it was answered in the terminal: the banner goes", () => {
    expect(stateAfterPrompt(undefined, self)).toBeUndefined();
  });
});
