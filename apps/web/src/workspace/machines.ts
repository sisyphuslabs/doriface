import type { MachineView, Terminal } from "@doriface/protocol";
import { machineOf } from "./model.ts";

export interface MachineEntry {
  /** Unique even when an added machine is named like this one. */
  readonly id: string;
  readonly name: string;
  /** The machine this client is connected to; its terminals have bare addresses. */
  readonly local: boolean;
  readonly state: string;
  readonly live: number;
  /** Its first live terminal, opened when the machine is picked. */
  readonly first: string | undefined;
}

const LABELS: Readonly<Record<string, string>> = { needs_login: "needs login" };

export const stateLabel = (state: string): string => LABELS[state] ?? state;

const LOCAL_ID = "local";
const remoteId = (name: string): string => `machine:${name}`;

/** The section shows when hc has added machines, or when listing them failed so the person can see why. */
export const showMachines = (entries: readonly MachineEntry[], listError: string | undefined): boolean =>
  entries.length > 1 || listError !== undefined;

/** The id of the machine an address is on: this one for a bare `t7`, the named machine for `machine/t7`. */
export function activeMachineId(address: string): string {
  const machine = machineOf(address);
  return machine === undefined ? LOCAL_ID : remoteId(machine);
}

function entry(name: string, local: boolean, state: string, terminals: readonly Terminal[]): MachineEntry {
  const own = terminals.filter((t) => t.state === "live" && machineOf(t.address) === (local ? undefined : name));
  return { id: local ? LOCAL_ID : remoteId(name), name, local, state, live: own.length, first: own[0]?.address };
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

/**
 * Which added machines have live terminals: it changes when a machine's terminals appear, finish or go, which is
 * also what hc does to them when that machine's line drops, so it is one of the moments to read machine.list again.
 */
export function machineKey(terminals: readonly Terminal[]): string {
  const live = terminals.filter((terminal) => terminal.state === "live");
  const names = new Set(live.flatMap((terminal) => machineOf(terminal.address) ?? []));
  return [...names].toSorted().join(" ");
}
