import { describe, expect, test } from "bun:test";
import { answerApproval, readApprovalRecord } from "./approval-answer.ts";
import { markApproval } from "./approval-prompt.ts";
import { MemoryApprovalCore } from "./testing/approval-core.ts";
import {
  CLAUDE_AFTER_SCREEN,
  CLAUDE_PROMPT_SCREEN,
  CLAUDE_SECOND_PROMPT_SCREEN,
  CODEX_PROMPT_SCREEN,
} from "./testing/approval-screens.ts";
import { CLAUDE_BLOCKED, CODEX_BLOCKED, terminalAt } from "./testing/approval-terminal.ts";

const phone = { by: "Safari on iOS", client: "phone-1" };
const laptop = { by: "Chrome on macOS", client: "laptop-1" };

function claudeAt(address: string) {
  const terminal = terminalAt(address, CLAUDE_BLOCKED, { statusMs: 27_091, turn: 1 });
  const mark = markApproval(terminal, CLAUDE_PROMPT_SCREEN);
  if (mark === undefined) throw new Error("fixture did not mark");
  return { core: new MemoryApprovalCore(terminal, CLAUDE_PROMPT_SCREEN), mark, terminal };
}

describe("answering a permission prompt", () => {
  test("Allow presses the agent's own key once and records who answered", async () => {
    const { core, mark } = claudeAt("t3");
    expect(await answerApproval(core, mark, "allow", phone, 5_000)).toEqual({ kind: "sent" });
    expect(core.pressed).toEqual([{ address: "t3", keys: ["1"] }]);
    expect(await readApprovalRecord(core, mark)).toMatchObject({
      answer: "allow",
      by: "Safari on iOS",
      client: "phone-1",
      atMs: 5_000,
      outcome: "sent",
    });
  });

  test("Deny presses the agent's own decline key", async () => {
    const terminal = terminalAt("t4", CODEX_BLOCKED, { statusMs: 29_143, turn: 1 });
    const mark = markApproval(terminal, CODEX_PROMPT_SCREEN);
    if (mark === undefined) throw new Error("fixture did not mark");
    const core = new MemoryApprovalCore(terminal, CODEX_PROMPT_SCREEN);
    expect(await answerApproval(core, mark, "deny", laptop, 1)).toEqual({ kind: "sent" });
    expect(core.pressed).toEqual([{ address: "t4", keys: ["esc"] }]);
  });

  test("stale: the dialog left the screen before the answer, so nothing is pressed", async () => {
    const { core, mark, terminal } = claudeAt("t3");
    core.show(terminal, CLAUDE_AFTER_SCREEN);
    expect(await answerApproval(core, mark, "allow", phone, 1)).toEqual({ kind: "stale" });
    expect(core.pressed).toEqual([]);
    expect((await readApprovalRecord(core, mark))?.outcome).toBe("stale");
  });

  test("stale: another prompt replaced it, so nothing is pressed for the old one", async () => {
    const { core, mark } = claudeAt("t3");
    core.show(terminalAt("t3", CLAUDE_BLOCKED, { statusMs: 30_512, turn: 2 }), CLAUDE_SECOND_PROMPT_SCREEN);
    expect(await answerApproval(core, mark, "allow", phone, 1)).toEqual({ kind: "stale" });
    expect(core.pressed).toEqual([]);
  });

  test("two devices racing on one prompt: exactly one answer reaches the agent, the other learns who won", async () => {
    const { core, mark } = claudeAt("t3");
    const [a, b] = await Promise.all([
      answerApproval(core, mark, "allow", phone, 10),
      answerApproval(core, mark, "deny", laptop, 11),
    ]);
    expect(core.pressed).toHaveLength(1);
    const outcomes = [a, b].map((outcome) => outcome.kind).toSorted();
    expect(outcomes).toEqual(["lost", "sent"]);
    const lost = a.kind === "lost" ? a : b;
    const winner = a.kind === "sent" ? phone : laptop;
    expect(lost.kind === "lost" && lost.record.by).toBe(winner.by);
  });

  test("a claim for a newer prompt of the same terminal does not erase the older prompt's record", async () => {
    const { core, mark } = claudeAt("t3");
    await answerApproval(core, mark, "allow", phone, 1);
    const next = terminalAt("t3", CLAUDE_BLOCKED, { statusMs: 30_512, turn: 2 });
    const nextMark = markApproval(next, CLAUDE_SECOND_PROMPT_SCREEN);
    if (nextMark === undefined) throw new Error("fixture did not mark");
    core.show(next, CLAUDE_SECOND_PROMPT_SCREEN);
    expect(await answerApproval(core, nextMark, "deny", laptop, 2)).toEqual({ kind: "sent" });
    expect((await readApprovalRecord(core, mark))?.by).toBe(phone.by);
    expect((await readApprovalRecord(core, nextMark))?.by).toBe(laptop.by);
  });

  test("a terminal on an added machine keeps its claim on that machine's core", async () => {
    const { core, mark } = claudeAt("box/t3");
    await answerApproval(core, mark, "allow", phone, 1);
    expect(core.docNames()).toEqual(["box:approval.t3"]);
    expect(core.pressed).toEqual([{ address: "box/t3", keys: ["1"] }]);
  });
});
