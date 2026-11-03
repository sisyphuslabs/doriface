import type { MachineView, Terminal } from "@doriface/protocol";
import { machineOf, UNREACHABLE } from "./model.ts";

/**
 * Marks the live terminals of every added machine that is not connected as unreachable. hc sends no event when a
 * machine's line drops: its terminals stay live in the feed while machine.list already says unreachable, so the
 * machine's state decides. Terminals of machines missing from the list (not read yet) stay as they are.
 */
export function withReach(terminals: readonly Terminal[], machines: readonly MachineView[]): readonly Terminal[] {
  const away = new Set(machines.filter((machine) => machine.state !== "connected").map((machine) => machine.name));
  if (away.size === 0) return terminals;
  return terminals.map((terminal) => {
    const machine = machineOf(terminal.address);
    const cut = terminal.state === "live" && machine !== undefined && away.has(machine);
    return cut ? { ...terminal, state: UNREACHABLE } : terminal;
  });
}
