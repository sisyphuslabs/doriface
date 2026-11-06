import type { Terminal } from "./__generated__/hc-api.ts";
import { readScreenPrompt, type ScreenPrompt } from "./approval-screen.ts";

/**
 * A permission prompt as it stood when someone was asked about it: the agent's own OSC 7501 record (`app`, `status_ms`,
 * `turn`; each prompt gets a new turn and a new `status_ms`, measured on Claude Code 2.1.306 and Codex 0.166.0) plus a
 * hash of the dialog it drew. Anything that answers it later checks {@link checkApproval} against this mark first.
 */
export interface ApprovalMark {
  readonly terminal: string;
  readonly app: string;
  /** The directory the agent works in, as the core reports it (its foreground program's, else the terminal's). */
  readonly cwd: string;
  readonly statusMs: number;
  readonly turn: number;
  /** A hash of the prompt's dialog ({@link ScreenPrompt.block}), 16 hex digits. */
  readonly screen: string;
  readonly prompt: ScreenPrompt;
}

/** `pending`: the marked prompt is up. `gone`: no prompt is (answered, cancelled, exited). `changed`: another one is. */
export type ApprovalCheck = "pending" | "gone" | "changed";

/** The record kinds of a person's decision an agent waits on: a permission (or a plan to approve), or a question. */
const ASKING_KINDS: ReadonlySet<unknown> = new Set(["permission", "question"]);

/**
 * The agent says it waits on a person's decision: its OSC 7501 root record is `blocked` with `kind: permission` (Claude
 * Code and Codex approvals, Claude Code's plan approval) or `kind: question` (Claude Code's AskUserQuestion, Codex's
 * request_user_input), as measured on Claude Code 2.1.311 and Codex 0.167.0.
 */
export function waitsOnApproval(terminal: Terminal): boolean {
  return terminal.state === "live" && terminal.status?.state === "blocked" && ASKING_KINDS.has(terminal.status.kind);
}

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK = 0xffffffffffffffffn;

/** FNV-1a over the text's UTF-8 bytes: a stable identity for a dialog, not a secret. */
export function screenHash(text: string): string {
  let hash = FNV_OFFSET;
  for (const byte of new TextEncoder().encode(text)) hash = ((hash ^ BigInt(byte)) * FNV_PRIME) & MASK;
  return hash.toString(16).padStart(16, "0");
}

function promptOn(terminal: Terminal, screen: string): ScreenPrompt | undefined {
  return readScreenPrompt(terminal.status?.app ?? "", screen);
}

/** The prompt to show for a terminal and its `terminal.read` screen, or nothing when it is not one this client can answer. */
export function markApproval(terminal: Terminal, screen: string): ApprovalMark | undefined {
  if (!waitsOnApproval(terminal)) return undefined;
  const prompt = promptOn(terminal, screen);
  if (prompt === undefined) return undefined;
  return {
    terminal: terminal.address,
    app: terminal.status?.app ?? "",
    cwd: terminal.foreground?.cwd ?? terminal.cwd,
    statusMs: terminal.status_ms ?? 0,
    turn: terminal.turn ?? 0,
    screen: screenHash(prompt.block),
    prompt,
  };
}

/** Whether the marked prompt is still the one up, from a fresh `terminal.get` and `terminal.read`. Only `pending` may be answered. */
export function checkApproval(mark: ApprovalMark, terminal: Terminal, screen: string): ApprovalCheck {
  if (!waitsOnApproval(terminal)) return "gone";
  const prompt = promptOn(terminal, screen);
  if (prompt === undefined) return "gone";
  const same =
    terminal.address === mark.terminal &&
    (terminal.status?.app ?? "") === mark.app &&
    (terminal.status_ms ?? 0) === mark.statusMs &&
    (terminal.turn ?? 0) === mark.turn &&
    screenHash(prompt.block) === mark.screen;
  return same ? "pending" : "changed";
}

/** One prompt's identity as text: the same on every client that marked it. */
export function approvalKey(mark: ApprovalMark): string {
  return `${mark.statusMs}.${mark.turn}.${mark.screen}`;
}
