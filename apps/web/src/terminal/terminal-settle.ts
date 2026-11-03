import { HcRpcError, type Terminal } from "@doriface/protocol";

/** The core's answer about a terminal (terminal.get), or why it gave none. */
export type CoreAnswer = { readonly terminal: Pick<Terminal, "state" | "pid"> } | { readonly error: unknown };

/**
 * What a view does once the core ended its stream without the program finishing, or refused an attach:
 * - `finished`: the program is over, or the core no longer knows the terminal; the tab closes.
 * - `restarting`: lost, waiting for its new shell; the restarted program's pid gives the terminal a new view.
 * - `replaced`: another program runs there now; its own view attaches to it.
 * - `reattach`: the same program still runs; attach to it again.
 * - `error`: show why it could not be opened.
 */
export type Settled = "finished" | "restarting" | "replaced" | "reattach" | "error";

export function settled(answer: CoreAnswer, program: number | null, first: boolean, refused: boolean): Settled {
  if ("error" in answer) return unknownToCore(answer.error) ? "finished" : "error";
  const { state, pid } = answer.terminal;
  // A first attach to a finished terminal keeps its error; a program that ended while the line was down sent no
  // CLOSE, so its tab closes as that CLOSE would have.
  if (state !== "live") return refused && first ? "error" : "finished";
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
