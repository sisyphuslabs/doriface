import { describe, expect, test } from "bun:test";
import type { ScreenPrompt } from "./approval-rows.ts";
import { readScreenPrompt } from "./approval-screen.ts";
import {
  CLAUDE_AFTER_SCREEN,
  CLAUDE_PROMPT_SCREEN,
  CLAUDE_SECOND_PROMPT_SCREEN,
  CODEX_AFTER_SCREEN,
  CODEX_PROMPT_SCREEN,
} from "./testing/approval-screens.ts";
import * as recorded from "./testing/prompt-screens.ts";

/** One recorded screen and what the card must read off it: the fields that decide what is shown and pressed. */
interface Case {
  readonly app: "claude-code" | "codex";
  readonly screen: string;
  readonly expected: Partial<ScreenPrompt>;
  /** Each row as `id label [keys] (+open) flags`, in the order drawn. */
  readonly rows: readonly string[];
}

const row = (prompt: ScreenPrompt | undefined) =>
  (prompt?.options ?? []).map((option) =>
    [
      `${option.id} ${option.label}`,
      `[${option.keys.join(" ")}]`,
      ...(option.open.length === 0 ? [] : [`+${option.open.join(" ")}`]),
      ...(option.declines ? ["declines"] : []),
      ...(option.typed ? ["typed"] : []),
      ...(option.checked === undefined ? [] : [option.checked ? "checked" : "unchecked"]),
    ].join(" "),
  );

