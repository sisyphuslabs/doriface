import type { StreamClose } from "@doriface/client";

/**
 * Why a terminal view stopped showing its program, so the tab can decide its fate:
 * - `finished`: the program ended (the core's CLOSE, or a reattach found it no longer live).
 * - `detached`: this viewer let go of it (the view unmounted); the program runs on.
 * - `live`: the connection dropped with the program still running; the view reattaches on the next one.
 */
export type TerminalEnd = "finished" | "detached" | "live";

export function terminalEnd(close: StreamClose): TerminalEnd {
  switch (close.by) {
    case "core":
      return "finished";
    case "viewer":
      return "detached";
    case "connection":
      return "live";
  }
}

/** Only a program that ended closes its tab; a detach or a lost connection keeps it. */
export function closesTab(end: TerminalEnd): boolean {
  return end === "finished";
}
