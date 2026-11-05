import type { Terminal } from "@doriface/protocol";
import { machineId, spaceId, spaceName } from "./model.ts";
import { isGone, type SessionCalls } from "./session-actions.ts";

/**
 * The label that puts a terminal in a space (spaceName reads it first). hc has no space of its own, so a space's name
 * is this label on each of its terminals: a rename writes it on all of them, and every client of the host, the relayed
 * ones included, reads it back from hc's terminal list.
 */
export const SPACE_LABEL = "space";

const membersOf = (terminals: readonly Terminal[], id: string): Terminal[] =>
  terminals.filter((terminal) => terminal.state === "live" && spaceId(terminal) === id);

/** Why `name` cannot become space `id`'s name, or null when it can; its own name is fine (nothing changes). */
export function spaceNameProblem(terminals: readonly Terminal[], id: string, name: string): string | null {
  const wanted = name.trim();
  if (wanted === "") return "A space needs a name.";
  const machine = membersOf(terminals, id)[0];
  if (machine === undefined) return "This space has no running terminal left to rename.";
  const taken = terminals.some(
    (terminal) =>
      terminal.state === "live" &&
      machineId(terminal.address) === machineId(machine.address) &&
      spaceName(terminal) === wanted &&
      spaceId(terminal) !== id,
  );
  // The two would become one space for good: nothing tells their terminals apart afterwards.
  return taken ? `Another space on this machine is already called ${wanted}.` : null;
}

/**
 * Names space `id` `name` (trimmed) in hc: the space label on every live terminal of it. A terminal removed meanwhile is
 * no failure; any other refusal is thrown once every call has settled. Returns the space's id under its new name.
 */
export async function renameSpace(
  calls: Pick<SessionCalls, "label">,
  terminals: readonly Terminal[],
  id: string,
  name: string,
): Promise<string> {
  const wanted = name.trim();
  const members = membersOf(terminals, id);
  const outcomes = await Promise.allSettled(
    members.map((terminal) => calls.label({ terminal: terminal.address, labels: { [SPACE_LABEL]: wanted } })),
  );
  const failed = outcomes.find((outcome) => outcome.status === "rejected" && !isGone(outcome.reason));
  if (failed?.status === "rejected") throw failed.reason;
  const first = members[0];
  return first === undefined ? id : `${machineId(first.address)}/${wanted}`;
}
