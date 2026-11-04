import type { HcConnection } from "@doriface/client";
import {
  answerApproval,
  CLAIM_TTL_MS,
  type ApprovalAnswer,
  type ApprovalCore,
  type ApprovalMark,
  readApproval,
  readApprovalRecord,
  waitsOnApproval,
} from "@doriface/protocol";
import type { ApprovalBannerState } from "@doriface/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "../workspace/model.ts";
import { approvalCore } from "./approval-core.ts";
import { showsPrompt, stateAfterAnswer, stateAfterPrompt } from "./approval-view.ts";
import { thisAnswerer } from "./answerer.ts";

export interface ApprovalView {
  readonly mark: ApprovalMark;
  readonly state: ApprovalBannerState;
  /** While another device holds the prompt: when its claim expires and this one may answer. */
  readonly retryAtMs?: number;
}

export interface Approval extends ApprovalView {
  readonly answer: (answer: ApprovalAnswer) => void;
  readonly dismiss: () => void;
}

/** The status event can land before the agent has drawn its dialog: read again a few times, backing off. */
const DRAW_WAITS_MS = [0, 150, 300, 600, 1200];
const ANSWERED_MS = 4000;

const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (ms === 0 || signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });

async function readWhenDrawn(
  core: ApprovalCore,
  address: string,
  signal: AbortSignal,
  waits: readonly number[] = DRAW_WAITS_MS,
): Promise<ApprovalMark | undefined> {
  const [wait, ...later] = waits;
  if (wait === undefined) return undefined;
  await pause(wait, signal);
  if (signal.aborted) return undefined;
  return (await readApproval(core, address)) ?? readWhenDrawn(core, address, signal, later);
}

/**
 * The permission prompt a terminal's agent waits on, as a banner: found from the agent's status (`blocked`,
 * `kind: permission`) plus its live screen, answered once across every client, and resolved when the agent moves on.
 */
export function useApproval(connection: HcConnection, terminal: Session): Approval | undefined {
  const core = useMemo(() => approvalCore(connection), [connection]);
  const [view, setView] = useState<ApprovalView | undefined>(undefined);
  const current = useRef(view);
  current.current = view;
  const waiting = waitsOnApproval(terminal);

  useEffect(() => {
    const shown = current.current;
    if (!waiting || (shown !== undefined && showsPrompt(shown.mark, terminal))) return;
    const abort = new AbortController();
    const show = async () => {
      try {
        const mark = await readWhenDrawn(core, terminal.address, abort.signal);
        if (mark !== undefined && !abort.signal.aborted) setView({ mark, state: { kind: "waiting" } });
      } catch {
        // The read failed (a dropped connection): no banner; the pane keeps "Needs you" and the terminal stays answerable.
      }
    };
    void show();
    return () => abort.abort();
  }, [core, terminal.address, waiting, terminal.turn]);

  useEffect(() => {
    const shown = current.current;
    const open = shown !== undefined && ["waiting", "failed", "elsewhere"].includes(shown.state.kind);
    if (shown === undefined || !open || showsPrompt(shown.mark, terminal)) return;
    let live = true;
    const resolve = async () => {
      // A failed read means no attribution to show: the banner goes, as if it had been answered in the terminal.
      const record = await readApprovalRecord(core, shown.mark).catch(() => undefined);
      if (!live || current.current?.mark !== shown.mark) return;
      const state = stateAfterPrompt(record, thisAnswerer());
      setView(state === undefined ? undefined : { mark: shown.mark, state });
    };
    void resolve();
    return () => {
      live = false;
    };
  }, [core, terminal]);

  useEffect(() => {
    if (view?.state.kind !== "elsewhere" || view.retryAtMs === undefined) return;
    const back = { mark: view.mark, state: { kind: "waiting" } } as const;
    const timer = setTimeout(
      () => setView((now) => (now === view ? back : now)),
      Math.max(0, view.retryAtMs - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [view]);

  useEffect(() => {
    if (view?.state.kind !== "answered") return;
    const timer = setTimeout(() => setView((now) => (now === view ? undefined : now)), ANSWERED_MS);
    return () => clearTimeout(timer);
  }, [view]);

  if (view === undefined) return undefined;
  return {
    ...view,
    answer: (answer) => {
      if (view.state.kind !== "waiting" && view.state.kind !== "failed") return;
      const { mark } = view;
      setView({ mark, state: { kind: "sending", answer } });
      const self = thisAnswerer();
      const send = async () => {
        try {
          const result = await answerApproval(core, mark, answer, self, Date.now());
          const state = stateAfterAnswer(result, answer, self);
          const retryAtMs = result.kind === "lost" ? result.record.atMs + CLAIM_TTL_MS : undefined;
          setView(retryAtMs === undefined ? { mark, state } : { mark, state, retryAtMs });
        } catch {
          // The claim itself did not get through (a dropped connection): nothing was sent; offer it again.
          setView({ mark, state: { kind: "failed", answer } });
        }
      };
      void send();
    },
    dismiss: () => setView(undefined),
  };
}
