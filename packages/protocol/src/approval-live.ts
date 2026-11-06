import type { Terminal } from "./__generated__/hc-api.ts";
import { type ApprovalCheck, type ApprovalMark, checkApproval, markApproval } from "./approval-prompt.ts";
import type { ScreenPrompt } from "./approval-rows.ts";
import { readScreenPrompt } from "./approval-screen.ts";
import type { JsonValue } from "./json.ts";

/**
 * The hc calls an approval needs, on the core that holds the terminal: the web client builds it from its hc connection,
 * the host from its own. `doc`/`setDoc` address a document on another machine with `on` (a terminal `box/t3`'s claim lives
 * on `box`); `setDoc` reports a version conflict as `"conflict"` instead of throwing.
 */
export interface ApprovalCore {
  terminal(address: string): Promise<Terminal>;
  /** The visible screen only (`terminal.read` with `lines: 0`). */
  screen(address: string): Promise<string>;
  keys(address: string, keys: readonly string[]): Promise<void>;
  /** Pastes `text` and presses Enter (`terminal.send` with `force`, since the agent is blocked on the dialog it answers). */
  send(address: string, text: string): Promise<void>;
  doc(name: string, on: string | undefined): Promise<{ readonly value: JsonValue; readonly version: number }>;
  setDoc(name: string, on: string | undefined, value: JsonValue, version: number): Promise<"ok" | "conflict">;
}

/** The prompt a terminal shows right now, read from the live screen, or nothing. */
export async function readApproval(core: ApprovalCore, address: string): Promise<ApprovalMark | undefined> {
  const [terminal, screen] = await Promise.all([core.terminal(address), core.screen(address)]);
  return markApproval(terminal, screen);
}

/**
 * Is the marked prompt still there: a fresh `terminal.get` and `terminal.read` of the live screen, checked against the
 * mark, with the prompt as that screen shows it (where its cursor is, which boxes are checked). The card (#192, #669)
 * and a push notice's answer (#193) both call this right before pressing a key, and press nothing unless it says
 * `pending`.
 */
export async function livePrompt(
  core: ApprovalCore,
  mark: ApprovalMark,
): Promise<{ readonly check: ApprovalCheck; readonly now: ScreenPrompt | undefined }> {
  const [terminal, screen] = await Promise.all([core.terminal(mark.terminal), core.screen(mark.terminal)]);
  return { check: checkApproval(mark, terminal, screen), now: readScreenPrompt(terminal.status?.app ?? "", screen) };
}

/** {@link livePrompt}'s check alone. */
export async function promptStillThere(core: ApprovalCore, mark: ApprovalMark): Promise<ApprovalCheck> {
  return (await livePrompt(core, mark)).check;
}
