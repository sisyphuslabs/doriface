import type { AnswerResult, Answerer, ApprovalAnswer, ApprovalRecord } from "@doriface/protocol";
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
    case "lost":
      return result.record.outcome === "stale"
        ? { kind: "stale" }
        : { kind: "answered", answer: result.record.answer, where: answeredWhere(result.record, self) };
  }
}

/**
 * The banner once the agent moved past the prompt this client was showing: answered, with who answered it, when a client
 * recorded an answer; nothing when none did (it was answered or cancelled in the terminal, which shows that itself).
 */
export function stateAfterPrompt(record: ApprovalRecord | undefined, self: Answerer): ApprovalBannerState | undefined {
  if (record === undefined || record.outcome === "stale") return undefined;
  return { kind: "answered", answer: record.answer, where: answeredWhere(record, self) };
}
