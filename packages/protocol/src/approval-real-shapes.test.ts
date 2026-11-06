import { describe, expect, test } from "bun:test";
import { readScreenPrompt } from "./approval-screen.ts";
import * as recorded from "./testing/prompt-screens.ts";

// The readers of #776 refuse what they cannot tell apart from the agent's own text. Each case here is a real prompt
// in a shape the agents draw, which they must still read.

describe("real prompts the bottom-up readers still read", () => {
  test.each([
    ["• Added notes.md (+1)", "a new file"],
    ["• Deleted notes.md (-2)", "a removed file"],
    ["• Edited notes.md (+1 -1)", "an edited file"],
  ])("Codex: an approval under its %s cell (%s) reads as the edit", (cell) => {
    const screen = recorded.CODEX_PATCH_SCREEN.replace("• Edited notes.md (+1 -1)", cell);
    expect(readScreenPrompt("codex", screen)).toMatchObject({ kind: "permission", files: ["~/work/notes.md"] });
  });

  test("Codex: a question whose row wraps on a narrow pane reads as one row with its whole description", () => {
    const screen = recorded.CODEX_QUESTION_SCREEN.replace(
      "    2. SQLite                  The local test database",
      "    2. SQLite                  The local test\n                               database",
    );
    const prompt = readScreenPrompt("codex", screen);
    expect(prompt?.options.map((option) => [option.id, option.label, option.detail])).toEqual([
      ["1", "Postgres (Recommended)", "The production database"],
      ["2", "SQLite", "The local test database"],
      ["3", "None of the above", "Optionally, add details in notes (tab)"],
    ]);
  });

  test("Claude Code: question text that reads like the review step is still the question", () => {
    const screen = recorded.CLAUDE_QUESTION_SCREEN.replace(
      "Which database should the migration target?",
      ["Which database should the migration target?", "Review your answers", "Ready to submit your answers?"].join(
        "\n",
      ),
    );
    expect(readScreenPrompt("claude-code", screen)).toMatchObject({
      kind: "question",
      asks: "asks a question",
      question: "Which database should the migration target? Review your answers Ready to submit your answers?",
    });
    expect(readScreenPrompt("claude-code", screen)?.options.some((option) => option.declines)).toBe(false);
  });
});
