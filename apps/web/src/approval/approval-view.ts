import {
  type AnswerResult,
  type Answerer,
  type ApprovalAnswer,
  type ApprovalMark,
  type ApprovalRecord,
  type Terminal,
  waitsOnApproval,
} from "@doriface/protocol";
import type { ApprovalBannerState } from "@doriface/ui";

export function answeredWhere(record: Pick<ApprovalRecord, "by" | "client">, self: Answerer): string {
  return record.client === self.client ? "from this device" : `Answered on another device (${record.by})`;
}

export function stateAfterAnswer(result: AnswerResult, answer: ApprovalAnswer, self: Answerer): ApprovalBannerState {
  switch (result.kind) {
    case "sent":
      return { kind: "answered", answer, where: answeredWhere(self, self) };
    case "stale":
      return { kind: "stale" };
    case "failed":
      return { kind: "failed", answer };
    case "unknown":
      return { kind: "unknown" };
    case "lost":
      return stateAfterLoss(result.record, self);
  }
}

/** Another client holds the prompt: answered only once its record says the key was delivered. */
function stateAfterLoss(record: ApprovalRecord, self: Answerer): ApprovalBannerState {
  switch (record.outcome) {
    case "sent":
      return { kind: "answered", answer: record.answer, where: answeredWhere(record, self) };
    case "claimed":
      return {
        kind: "elsewhere",
        where:
          record.client === self.client
            ? "An earlier answer from this device is not confirmed yet"
            : `Being answered on another device (${record.by})`,
      };
    case "unknown":
      return { kind: "unknown" };
    case "stale":
    case "failed":
      return { kind: "stale" };
  }
}

/**
 * The banner once the agent moved past the prompt this client was showing: answered, with who answered it, when a client
 * recorded a delivered key; nothing otherwise (it was answered or cancelled in the terminal, which shows that itself; a
 * claim that never delivered a key is not an answer).
 */
export function stateAfterPrompt(record: ApprovalRecord | undefined, self: Answerer): ApprovalBannerState | undefined {
  if (record?.outcome !== "sent") return undefined;
  return { kind: "answered", answer: record.answer, where: answeredWhere(record, self) };
}

/**
 * The terminal still reports the prompt the banner shows: blocked on a permission, at the same turn (each prompt comes
 * with a new one). Its `status_ms` is not compared here: hc's `status` event does not carry it, so a terminal the page
 * learned about from events never has one. `checkApproval` compares it against a fresh `terminal.get` before any key.
 */
export function showsPrompt(mark: Pick<ApprovalMark, "terminal" | "turn">, terminal: Terminal): boolean {
  return terminal.address === mark.terminal && waitsOnApproval(terminal) && (terminal.turn ?? 0) === mark.turn;
}
