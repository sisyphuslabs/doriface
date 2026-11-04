import { describe, expect, test } from "bun:test";
import type { Terminal } from "./__generated__/hc-api.ts";
import { answerKeys, checkPrompt, markPrompt, screenText } from "./permission-prompt.ts";

const base: Terminal = {
  address: "t3",
  argv: ["claude"],
  cols: 80,
  rows: 24,
  created_ms: 1,
  cwd: "/work",
  labels: {},
  screen: "exact",
  state: "live",
};
const waiting = (fields: Partial<Terminal> = {}): Terminal => ({
  ...base,
  status: { state: "blocked", kind: "permission", app: "claude" },
  status_ms: 1_000,
  turn: 4,
  ...fields,
});
const SCREEN = "Run rm -rf build?\n> 1. Yes\n  2. No";

describe("the shared stale-prompt check", () => {
  test("a prompt marked and unchanged is pending", () => {
    const mark = markPrompt(waiting(), SCREEN);
    expect(mark).toEqual({ app: "claude", statusMs: 1_000, turn: 4, screen: SCREEN });
    expect(mark === undefined ? undefined : checkPrompt(mark, waiting(), SCREEN)).toBe("pending");
  });

  test("only a permission prompt can be marked", () => {
    expect(
      markPrompt(waiting({ status: { state: "blocked", kind: "question", app: "claude" } }), SCREEN),
    ).toBeUndefined();
    expect(markPrompt(waiting({ status: { state: "working", app: "claude" } }), SCREEN)).toBeUndefined();
    expect(markPrompt(waiting({ state: "finished" }), SCREEN)).toBeUndefined();
  });

  test.each([
    [
      "answered in the terminal: the agent works again",
      waiting({ status: { state: "working", app: "claude" } }),
      SCREEN,
      "gone",
    ],
    ["the agent exited", waiting({ state: "finished" }), SCREEN, "gone"],
    ["a new prompt: a new status record", waiting({ status_ms: 2_000 }), SCREEN, "changed"],
    ["a prompt of a later turn", waiting({ turn: 5 }), SCREEN, "changed"],
    ["the screen moved (another prompt, another selection)", waiting(), "Run git push?\n> 1. Yes", "changed"],
    [
      "another agent in the same terminal",
      waiting({ status: { state: "blocked", kind: "permission", app: "codex" } }),
      SCREEN,
      "changed",
    ],
  ] as const)("%s", (_, now, screen, verdict) => {
    const mark = markPrompt(waiting(), SCREEN);
    expect(mark === undefined ? undefined : checkPrompt(mark, now, screen)).toBe(verdict);
  });

  test("a repaint with trailing blanks reads as the same screen", () => {
    expect(screenText({ text: "a   \nb\n\n\n" })).toBe(screenText({ text: "a\nb" }));
  });

  test("only listed agents get keys; anything else gets none", () => {
    expect(answerKeys("claude", "allow")).toEqual(["enter"]);
    expect(answerKeys("Claude", "deny")).toEqual(["esc"]);
    expect(answerKeys("codex", "allow")).toEqual(["y"]);
    expect(answerKeys("my-agent", "allow")).toBeUndefined();
    expect(answerKeys("", "deny")).toBeUndefined();
    expect(answerKeys("toString", "allow")).toBeUndefined();
  });
});
