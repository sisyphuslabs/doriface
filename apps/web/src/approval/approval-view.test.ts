import { describe, expect, test } from "bun:test";
import type { AnswerResult, ApprovalRecord, PromptReply, ScreenPrompt } from "@doriface/protocol";
import { showsPrompt, stateAfterAnswer, stateAfterPrompt } from "./approval-view.ts";

const prompt: ScreenPrompt = {
  agent: "Claude Code",
  kind: "permission",
  asks: "wants to run",
  question: "Do you want to proceed?",
  command: "touch probe-a.txt",
  body: "",
  context: [],
  files: [],
  multi: false,
  options: [
    { id: "1", label: "Yes", keys: ["1"], open: [], declines: false, typed: false },
    { id: "2", label: "No", keys: ["2"], open: [], declines: true, typed: false },
  ],
  cancel: { key: "esc", label: "Cancel" },
  block: "",
};
const mark = { prompt };
const YES: PromptReply = { kind: "option", option: "1" };

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
    expect(stateAfterAnswer({ kind: "sent" }, mark, YES, self)).toEqual({
      kind: "answered",
      label: "Yes",
      declined: false,
      where: "from this device",
    });
  });

  test("losing the race shows the winner's answer, not ours, and where it came from", () => {
    expect(stateAfterAnswer({ kind: "lost", record: phone }, mark, YES, self)).toEqual({
      kind: "answered",
      label: "Denied",
      declined: true,
      where: "Answered on another device (Safari on iOS)",
    });
  });

  test("the winner's answer reads in the agent's own words when its client recorded them", () => {
    const words = { ...phone, answer: "allow" as const, choice: "SQLite" };
    expect(stateAfterAnswer({ kind: "lost", record: words }, mark, YES, self)).toMatchObject({
      label: "SQLite",
      declined: false,
    });
  });

  test("losing to a client that found the prompt gone is stale here too", () => {
    expect(stateAfterAnswer({ kind: "lost", record: { ...phone, outcome: "stale" } }, mark, YES, self)).toEqual({
      kind: "stale",
    });
  });

  test("a key press that may have landed is shown as unconfirmed, never as answered and never offered again", () => {
    expect(stateAfterAnswer({ kind: "unknown", reason: "keys: closed" }, mark, YES, self)).toEqual({ kind: "unknown" });
    expect(stateAfterAnswer({ kind: "lost", record: { ...phone, outcome: "unknown" } }, mark, YES, self)).toEqual({
      kind: "unknown",
    });
  });

  test("this device's own unconfirmed claim is not shown as another device's", () => {
    const own = { ...phone, client: self.client, by: self.by, outcome: "claimed" as const };
    expect(stateAfterAnswer({ kind: "lost", record: own }, mark, YES, self)).toEqual({
      kind: "elsewhere",
      where: "An earlier answer from this device is not confirmed yet",
    });
  });

  test("a prompt that went away before the key was pressed is stale", () => {
    expect(stateAfterAnswer({ kind: "stale" }, mark, YES, self)).toEqual({ kind: "stale" });
  });
});

describe("the banner never says Allowed without a delivered key", () => {
  test("a failure after the claim shows the failure, with the answer to try again", () => {
    expect(
      stateAfterAnswer({ kind: "failed", reason: "terminal.read: closed", attempt: "a1" }, mark, YES, self),
    ).toEqual({
      kind: "failed",
      choice: YES,
    });
  });

  test("losing to a claim still in flight says where it is being answered, not that it was", () => {
    expect(stateAfterAnswer({ kind: "lost", record: { ...phone, outcome: "claimed" } }, mark, YES, self)).toEqual({
      kind: "elsewhere",
      where: "Being answered on another device (Safari on iOS)",
    });
  });

  test.each(["claimed", "failed", "stale", "unknown"] as const)(
    "a %s record is not shown as answered once the agent moves on",
    (outcome) => {
      expect(stateAfterPrompt({ ...phone, outcome }, self)).toBeUndefined();
    },
  );

  const results: readonly (readonly [string, AnswerResult])[] = [
    ["sent", { kind: "sent" }],
    ["stale", { kind: "stale" }],
    ["failed", { kind: "failed", reason: "x", attempt: "a1" }],
    ["unknown", { kind: "unknown", reason: "x" }],
    ...(["claimed", "sent", "stale", "failed", "unknown"] as const).map(
      (outcome) => [`lost to ${outcome}`, { kind: "lost", record: { ...phone, outcome } }] as const,
    ),
  ];
  test.each(results)("answered only when a key was delivered: %s", (_, result) => {
    const state = stateAfterAnswer(result, mark, YES, self);
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
  const shown = { terminal: "t6", app: "claude-code", statusMs: 27_091, turn: 1 };
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
    expect(showsPrompt(shown, session({ status_ms: null }))).toBe(true);
  });

  test("the next prompt comes with the next turn", () => {
    expect(showsPrompt(shown, session({ turn: 2 }))).toBe(false);
  });

  test("a question the agent waits on is shown like a permission", () => {
    expect(showsPrompt(shown, { ...session({}), status: { ...blocked, kind: "question" } })).toBe(true);
  });

  test("once the agent leaves blocked the prompt is over", () => {
    expect(showsPrompt(shown, session({ state: "working" }))).toBe(false);
  });
});
