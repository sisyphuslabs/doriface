import type { HcConnection } from "@doriface/client";
import type { MachineView, Terminal } from "@doriface/protocol";
import { createContext, useContext, useEffect, useState } from "react";
import { machineEntries, machineKey, type MachineEntry } from "./machines.ts";

export interface Machines {
  readonly entries: readonly MachineEntry[];
  /** Starts a shell on that machine (`terminal.run` with `on`) and opens it at its `machine/tN` address. */
  readonly newTerminalOn: (machine: string) => void;
}

export const MachinesContext = createContext<Machines>({ entries: [], newTerminalOn: () => {} });

export const useMachinesContext = (): Machines => useContext(MachinesContext);

/** machine.list, read again whenever a machine's terminals appear or all go (a line came up or dropped). */
export function useMachines(connection: HcConnection, terminals: readonly Terminal[]): readonly MachineEntry[] {
  const [views, setViews] = useState<readonly MachineView[]>([]);
  const key = machineKey(terminals);
  useEffect(() => {
    let current = true;
    connection.call("machine.list").then(
      (list) => {
        if (current) setViews(list.machines);
        return list;
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [connection, key]);
  return machineEntries(connection.hello.core.name, views, terminals);
}
