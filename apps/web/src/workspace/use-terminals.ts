import type { HcConnection } from "@doriface/client";
import type { ListResult, Terminal } from "@doriface/protocol";
import { useEffect, useRef, useState } from "react";
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

/** A core document changed: which machine's (null for this core's), its name and its new version. */
export type DocHeard = (machine: string | null, name: string, version: number) => void;

/**
 * terminal.list for the first picture and machine count, then events.subscribe keeps it live. The same feed carries
 * `doc` events, handed to `onDoc`.
 */
export function useTerminals(connection: HcConnection | null, onDoc?: DocHeard): TerminalsState {
  const [state, setState] = useState<TerminalsState>(EMPTY);
  const docHeard = useRef(onDoc);
  docHeard.current = onDoc;

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
        if (event.type === "doc") docHeard.current?.(event.machine ?? null, event.data.name, event.data.version);
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
