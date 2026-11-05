import { arrangeIds, type DocEdit, DocWriteError, moveInOrder } from "@doriface/protocol/layout";
import type { MachineEntry } from "./machines.ts";

/**
 * The list as the person ordered it (`arrangeIds`): machines are matched by their permanent core id, so a renamed
 * machine keeps its place, and the ones the stored order does not name follow in the default order.
 */
export function arrangeMachines(entries: readonly MachineEntry[], stored: readonly string[] | null): MachineEntry[] {
  const byId = new Map(entries.map((entry) => [entry.core, entry]));
  return arrangeIds(
    entries.map((entry) => entry.core),
    stored,
  ).flatMap((id) => byId.get(id) ?? []);
}

/** The edit that moves one machine (by core id) to index `to` of the list as it stands when it is written. */
export const moveMachine = (entries: readonly MachineEntry[], core: string, to: number): DocEdit =>
  moveInOrder(
    entries.map((entry) => entry.core),
    core,
    to,
  );

/**
 * The notice for a move the machine order did not take, in the machine order's own words (never the layout's, whose
 * document error it is): what happened, then why. The toast's Retry is the next step (DESIGN.md 5(f)).
 */
export function orderNotSaved(cause: unknown): { readonly title: string; readonly description: string } {
  const title = "The machine order was not saved";
  if (cause instanceof DocWriteError) {
    return cause.kind === "conflict"
      ? { title, description: "Another device kept changing the machine order. Retry to move the machine again." }
      : { title, description: `The machine order cannot be changed now: ${cause.detail}.` };
  }
  return {
    title,
    description: `The machine order could not be written: ${cause instanceof Error ? cause.message : String(cause)}.`,
  };
}
