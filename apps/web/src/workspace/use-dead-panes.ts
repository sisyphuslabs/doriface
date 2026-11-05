import type { HcConnection } from "@doriface/client";
import { HcRpcError, type MachineView, type Terminal } from "@doriface/protocol";
import { useEffect, useRef } from "react";
import type { LayoutTab } from "./layout-model.ts";
import { machineOf } from "./model.ts";

/** The terminals this core's document panes show that its feed does not list, each once; panels have none. */
export function absentPanes(tabs: readonly LayoutTab[], listed: ReadonlySet<string>): string[] {
  const addresses = tabs.flatMap((tab) =>
    tab.transient || tab.machine !== null
      ? []
      : tab.panes.flatMap((pane) => (pane.address === null ? [] : [pane.address])),
  );
  return [...new Set(addresses.filter((address) => !listed.has(address)))];
}

/**
 * The terminals an added machine's document panes show that the feed does not list, each with that machine's permanent
 * id, for machines machine.list says are connected. While the feed still names a machine machine.list no longer does (a
 * rename read on one side only), nothing is returned: the two disagree, and a live terminal would read as gone.
 */
export function absentRemotePanes(
  tabs: readonly LayoutTab[],
  listed: ReadonlySet<string>,
  machines: readonly MachineView[],
): ReadonlyMap<string, string> {
  const known = new Set(machines.map((machine) => machine.name));
  for (const address of listed) {
    const machine = machineOf(address);
    if (machine !== undefined && !known.has(machine)) return new Map();
  }
  const connected = new Map(
    machines.filter((machine) => machine.state === "connected").map((machine) => [machine.name, machine.id]),
  );
  const absent = new Map<string, string>();
  for (const tab of tabs) {
    const id = tab.machine === null ? undefined : connected.get(tab.machine);
    if (tab.transient || id === undefined) continue;
    for (const pane of tab.panes) if (pane.address !== null && !listed.has(pane.address)) absent.set(pane.address, id);
  }
  return absent;
}

/** When an added machine's pane was first seen absent: at which machine.list read, and on which machine (by id). */
export interface Missing {
  readonly read: number;
  readonly machine: string;
}

/**
 * One step of the added machines' wait, as dev's tabs waited before the split stack: a pane absent now is noted with
 * the machine.list read it was first seen at, and is asked about only once a later read still finds it absent on the
 * same connected machine. A pane listed again, or whose machine drops, is renamed or turns into another, starts over.
 */
export function stepMissing(
  missing: ReadonlyMap<string, Missing>,
  absent: ReadonlyMap<string, string>,
  read: number,
): { readonly missing: ReadonlyMap<string, Missing>; readonly ask: readonly string[] } {
  const next = new Map<string, Missing>();
  const ask: string[] = [];
  for (const [address, machine] of absent) {
    const seen = missing.get(address);
    if (seen === undefined || seen.machine !== machine) next.set(address, { read, machine });
    else {
      next.set(address, seen);
      if (read > seen.read) ask.push(address);
    }
  }
  return { missing: next, ask };
}

/**
 * A terminal removed while no page was open leaves its pane in the shared layout, and no view ever attaches to say
 * that it ended. Once the feed is loaded, each pane whose terminal the feed does not list is asked about once, and only
 * the core's not_found drops it, as a finished view would; any other answer (a terminal the feed lists a moment later,
 * a machine that is offline) keeps it. A terminal the feed lists again is asked about again if it goes later.
 *
 * An added machine's terminals can read as unknown while it reconnects or right after a rename, so its panes are asked
 * about only after `stepMissing`'s wait: absent across two machine.list reads, with the machine connected at both and
 * the feed agreeing with machine.list on its name (`absentRemotePanes`). `reads` counts machine.list answers.
 */
export function useDeadPanes(
  connection: HcConnection,
  tabs: readonly LayoutTab[],
  terminals: readonly Terminal[] | null,
  machines: readonly MachineView[],
  reads: number,
  drop: (address: string) => void,
): void {
  const asked = useRef(new Set<string>());
  const missing = useRef<ReadonlyMap<string, Missing>>(new Map());
  useEffect(() => {
    asked.current = new Set();
    missing.current = new Map();
  }, [connection]);
  useEffect(() => {
    if (terminals === null) return;
    const listed = new Set(terminals.map((terminal) => terminal.address));
    for (const address of asked.current) if (listed.has(address)) asked.current.delete(address);
    const step = stepMissing(missing.current, absentRemotePanes(tabs, listed, machines), reads);
    missing.current = step.missing;
    for (const address of [...absentPanes(tabs, listed), ...step.ask]) {
      if (asked.current.has(address)) continue;
      asked.current.add(address);
      void connection.call("terminal.get", { terminal: address }).then(
        () => undefined,
        (cause: unknown) => {
          if (cause instanceof HcRpcError && cause.kind === "not_found" && !connection.closed) drop(address);
        },
      );
    }
  }, [connection, tabs, terminals, machines, reads, drop]);
}
