import { describe, expect, test } from "bun:test";
import { readScreenPrompt } from "./approval-screen.ts";
import {
  CLAUDE_AFTER_SCREEN,
  CLAUDE_PROMPT_SCREEN,
  CLAUDE_SECOND_PROMPT_SCREEN,
  CODEX_AFTER_SCREEN,
  CODEX_PROMPT_SCREEN,
} from "./testing/approval-screens.ts";

describe("reading a permission prompt off the live screen", () => {
  test("Claude Code: the command between the dialog's rules, Allow on its own 'Yes' row, Deny on esc", () => {
    const prompt = readScreenPrompt("claude-code", CLAUDE_PROMPT_SCREEN);
    expect(prompt).toMatchObject({
      agent: "Claude Code",
      asks: "wants to run",
      command: "touch probe-a.txt",
      keys: { allow: "1", deny: "esc" },
    });
  });

  test("Claude Code: the next prompt in the session reads as its own command", () => {
    expect(readScreenPrompt("claude-code", CLAUDE_SECOND_PROMPT_SCREEN)?.command).toBe("touch probe-b.txt");
  });

  test("Codex: the $ line is the command, and each answer uses the key Codex prints beside it", () => {
    const prompt = readScreenPrompt("codex", CODEX_PROMPT_SCREEN);
    expect(prompt).toMatchObject({
      agent: "Codex",
      asks: "wants to run",
      command: "touch probe-a.txt",
      keys: { allow: "y", deny: "esc" },
    });
  });

  test.each([
    ["claude-code", CLAUDE_AFTER_SCREEN],
    ["codex", CODEX_AFTER_SCREEN],
  ])("%s: once the dialog is gone there is no prompt, even though its transcript is still on screen", (app, screen) => {
    expect(readScreenPrompt(app, screen)).toBeUndefined();
  });

  test("a screen is only read by its own agent's parser", () => {
    expect(readScreenPrompt("codex", CLAUDE_PROMPT_SCREEN)).toBeUndefined();
    expect(readScreenPrompt("claude-code", CODEX_PROMPT_SCREEN)).toBeUndefined();
    expect(readScreenPrompt("aider", CLAUDE_PROMPT_SCREEN)).toBeUndefined();
  });

  test("without a plain 'Yes' row there is no Allow key to press, so the prompt is not answerable here", () => {
    const noYes = CLAUDE_PROMPT_SCREEN.replace(" ❯ 1. Yes\n", " ❯ 1. Yes, and always allow\n");
    expect(readScreenPrompt("claude-code", noYes)).toBeUndefined();
  });

  test("option rows the agent wrapped on a narrow terminal still read as one row each", () => {
    const narrow = CODEX_PROMPT_SCREEN.replace(
      "  3. No, and tell Codex what to do differently (esc)",
      "  3. No, and tell Codex what to do\n     differently (esc)",
    );
    expect(readScreenPrompt("codex", narrow)?.keys).toEqual({ allow: "y", deny: "esc" });
    const claude = CLAUDE_PROMPT_SCREEN.replace(" ❯ 1. Yes\n", " ❯ 1. Yes\n").replace(
      "   2. Yes, and always allow access to ~/work from this project",
      "   2. Yes, and always allow access to ~/work\n      from this project",
    );
    expect(readScreenPrompt("claude-code", claude)?.keys.allow).toBe("1");
  });

  test("moving the cursor to another row is the same prompt", () => {
    const moved = CLAUDE_PROMPT_SCREEN.replace(" ❯ 1. Yes\n", "   1. Yes\n").replace("   4. No", " ❯ 4. No");
    const before = readScreenPrompt("claude-code", CLAUDE_PROMPT_SCREEN);
    const after = readScreenPrompt("claude-code", moved);
    expect(after?.block).toBe(before?.block ?? "unread");
    expect(after?.keys.allow).toBe("1");
  });
});
