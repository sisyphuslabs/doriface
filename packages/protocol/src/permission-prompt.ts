import type { Terminal } from "./__generated__/hc-api.ts";
import type { PromptAnswer } from "./push.ts";

/**
 * A permission prompt as it stood when someone was asked about it: the agent's own status record (OSC 7501, never the
 * screen) and the live screen at that moment. Anything that answers it later - a push notice's Allow or Deny (#193),
 * the in-app banner (#192) - checks {@link checkPrompt} against this mark first and sends nothing unless it is pending.
 */
export interface PromptMark {
  readonly app: string;
  readonly statusMs: number;
  readonly turn: number;
  /** The screen as the caller keeps it: its text from {@link screenText}, or a hash of that text. */
  readonly screen: string;
}

export function waitsOnPermission(terminal: Terminal): boolean {
  return terminal.state === "live" && terminal.status?.state === "blocked" && terminal.status.kind === "permission";
}

/** The visible screen of a `terminal.read` reply, without trailing blanks, so a repaint of the same text compares equal. */
export function screenText(read: { readonly text: string }): string {
  return read.text
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trimEnd();
}

export function markPrompt(terminal: Terminal, screen: string): PromptMark | undefined {
  if (!waitsOnPermission(terminal)) return undefined;
  return {
    app: terminal.status?.app ?? "",
    statusMs: terminal.status_ms ?? 0,
    turn: terminal.turn ?? 0,
    screen,
  };
}

/**
 * `gone`: the agent no longer waits on a permission prompt (answered, cancelled, exited). `changed`: it waits on a
 * prompt, but not the marked one (a new status record, another turn, another screen). Only `pending` may be answered.
 */
export type PromptCheck = "pending" | "gone" | "changed";

export function checkPrompt(mark: PromptMark, terminal: Terminal, screen: string): PromptCheck {
  if (!waitsOnPermission(terminal)) return "gone";
  const same =
    (terminal.status?.app ?? "") === mark.app &&
    (terminal.status_ms ?? 0) === mark.statusMs &&
    (terminal.turn ?? 0) === mark.turn &&
    screen === mark.screen;
  return same ? "pending" : "changed";
}

/**
 * The agent's own keys for an answer, as hc `terminal.keys` names them. Only agents listed here can be answered from
 * outside the terminal; any other agent gets no keys, and the caller opens its pane instead.
 */
const ANSWER_KEYS: Readonly<Record<string, { readonly [A in PromptAnswer]: readonly string[] }>> = {
  // Claude Code's permission dialog opens with "Yes" selected; Esc declines.
  claude: { allow: ["enter"], deny: ["esc"] },
  "claude-code": { allow: ["enter"], deny: ["esc"] },
  // Codex's approval dialog takes y to approve; Esc declines.
  codex: { allow: ["y"], deny: ["esc"] },
};

export function answerKeys(app: string, answer: PromptAnswer): readonly string[] | undefined {
  const keys = Object.hasOwn(ANSWER_KEYS, app.toLowerCase()) ? ANSWER_KEYS[app.toLowerCase()] : undefined;
  return keys?.[answer];
}
