import { HcRpcError, type Terminal } from "@doriface/protocol";

/** The core's answer about a terminal (terminal.get), or why it gave none. */
export type CoreAnswer = { readonly terminal: Pick<Terminal, "state" | "pid"> } | { readonly error: unknown };

/**
 * What a view does once the core ended its stream without the program finishing, or refused an attach:
 * - `finished`: the program is over, or the core no longer knows the terminal; the tab closes.
 * - `ended`: a first attach found the program already over; the view says it ended and offers to close the tab.
 * - `restarting`: lost, waiting for its new shell; the restarted program's pid gives the terminal a new view.
 * - `replaced`: another program runs there now; its own view attaches to it.
 * - `reattach`: the same program still runs; attach to it again.
 * - `error`: show why it could not be opened.
 */
export type Settled = "finished" | "ended" | "restarting" | "replaced" | "reattach" | "error";

export function settled(answer: CoreAnswer, program: number | null, first: boolean, refused: boolean): Settled {
  if ("error" in answer) return unknownToCore(answer.error) ? "finished" : "error";
  const { state, pid } = answer.terminal;
  // A program that ended while this view's line was down sent it no CLOSE, so its tab closes as that CLOSE would have.
  // A new view (a reload, or a machine that was offline) never saw the program run, so it shows it ended: the core's
  // state says so, whether or not this page had the terminal open.
  if (state !== "live") return refused && first ? "ended" : "finished";
  if (pid === null || pid === undefined) return "restarting";
  if (pid !== program) return "replaced";
  return refused ? "error" : "reattach";
}

/** Why input still queued in a view that goes away was never sent, as the notice words it; null names no reason. */
export type Unsent = "restarted" | "ended" | null;

export function unsentReason(answer: CoreAnswer, program: number | null): Unsent {
  if ("error" in answer) return unknownToCore(answer.error) ? "ended" : null;
  if (answer.terminal.state !== "live") return "ended";
  return (answer.terminal.pid ?? null) === program ? null : "restarted";
}

const unknownToCore = (error: unknown): boolean => error instanceof HcRpcError && error.kind === "not_found";
