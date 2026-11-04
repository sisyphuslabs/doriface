import { HcConnection } from "@doriface/client";
import { END_LABEL, eventAddress, type HcEvent, HcRpcError, type Terminal } from "@doriface/protocol";
import { type HcTarget, spawnHcLink } from "./mesh/hc-machines.ts";

export interface EndSweeper {
  /** Watches the core unless already watching; called as a client connects, so a restarted core is watched again. */
  ensure(): void;
  stop(): Promise<void>;
}

/**
 * Removes every finished terminal that carries END_LABEL: an End that marked and killed a terminal finishes on the core
 * even when the page that asked closed before its own terminal.rm went out. Watches over one connection of its own,
 * opened by `ensure` and again by the next `ensure` once that connection has closed.
 */
export function endSweeper(core: HcTarget, log: (line: string) => void): EndSweeper {
  let watching: Promise<HcConnection | undefined> | undefined;
  let stopped = false;
  const watch = async (): Promise<HcConnection> => {
    const connection = await HcConnection.open(spawnHcLink(core));
    const finished = new Set<string>();
    const marked = new Set<string>();
    const sweep = (address: string): void => {
      if (!finished.has(address) || !marked.has(address)) return;
      finished.delete(address);
      connection.call("terminal.rm", { terminal: address }).catch((error: unknown) => {
        // not_found: the page's own End or another client got there first.
        if (!(error instanceof HcRpcError && error.kind === "not_found"))
          log(`end: removing ${address}: ${String(error)}`);
      });
    };
    const learn = (terminal: Terminal): void => {
      if (terminal.state === "finished") finished.add(terminal.address);
      if (Object.hasOwn(terminal.labels ?? {}, END_LABEL)) marked.add(terminal.address);
      sweep(terminal.address);
    };
    const apply = (event: HcEvent): void => {
      const address = eventAddress(event);
      if (address === undefined) return;
      switch (event.type) {
        case "created":
        case "restarted":
          finished.delete(address);
          break;
        case "removed":
          finished.delete(address);
          marked.delete(address);
          break;
        case "finished":
          finished.add(address);
          sweep(address);
          break;
        case "labels":
          if (Object.hasOwn(event.data.labels, END_LABEL)) marked.add(address);
          else marked.delete(address);
          sweep(address);
          break;
        default:
          break;
      }
    };
    // Events first, then every terminal finished ones included: a terminal that finishes in between is in one or both.
    const feed = await connection.subscribe();
    feed.onEvent(apply);
    const listAll = async (): Promise<void> => {
      for (const terminal of (await connection.call("terminal.list", { all: true })).terminals) learn(terminal);
    };
    feed.onSnapshot(() => void listAll().catch((error: unknown) => log(`end: listing terminals: ${String(error)}`)));
    await listAll();
    return connection;
  };
  return {
    ensure: () => {
      if (stopped || watching !== undefined) return;
      const started = watch().then(
        (connection) => {
          connection.onClose(() => {
            if (watching === started) watching = undefined;
          });
          return connection;
        },
        (error: unknown) => {
          log(`end: not watching the core: ${String(error)}`);
          if (watching === started) watching = undefined;
          return undefined;
        },
      );
      watching = started;
    },
    stop: async () => {
      stopped = true;
      (await watching)?.close();
    },
  };
}
