import { describe, expect, test } from "bun:test";
import { approvalKey, checkApproval, markApproval } from "./approval-prompt.ts";
import { CLAUDE_AFTER_SCREEN, CLAUDE_PROMPT_SCREEN, CLAUDE_SECOND_PROMPT_SCREEN } from "./testing/approval-screens.ts";
import { CLAUDE_BLOCKED, terminalAt } from "./testing/approval-terminal.ts";

const waiting = terminalAt("t3", CLAUDE_BLOCKED, { statusMs: 27_091, turn: 1 });

describe("marking the prompt a person is asked about", () => {
  test("carries the agent's own status record and the prompt as drawn", () => {
    const mark = markApproval(waiting, CLAUDE_PROMPT_SCREEN);
    expect(mark).toMatchObject({ terminal: "t3", app: "claude-code", statusMs: 27_091, turn: 1 });
    expect(mark?.prompt.command).toBe("touch probe-a.txt");
    expect(mark?.screen).toMatch(/^[0-9a-f]{16}$/);
  });

  test.each([
    ["not blocked", terminalAt("t3", { app: "claude-code", state: "working" })],
    ["blocked on a question", terminalAt("t3", { ...CLAUDE_BLOCKED, kind: "question" })],
    ["finished", terminalAt("t3", CLAUDE_BLOCKED, { state: "finished" })],
    ["never reported", terminalAt("t3", null)],
  ])("nothing to mark when %s", (_, terminal) => {
    expect(markApproval(terminal, CLAUDE_PROMPT_SCREEN)).toBeUndefined();
  });

  test("nothing to mark when the status says permission but the dialog is not on screen", () => {
    expect(markApproval(waiting, CLAUDE_AFTER_SCREEN)).toBeUndefined();
  });

  test("two prompts in one session have different keys", () => {
    const first = markApproval(waiting, CLAUDE_PROMPT_SCREEN);
    const second = markApproval(
      terminalAt("t3", CLAUDE_BLOCKED, { statusMs: 30_512, turn: 2 }),
      CLAUDE_SECOND_PROMPT_SCREEN,
    );
    expect(first && second && approvalKey(first) !== approvalKey(second)).toBe(true);
  });
});

describe("is the marked prompt still there", () => {
  const mark = markApproval(waiting, CLAUDE_PROMPT_SCREEN);
  if (mark === undefined) throw new Error("fixture did not mark");

  test("pending while the same record and the same dialog are up", () => {
    expect(checkApproval(mark, waiting, CLAUDE_PROMPT_SCREEN)).toBe("pending");
  });

  test("gone once the agent leaves blocked", () => {
    expect(checkApproval(mark, terminalAt("t3", { app: "claude-code", state: "working" }), CLAUDE_PROMPT_SCREEN)).toBe(
      "gone",
    );
  });

  test("gone when the dialog left the screen before the status caught up (answered in the terminal)", () => {
    expect(checkApproval(mark, waiting, CLAUDE_AFTER_SCREEN)).toBe("gone");
  });

  test("changed when another prompt took its place", () => {
    const next = terminalAt("t3", CLAUDE_BLOCKED, { statusMs: 30_512, turn: 2 });
    expect(checkApproval(mark, next, CLAUDE_SECOND_PROMPT_SCREEN)).toBe("changed");
    expect(checkApproval(mark, waiting, CLAUDE_SECOND_PROMPT_SCREEN)).toBe("changed");
  });

  test("still pending when only the cursor row moved", () => {
    const moved = CLAUDE_PROMPT_SCREEN.replace(" ❯ 1. Yes\n", "   1. Yes\n").replace("   2. Yes,", " ❯ 2. Yes,");
    expect(checkApproval(mark, waiting, moved)).toBe("pending");
  });
});
