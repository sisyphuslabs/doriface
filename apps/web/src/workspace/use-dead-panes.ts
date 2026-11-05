import type { HcConnection } from "@doriface/client";
import { HcRpcError, type Terminal } from "@doriface/protocol";
import { useEffect, useRef } from "react";
import type { LayoutTab } from "./layout-model.ts";

/**
 * The terminals this core's document panes show that its feed does not list, each once; panels have none. An added
 * machine's panes are left out: its terminals can read as unknown while it reconnects or is renamed.
 */
export function absentPanes(tabs: readonly LayoutTab[], listed: ReadonlySet<string>): string[] {
  const addresses = tabs.flatMap((tab) =>
    tab.transient || tab.machine !== null
      ? []
      : tab.panes.flatMap((pane) => (pane.address === null ? [] : [pane.address])),
  );
  return [...new Set(addresses.filter((address) => !listed.has(address)))];
}

/**
 * A terminal removed while no page was open leaves its pane in the shared layout, and no view ever attaches to say
 * that it ended. Once the feed is loaded, each pane whose terminal the feed does not list is asked about once, and only
 * the core's not_found drops it, as a finished view would; any other answer (a terminal the feed lists a moment later,
 * a machine that is offline) keeps it. A terminal the feed lists again is asked about again if it goes later.
 */
export function useDeadPanes(
  connection: HcConnection,
  tabs: readonly LayoutTab[],
  terminals: readonly Terminal[] | null,
  drop: (address: string) => void,
): void {
  const asked = useRef(new Set<string>());
  useEffect(() => {
    asked.current = new Set();
  }, [connection]);
  useEffect(() => {
    if (terminals === null) return;
    const listed = new Set(terminals.map((terminal) => terminal.address));
    for (const address of asked.current) if (listed.has(address)) asked.current.delete(address);
    for (const address of absentPanes(tabs, listed)) {
      if (asked.current.has(address)) continue;
      asked.current.add(address);
      void connection.call("terminal.get", { terminal: address }).then(
        () => undefined,
        (cause: unknown) => {
          if (cause instanceof HcRpcError && cause.kind === "not_found" && !connection.closed) drop(address);
        },
      );
    }
  }, [connection, tabs, terminals, drop]);
}
