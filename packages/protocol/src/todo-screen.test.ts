import { describe, expect, test } from "bun:test";
import {
  CLAUDE_NO_TASKS_SCREEN,
  CLAUDE_TASKS_DONE_SCREEN,
  CLAUDE_TASKS_FOLDED_SCREEN,
  CLAUDE_TASKS_HEADER_SCREEN,
  CLAUDE_TASKS_WORKING_SCREEN,
} from "./testing/todo-screens.ts";
import { readTodoProgress } from "./todo-screen.ts";

describe("readTodoProgress: Claude Code's task list", () => {
  test("while it works: the rows under the spinner, done ones counted", () => {
    expect(readTodoProgress("claude-code", CLAUDE_TASKS_WORKING_SCREEN)).toEqual({ done: 2, total: 4 });
  });

  test("a long list folds into one line, whose counts are added", () => {
    expect(readTodoProgress("claude-code", CLAUDE_TASKS_FOLDED_SCREEN)).toEqual({ done: 5, total: 12 });
  });

  test("the count line above the rows is read as it says", () => {
    expect(readTodoProgress("claude-code", CLAUDE_TASKS_DONE_SCREEN)).toEqual({ done: 3, total: 3 });
    expect(readTodoProgress("claude-code", CLAUDE_TASKS_HEADER_SCREEN)).toEqual({ done: 2, total: 4 });
  });

  test("no list on the screen: nothing", () => {
    expect(readTodoProgress("claude-code", CLAUDE_NO_TASKS_SCREEN)).toBeUndefined();
  });

  test("the folded line's other words count toward the total, and a done count among them toward done", () => {
    const screen = [
      "✻ Working… (3s)",
      "  ⎿  ◼ First",
      "     ◻ Second",
      "      … +4 completed, 2 pending",
      "─".repeat(20),
      "❯ ",
    ];
    expect(readTodoProgress("claude-code", screen.join("\n"))).toEqual({ done: 4, total: 8 });
  });

  test("only the last list on the screen counts: an earlier one in the transcript is history", () => {
    const screen = [
      "  ⎿  ✔ Old one",
      "     ◻ Old two",
      "",
      "● Next",
      "✻ Working… (3s)",
      "  ⎿  ✔ New one",
      "     ✔ New two",
      "     ◼ New three",
    ];
    expect(readTodoProgress("claude-code", screen.join("\n"))).toEqual({ done: 2, total: 3 });
  });

  test("an AskUserQuestion tab row is not a task list", () => {
    expect(readTodoProgress("claude-code", "←  ☒ Runtime  ☐ Deploy  ✔ Submit  →")).toBeUndefined();
  });
});

describe("readTodoProgress: other agents", () => {
  test("an agent with no reader gets nothing, whatever the screen shows", () => {
    expect(readTodoProgress("codex", CLAUDE_TASKS_WORKING_SCREEN)).toBeUndefined();
    expect(readTodoProgress("", CLAUDE_TASKS_WORKING_SCREEN)).toBeUndefined();
    expect(readTodoProgress("constructor", CLAUDE_TASKS_WORKING_SCREEN)).toBeUndefined();
  });
});
