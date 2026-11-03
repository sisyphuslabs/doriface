import type { StreamClose } from "@doriface/client";

/**
 * Why a terminal view stopped showing its program, so the tab can decide its fate:
 * - `finished`: the program ended; the core's CLOSE carries its exit facts (or a reattach found it no longer live).
 * - `lost`: the core ended the stream without the program finishing, as when a kept terminal's program is lost and
 *   restarted in place; the terminal stays, and the view attaches to the program that runs in it next.
 * - `detached`: this viewer let go of it (the view unmounted); the program runs on.
 * - `dropped`: the connection went away; the client knows nothing about the program, and the view reattaches.
 */
export type TerminalEnd = "finished" | "lost" | "detached" | "dropped";

export function terminalEnd(close: StreamClose): TerminalEnd {
  switch (close.by) {
    case "core":
      return close.finished_ms === null ? "lost" : "finished";
    case "viewer":
      return "detached";
    case "connection":
      return "dropped";
  }
}

/** Only a program that ended closes its tab; a loss, a detach or a dropped connection keeps it. */
export function closesTab(end: TerminalEnd): boolean {
  return end === "finished";
}
