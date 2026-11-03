import type { HcConnection } from "@doriface/client";
import type { Terminal } from "@doriface/protocol";
import { useEffect, useState } from "react";
import { applyEvent, fromSnapshot, type TerminalMap } from "./terminals.ts";

export interface TerminalsState {
  readonly terminals: readonly Terminal[];
  readonly machines: number;
  readonly error: string | null;
}

/** Hosts may answer terminal.list without machines; the answer is network data, so it is read defensively. */
export function machineCount(list: object): number {
  const machines: unknown = Reflect.get(list, "machines");
  return Array.isArray(machines) ? machines.length : 0;
}

const EMPTY: TerminalsState = { terminals: [], machines: 0, error: null };

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
      if (!disposed) setState({ terminals: [...map.values()], machines, error: null });
    };
    const fail = (cause: unknown): void => {
      if (!disposed) setState((prev) => ({ ...prev, error: String(cause) }));
    };
    connection.call("terminal.list").then((list) => {
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