const CASES: Readonly<Record<string, Case>> = {
  "Claude Code 2.1.311 asks to run a command": {
    app: "claude-code",
    screen: recorded.CLAUDE_BASH_311_SCREEN,
    expected: {
      kind: "permission",
      asks: "wants to run",
      command: "touch probe-a.txt",
      body: "Create the probe file",
      context: ["● I'll create the probe file.", "Creating the probe file", "⎿  $ touch probe-a.txt"],
      cancel: { key: "esc", label: "Cancel" },
      cursor: "1",
    },
    rows: [
      "1 Yes [1]",
      "2 Yes, and always allow access to ~/work from this project [2]",
      "3 Yes, and switch to auto mode · auto mode handles these prompts for you [3]",
      "4 No [4] declines",
    ],
  },
  "Claude Code asks to edit a file, with the diff": {
    app: "claude-code",
    screen: recorded.CLAUDE_EDIT_SCREEN,
    expected: {
      kind: "permission",
      asks: "wants to edit",
      question: "Do you want to make this edit to notes.md?",
      command: "notes.md",
      files: ["notes.md"],
      body: "1  line one\n2 -line two\n2 +line 2",
      context: ["Read 1 file", "● I'll fix the second line of the notes.", "● Update(notes.md)"],
    },
    rows: [
      "1 Yes [1]",
      "2 Yes, and switch to accept edits (auto-approve file edits and common file commands) for this session (shift+tab) [2]",
      "3 No [3] declines",
    ],
  },
  "Claude Code asks to create a file, with its text": {
    app: "claude-code",
    screen: recorded.CLAUDE_CREATE_SCREEN,
    expected: {
      asks: "wants to create",
      command: "README.md",
      files: ["README.md"],
      body: "1 # Probe\n2\n3 A probe file.",
    },
    rows: [
      "1 Yes [1]",
      "2 Yes, and switch to accept edits (auto-approve file edits and common file commands) for this session (shift+tab) [2]",
      "3 No [3] declines",
    ],
  },
  "Claude Code asks one question": {
    app: "claude-code",
    screen: recorded.CLAUDE_QUESTION_SCREEN,
    expected: {
      kind: "question",
      asks: "asks a question",
      question: "Which database should the migration target?",
      context: ["● I need to know which database to use before I write the migration."],
      multi: false,
      cancel: { key: "esc", label: "Cancel" },
      cursor: "1",
      typing: false,
    },
    rows: ["1 Postgres [1]", "2 SQLite [2]", "3 Both [3]", "4 Type something. [4] typed", "5 Chat about this [5]"],
  },
  "Claude Code's question with the cursor on its typed row": {
    app: "claude-code",
    screen: recorded.CLAUDE_QUESTION_TYPING_SCREEN,
    expected: { cursor: "4", typing: true },
    rows: ["1 Postgres [1]", "2 SQLite [2]", "3 Both [3]", "4 Type something. [4] typed", "5 Chat about this [5]"],
  },
  "Claude Code asks a multi-select question": {
    app: "claude-code",
    screen: recorded.CLAUDE_MULTI_SCREEN,
    expected: {
      kind: "question",
      multi: true,
      submit: "right",
      step: { index: 1, count: 2, titles: ["CI checks", "Submit"] },
    },
    rows: ["1 Lint [1] unchecked", "2 Typecheck [2] unchecked", "3 Unit tests [3] unchecked", "5 Chat about this [5]"],
  },
  "Claude Code's multi-select question with one box checked": {
    app: "claude-code",
    screen: recorded.CLAUDE_MULTI_CHECKED_SCREEN,
    expected: { multi: true, step: { index: 2, count: 2, titles: ["CI checks", "Submit"] } },
    rows: ["1 Lint [1] checked", "2 Typecheck [2] unchecked", "3 Unit tests [3] unchecked", "5 Chat about this [5]"],
  },
  "Claude Code asks the first of two questions": {
    app: "claude-code",
    screen: recorded.CLAUDE_STEPS_SCREEN,
    expected: {
      question: "Which runtime should the service use?",
      step: { index: 1, count: 3, titles: ["Runtime", "Deploy", "Submit"] },
    },
    rows: ["1 Bun [1]", "2 Node [2]", "3 Type something. [3] typed", "4 Chat about this [4]"],
  },
  "Claude Code asks the second of two questions": {
    app: "claude-code",
    screen: recorded.CLAUDE_STEPS_SECOND_SCREEN,
    expected: {
      question: "Where should it deploy?",
      step: { index: 2, count: 3, titles: ["Runtime", "Deploy", "Submit"] },
    },
    rows: ["1 Fly [1]", "2 Workers [2]", "3 Type something. [3] typed", "4 Chat about this [4]"],
  },
  "Claude Code asks to submit the answers it shows": {
    app: "claude-code",
    screen: recorded.CLAUDE_REVIEW_SCREEN,
    expected: {
      asks: "asks to submit your answers",
      question: "Ready to submit your answers?",
      body: "● Which runtime should the service use?\n  → Node\n● Where should it deploy?\n  → Fly",
      step: { index: 3, count: 3, titles: ["Runtime", "Deploy", "Submit"] },
    },
    rows: ["1 Submit answers [1]", "2 Cancel [2] declines"],
  },
  "Claude Code asks to approve its plan": {
    app: "claude-code",
    screen: recorded.CLAUDE_PLAN_SCREEN,
    expected: {
      kind: "plan",
      asks: "has a plan ready",
      command: "Add the users migration",
      body: [
        "Add the users migration",
        "",
        "1. Add migrations/004_users.sql with the users table.",
        "2. Run it against SQLite in bun test.",
        "3. Note the new table in README.md.",
      ].join("\n"),
      files: ["~/.claude/plans/do-the-task-plan.md"],
      context: ["● The plan is ready."],
    },
    rows: [
      "1 Yes, and use auto mode [1]",
      "2 Yes, manually approve edits [2]",
      "3 Tell Claude what to change [3] typed",
    ],
  },
  "Claude Code asks to leave plan mode with no plan": {
    app: "claude-code",
    screen: recorded.CLAUDE_EXIT_PLAN_SCREEN,
    expected: { kind: "plan", asks: "wants to leave plan mode", command: "Exit plan mode?", body: "" },
    rows: ["1 Yes, and switch to default (ask each time) for this session [1]", "2 No [2] declines"],
  },
  "Codex 0.167.0 asks to run a command": {
    app: "codex",
    screen: recorded.CODEX_EXEC_167_SCREEN,
    expected: {
      kind: "permission",
      asks: "wants to run",
      command: "touch probe-a.txt",
      body: "Environment: local\nReason: Create the probe file",
      context: ["• Running touch probe-a.txt"],
    },
    rows: [
      "1 Yes, proceed [y]",
      "2 Yes, and don't ask again for commands that start with `touch probe-a.txt` [p]",
      "3 No, and tell Codex what to do differently [esc] declines",
    ],
  },
  "Codex asks to apply an edit": {
    app: "codex",
    screen: recorded.CODEX_PATCH_SCREEN,
    expected: {
      asks: "wants to edit",
      command: "~/work/notes.md",
      files: ["~/work/notes.md"],
      body: "Description: Apply proposed file edits",
      context: [
        "• I'll fix the second line of the notes.",
        "• Edited notes.md (+1 -1)",
        "2 -line two",
        "2 +line 2",
        "+ Show details",
      ],
    },
    rows: [
      "1 Yes, proceed [y]",
      "2 Yes, and don't ask again for these files [a]",
      "3 No, and tell Codex what to do differently [esc] declines",
    ],
  },
  "Codex asks one question": {
    app: "codex",
    screen: recorded.CODEX_QUESTION_SCREEN,
    expected: {
      kind: "question",
      question: "Which database should the migration target?",
      cancel: { key: "esc", label: "Interrupt" },
      cursor: "1",
      typing: false,
    },
    rows: ["1 Postgres (Recommended) [1]", "2 SQLite [2]", "3 None of the above [] +tab typed"],
  },
  "Codex asks the first of two questions": {
    app: "codex",
    screen: recorded.CODEX_STEPS_SCREEN,
    expected: { question: "Which runtime should the service use?", step: { index: 1, count: 2, titles: [] } },
    rows: ["1 Bun (Recommended) [1]", "2 Node [2]", "3 None of the above [] +tab typed"],
  },
  "Codex asks the second of two questions": {
    app: "codex",
    screen: recorded.CODEX_STEPS_SECOND_SCREEN,
    expected: { question: "Where should it deploy?", step: { index: 2, count: 2, titles: [] } },
    rows: ["1 Fly (Recommended) [1]", "2 Workers [2]", "3 None of the above [] +tab typed"],
  },
  "Codex's question with notes open on its typed row": {
    app: "codex",
    screen: recorded.CODEX_NOTES_SCREEN,
    expected: { cursor: "3", typing: true },
    rows: ["1 Postgres (Recommended) [1]", "2 SQLite [2]", "3 None of the above [] +tab typed"],
  },
};

