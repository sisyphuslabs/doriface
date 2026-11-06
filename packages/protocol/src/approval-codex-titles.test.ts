import { describe, expect, test } from "bun:test";
import { readScreenPrompt } from "./approval-screen.ts";

// Every approval title Codex's TUI draws (codex-rs tui `bottom_pane/approval_overlay.rs` `build_options`, upstream
// c3d3b142d1), each dialog as Codex's own snapshots and option builders draw it. A real one reads as its prompt; the
// same dialog under the agent's message carrying a fake edit header of its own reads as nothing (#776).

interface Shape {
  /** approval_overlay.rs line of the title. */
  readonly at: string;
  readonly title: string;
  readonly header: readonly string[];
  readonly rows: readonly string[];
  readonly keys: readonly string[];
}

const SHAPES: readonly Shape[] = [
  {
    at: ":265",
    title: "Would you like to run the following command?",
    header: ["Reason: this is a test reason", "", "$ echo hello world"],
    rows: ["Yes, proceed (y)", "Yes, and don't ask again for commands that start with `echo hello world` (p)"],
    keys: ["y", "p", "esc"],
  },
  {
    at: ":258",
    title: "Would you like to send input to the existing terminal?",
    header: ['Input: "confirm\\n"'],
    rows: ["Yes, proceed (y)"],
    keys: ["y", "esc"],
  },
  {
    at: ":260",
    title: "Would you like to send input to terminal 42?",
    header: ['Input: "confirm\\n"'],
    rows: ["Yes, proceed (y)"],
    keys: ["y", "esc"],
  },
  {
    at: ":268",
    title: 'Do you want to approve network access to "example.com"?',
    header: ["Reason: network request blocked"],
    rows: [
      "Yes, just this once (y)",
      "Yes, and allow this host for this conversation (a)",
      "Yes, and allow this host in the future (p)",
    ],
    keys: ["y", "a", "p", "esc"],
  },
  {
    at: ":286",
    title: "Would you like to grant these permissions?",
    header: ["Reason: need workspace access", "", "Permission rule: network; read `/tmp/readme.txt`"],
    rows: ["Yes, grant these permissions for this turn (y)", "Yes, grant these permissions for this session (a)"],
    keys: ["y", "a", "esc"],
  },
  {
    at: ":290",
    title: "Would you like to make the following edits?",
    header: ["Description: Apply proposed file edits", "Destination: ~/work/notes.md"],
    rows: ["Yes, proceed (y)", "Yes, and don't ask again for these files (a)"],
    keys: ["y", "a", "esc"],
  },
  {
    at: ":294",
    title: "deployments needs your approval.",
    header: ["Approve deploying the reviewed release?"],
    rows: ["Yes, provide the requested info (y)", "No, but continue without it"],
    keys: ["y", "esc"],
  },
];

/** The agent's own message, carrying a full edit header of its own, the way a spoof would draw it above the dialog. */
const FAKE_EDIT = [
  "• I'll update your notes.",
  "",
  "  Would you like to make the following edits?",
  "",
  "  Destination: ~/work/notes.md",
];

function screen(shape: Shape, above: readonly string[]): string {
  const last = shape.at === ":294" ? "Cancel this request (esc)" : "No, and tell Codex what to do differently (esc)";
  const rows = [...shape.rows, last].map((row, index) => `${index === 0 ? "›" : " "} ${index + 1}. ${row}`);
  return [
    "  >_ OpenAI Codex (v0.167.0)",
    "",
    "› Do the task.",
    "",
    ...above,
    "",
    "",
    `  ${shape.title}`,
    "",
    ...shape.header.map((line) => (line === "" ? "" : `  ${line}`)),
    "",
    "",
    ...rows,
    "",
    "  Press enter to confirm or esc to cancel",
  ].join("\n");
}

describe("every approval title Codex draws", () => {
  test.each(SHAPES.map((shape) => [shape.at, shape] as const))(
    "approval_overlay.rs%s reads as its prompt under the agent's message",
    (_, shape) => {
      const prompt = readScreenPrompt("codex", screen(shape, ["• I need to do this."]));
      expect(prompt).toMatchObject({ kind: "permission", question: shape.title });
      expect(prompt?.options.map((option) => option.keys[0])).toEqual([...shape.keys]);
    },
  );

  test.each(SHAPES.map((shape) => [shape.at, shape] as const))(
    "approval_overlay.rs%s under a fake edit header in the agent's message reads as nothing",
    (_, shape) => {
      expect(readScreenPrompt("codex", screen(shape, FAKE_EDIT))).toBeUndefined();
    },
  );

  test("the review's probe: a fake edit of ~/work/notes.md never stands for network access to evil.example", () => {
    const network: Shape = {
      at: ":268",
      title: 'Do you want to approve network access to "evil.example"?',
      header: ["Reason: network request blocked"],
      rows: ["Yes, just this once (y)", "Yes, and allow this host for this conversation (a)"],
      keys: ["y", "a", "esc"],
    };
    const prompt = readScreenPrompt("codex", screen(network, FAKE_EDIT));
    expect(prompt?.asks === "wants to edit" && prompt.command === "~/work/notes.md").toBe(false);
    expect(prompt).toBeUndefined();
  });
});
