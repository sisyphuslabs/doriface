import type { MachineView, Terminal } from "@doriface/protocol";
import { machineOf } from "./model.ts";

export interface MachineEntry {
  readonly name: string;
  /** The machine this client is connected to; its terminals have bare addresses. */
  readonly local: boolean;
  readonly state: string;
  readonly live: number;
  /** Its first live terminal, opened when the machine is picked. */
  readonly first: string | undefined;
}

const LABELS: Readonly<Record<string, string>> = { needs_login: "needs login", needs_update: "needs update" };

export const stateLabel = (state: string): string => LABELS[state] ?? state;

function entry(name: string, local: boolean, state: string, terminals: readonly Terminal[]): MachineEntry {
  const own = terminals.filter((t) => t.state === "live" && machineOf(t.address) === (local ? undefined : name));
  return { name, local, state, live: own.length, first: own[0]?.address };
}

export function machineEntries(
  localName: string,
  machines: readonly MachineView[],
  terminals: readonly Terminal[],
): MachineEntry[] {
  return [
    entry(localName, true, "connected", terminals),
    ...machines.map((machine) => entry(machine.name, false, machine.state, terminals)),
  ];
}

/** Changes only when a machine's terminals appear or all go: the moment to read machine.list again. */
export function machineKey(terminals: readonly Terminal[]): string {
  const names = new Set(terminals.flatMap((terminal) => machineOf(terminal.address) ?? []));
  return [...names].toSorted().join(" ");
}