/** The agent's own lines, drawn into the transcript above a dialog, written to look like another dialog's question. */
const above = (screen: string, marker: string, words: readonly string[]) =>
  screen.replace(marker, [...words, "", marker].join("\n"));

describe("reading an agent's prompt off the live screen", () => {
  test.each(Object.entries(CASES))("%s", (_, { app, screen, expected, rows }) => {
    const prompt = readScreenPrompt(app, screen);
    expect(prompt).toMatchObject(expected);
    expect(row(prompt)).toEqual([...rows]);
  });

  test("every recorded screen reads as a prompt of its own agent only", () => {
    for (const [name, screen] of Object.entries(recorded)) {
      const own = name.startsWith("CODEX") ? "codex" : "claude-code";
      const other = own === "codex" ? "claude-code" : "codex";
      expect(readScreenPrompt(own, screen)).toBeDefined();
      expect(readScreenPrompt(other, screen)).toBeUndefined();
      expect(readScreenPrompt("aider", screen)).toBeUndefined();
    }
  });

  test("Claude Code 2.1.306: the command between the dialog's rules, its own description and rows", () => {
    expect(readScreenPrompt("claude-code", CLAUDE_PROMPT_SCREEN)).toMatchObject({
      agent: "Claude Code",
      asks: "wants to run",
      command: "touch probe-a.txt",
      body: "Create the probe file",
    });
    expect(readScreenPrompt("claude-code", CLAUDE_SECOND_PROMPT_SCREEN)?.command).toBe("touch probe-b.txt");
  });

  test("Codex 0.166.0: the $ line is the command, and each row uses the key Codex prints beside it", () => {
    const prompt = readScreenPrompt("codex", CODEX_PROMPT_SCREEN);
    expect(prompt).toMatchObject({ agent: "Codex", asks: "wants to run", command: "touch probe-a.txt" });
    expect(row(prompt)).toEqual([
      "1 Yes, proceed [y]",
      "2 Yes, and don't ask again for commands that start with `touch probe-a.txt` [p]",
      "3 No, and tell Codex what to do differently [esc] declines",
    ]);
  });

  test.each([
    ["claude-code", CLAUDE_AFTER_SCREEN],
    ["codex", CODEX_AFTER_SCREEN],
  ])("%s: once the dialog is gone there is no prompt, even though its transcript is still on screen", (app, screen) => {
    expect(readScreenPrompt(app, screen)).toBeUndefined();
  });

  test("option rows the agent wrapped on a narrow terminal still read as one row each", () => {
    const narrow = CODEX_PROMPT_SCREEN.replace(
      "  3. No, and tell Codex what to do differently (esc)",
      "  3. No, and tell Codex what to do\n     differently (esc)",
    );
    expect(readScreenPrompt("codex", narrow)?.options.at(-1)).toMatchObject({
      label: "No, and tell Codex what to do differently",
      keys: ["esc"],
    });
    const claude = CLAUDE_PROMPT_SCREEN.replace(
      "   2. Yes, and always allow access to ~/work from this project",
      "   2. Yes, and always allow access to ~/work\n      from this project",
    );
    expect(readScreenPrompt("claude-code", claude)?.options[1]?.label).toBe(
      "Yes, and always allow access to ~/work from this project",
    );
  });

  test("moving the cursor to another row is the same prompt, with the cursor where it now is", () => {
    const moved = CLAUDE_PROMPT_SCREEN.replace(" ❯ 1. Yes\n", "   1. Yes\n").replace("   4. No", " ❯ 4. No");
    const before = readScreenPrompt("claude-code", CLAUDE_PROMPT_SCREEN);
    const after = readScreenPrompt("claude-code", moved);
    expect(after?.block).toBe(before?.block ?? "unread");
    expect(after?.cursor).toBe("4");
  });

  test("checking a box is another prompt: what an answer was worked out on has changed", () => {
    const unchecked = readScreenPrompt("claude-code", recorded.CLAUDE_MULTI_SCREEN);
    const checked = readScreenPrompt("claude-code", recorded.CLAUDE_MULTI_CHECKED_SCREEN);
    expect(checked?.block).not.toBe(unchecked?.block ?? "unread");
  });

  test.each([
    [
      "a plan's question",
      ["● Would you like to proceed?", "  1. Delete the old table", "  2. Keep it"],
      recorded.CLAUDE_BASH_311_SCREEN,
      "● I'll create the probe file.",
      { kind: "permission", command: "touch probe-a.txt" },
    ],
    [
      "a permission's question",
      ["● Do you want to delete it?", "  1. Yes", "  2. No", "  Esc to cancel"],
      recorded.CLAUDE_PLAN_SCREEN,
      "● The plan is ready.",
      { kind: "plan", command: "Add the users migration" },
    ],
    [
      "a plan's question, over a question dialog",
      ["● Would you like to proceed?", "  1. Delete the old table"],
      recorded.CLAUDE_QUESTION_SCREEN,
      "● I need to know which database to use before I write the migration.",
      { kind: "question", question: "Which database should the migration target?" },
    ],
  ] as const)(
    "the agent's own text that reads like %s never outranks the dialog drawn below it",
    (_, words, screen, marker, expected) => {
      expect(readScreenPrompt("claude-code", above(screen, marker, words))).toMatchObject(expected);
    },
  );

  test("Codex: the agent's own text that reads like a question never outranks the approval drawn below it", () => {
    const words = [
      "  Question 1/1 (1 unanswered)",
      "  Should I run it?",
      "  1. Yes",
      "  2. No",
      "  enter to submit answer",
    ];
    const screen = above(recorded.CODEX_EXEC_167_SCREEN, "• Running touch probe-a.txt", words);
    expect(readScreenPrompt("codex", screen)).toMatchObject({ kind: "permission", command: "touch probe-a.txt" });
  });

  test("context comes only from the visible screen, between the person's message and the dialog", () => {
    const prompt = readScreenPrompt("claude-code", recorded.CLAUDE_QUESTION_SCREEN);
    expect(prompt?.context.join("\n")).not.toContain("Auto mode");
    expect(prompt?.context.join("\n")).not.toContain("Do the task.");
  });
});
