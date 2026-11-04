import type { HcConnection } from "@doriface/client";
import type { ListResult, Terminal } from "@doriface/protocol";
import { useEffect, useState } from "react";
import { applyEvent, fromSnapshot, type TerminalMap } from "./terminals.ts";

export interface TerminalsState {
  readonly terminals: readonly Terminal[];
  /** False until the core's first answer: an empty list before it means unknown, not none. */
  readonly loaded: boolean;
  readonly machines: number;
  readonly error: string | null;
}

/** hc 0.1.17 leaves machines out of terminal.list answers when it has none, so absent counts as none. */
export function machineCount(list: Pick<ListResult, "machines">): number {
  return list.machines?.length ?? 0;
}

const EMPTY: TerminalsState = { terminals: [], loaded: false, machines: 0, error: null };

/** terminal.list for the first picture and machine count, then events.subscribe keeps it live. */
export function useTerminals(connection: HcConnection | null): TerminalsState {
  const [state, setState] = useState<TerminalsState>(EMPTY);

  useEffect(() => {
    if (connection === null) {
      setState(EMPTY);
      return undefined;
    }
    let map: TerminalMap = new Map();
    let machines = 0;
    let disposed = false;
    const publish = (): void => {
      if (!disposed) setState({ terminals: [...map.values()], loaded: true, machines, error: null });
    };
    const fail = (cause: unknown): void => {
      if (!disposed) setState((prev) => ({ ...prev, error: String(cause) }));
    };
    // Finished terminals too, as the feed's snapshot lists them: an ended terminal that dropped out of the first picture
    // and came back with the snapshot would remount its view, which then no longer knows the page had it open (#164).
    connection.call("terminal.list", { all: true }).then((list) => {
      machines = machineCount(list);
      if (map.size === 0) map = new Map(list.terminals.map((terminal) => [terminal.address, terminal]));
      publish();
      return list;
    }, fail);
    const feed = connection.subscribe();
    feed.then((subscribed) => {
      if (disposed) {
        subscribed.close();
        return subscribed;
      }
      map = fromSnapshot(subscribed.snapshot);
      publish();
      subscribed.onSnapshot((snapshot) => {
        map = fromSnapshot(snapshot);
        publish();
      });
      subscribed.onEvent((event) => {
        const next = applyEvent(map, event);
        if (next === map) return;
        map = next;
        publish();
      });
      return subscribed;
    }, fail);
    return () => {
      disposed = true;
      void feed.then(
        (subscribed) => subscribed.close(),
        () => undefined,
      );
    };
  }, [connection]);

  return state;
}
