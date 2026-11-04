import { describe, expect, test } from "bun:test";
import type { AnswerResult, ApprovalRecord } from "@doriface/protocol";
import { showsPrompt, stateAfterAnswer, stateAfterPrompt } from "./approval-view.ts";

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

describe("the banner never says Allowed without a delivered key", () => {
  test("a failure after the claim shows the failure, with the answer to try again", () => {
    expect(stateAfterAnswer({ kind: "failed", reason: "terminal.read: closed" }, "allow", self)).toEqual({
      kind: "failed",
      answer: "allow",
    });
  });

  test("losing to a claim still in flight says where it is being answered, not that it was", () => {
    expect(stateAfterAnswer({ kind: "lost", record: { ...phone, outcome: "claimed" } }, "allow", self)).toEqual({
      kind: "elsewhere",
      where: "Being answered on another device (Safari on iOS)",
    });
  });

  test.each(["claimed", "failed", "stale"] as const)(
    "a %s record is not shown as answered once the agent moves on",
    (outcome) => {
      expect(stateAfterPrompt({ ...phone, outcome }, self)).toBeUndefined();
    },
  );

  const results: readonly (readonly [string, AnswerResult])[] = [
    ["sent", { kind: "sent" }],
    ["stale", { kind: "stale" }],
    ["failed", { kind: "failed", reason: "x" }],
    ...(["claimed", "sent", "stale", "failed"] as const).map(
      (outcome) => [`lost to ${outcome}`, { kind: "lost", record: { ...phone, outcome } }] as const,
    ),
  ];
  test.each(results)("answered only when a key was delivered: %s", (_, result) => {
    const state = stateAfterAnswer(result, "allow", self);
    const delivered = result.kind === "sent" || (result.kind === "lost" && result.record.outcome === "sent");
    expect(state.kind === "answered").toBe(delivered);
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

describe("is the banner's prompt the one the terminal still reports", () => {
  const blocked = { app: "claude-code", kind: "permission", state: "blocked" } as const;
  const mark = { terminal: "t6", app: "claude-code", statusMs: 27_091, turn: 1 };
  const session = (fields: { status_ms?: number | null; turn?: number; state?: string }) => ({
    address: "t6",
    argv: ["claude"],
    cols: 80,
    created_ms: 1,
    cwd: "/work",
    labels: {},
    rows: 24,
    screen: "exact",
    state: "live",
    status: { ...blocked, state: fields.state ?? "blocked" },
    status_ms: fields.status_ms ?? null,
    turn: fields.turn ?? 1,
  });

  test("a terminal the page learned from events has no status_ms, and still shows the same prompt", () => {
    expect(showsPrompt(mark, session({ status_ms: null }))).toBe(true);
  });

  test("the next prompt comes with the next turn", () => {
    expect(showsPrompt(mark, session({ turn: 2 }))).toBe(false);
  });

  test("once the agent leaves blocked the prompt is over", () => {
    expect(showsPrompt(mark, session({ state: "working" }))).toBe(false);
  });
});
