import type { HcConnection } from "@doriface/client";
import type { MachineView, Terminal } from "@doriface/protocol";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { machineEntries, machineKey, type MachineEntry } from "./machines.ts";
import type { RunFailure } from "./start-on.ts";

export interface Machines {
  readonly entries: readonly MachineEntry[];
  /** Starts a shell on that machine (`terminal.run` with `on`) and opens it at its `machine/tN` address. */
  readonly newTerminalOn: (machine: string) => void;
  /** The last New terminal that a machine refused, shown in the machine list until dismissed. */
  readonly failure: RunFailure | undefined;
  readonly dismissFailure: () => void;
  /** Why the last machine.list failed, until one succeeds. */
  readonly listError: string | undefined;
}

export const MachinesContext = createContext<Machines>({
  entries: [],
  newTerminalOn: () => {},
  failure: undefined,
  dismissFailure: () => {},
  listError: undefined,
});

export const useMachinesContext = (): Machines => useContext(MachinesContext);

/**
 * hc sends no event when a machine's line comes up, drops or wants a login, so machine.list is also read on a timer
 * while the page is visible. hc redials within 250 ms to 30 s and one machine.list is a few hundred bytes, so every
 * 10 s keeps a stale state shorter than it takes to notice and click, for at most 6 small calls a minute.
 */
export const MACHINE_REFRESH_MS = 10_000;

export interface MachineState {
  readonly entries: readonly MachineEntry[];
  /** Reads machine.list again now, e.g. after a call on a machine failed. */
  readonly refresh: () => void;
  readonly listError: string | undefined;
}

/** machine.list, read again when a machine's live terminals change, on a timer while visible, and on return. */
export function useMachines(connection: HcConnection, terminals: readonly Terminal[]): MachineState {
  const [views, setViews] = useState<readonly MachineView[]>([]);
  const [reads, setReads] = useState(0);
  const [listError, setListError] = useState<string | undefined>(undefined);
  const refresh = useCallback(() => setReads((count) => count + 1), []);
  const key = machineKey(terminals);
  useEffect(() => {
    let current = true;
    connection.call("machine.list").then(
      (list) => {
        if (!current) return list;
        setViews(list.machines);
        setListError(undefined);
        return list;
      },
      (error: unknown) => {
        if (current) setListError(error instanceof Error ? error.message : String(error));
      },
    );
    return () => {
      current = false;
    };
  }, [connection, key, reads]);
  useEffect(() => {
    const whenVisible = (): void => {
      if (document.visibilityState === "visible") refresh();
    };
    const timer = setInterval(whenVisible, MACHINE_REFRESH_MS);
    document.addEventListener("visibilitychange", whenVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", whenVisible);
    };
  }, [refresh]);
  const localName = connection.hello.core.name;
  const entries = useMemo(() => machineEntries(localName, views, terminals), [localName, views, terminals]);
  return { entries, refresh, listError };
}
