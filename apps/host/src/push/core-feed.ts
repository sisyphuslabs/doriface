import { HcConnection } from "@doriface/client";
import { HcRpcError } from "@doriface/protocol";
import { type HcTarget, spawnHcLink } from "../mesh/hc-machines.ts";
import type { PushCore, PushService } from "./push-service.ts";

const RETRY_MS = 5_000;

export interface CoreFeed {
  /** Settles once the first snapshot is the baseline (or the first attempt failed and a retry is due). */
  readonly ready: Promise<void>;
  stop(): void;
}

/** The push service's own line to this host's core: its events feed the notices, its calls answer prompts. */
export function startCoreFeed(target: HcTarget, service: PushService, log: (line: string) => void): CoreFeed {
  const first = Promise.withResolvers<void>();
  let stopped = false;
  let current: HcConnection | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const retry = (): void => {
    service.attach(undefined);
    current = undefined;
    if (!stopped) timer = setTimeout(() => void open(), RETRY_MS);
  };
  const open = async (): Promise<void> => {
    try {
      const connection = await HcConnection.open(spawnHcLink(target));
      if (stopped) return connection.close();
      current = connection;
      const feed = await connection.subscribe();
      service.baseline(feed.snapshot.terminals);
      first.resolve();
      feed.onSnapshot((snapshot) => service.baseline(snapshot.terminals));
      feed.onEvent((event) => void service.event(event));
      feed.onClose(() => {
        if (current !== connection) return;
        connection.close();
        retry();
      });
      service.attach(coreOf(connection));
    } catch (error) {
      log(`push: cannot follow this host's core: ${String(error)}`);
      first.resolve();
      retry();
    }
  };
  void open();
  return {
    ready: first.promise,
    stop() {
      stopped = true;
      clearTimeout(timer);
      service.attach(undefined);
      current?.close();
      first.resolve();
    },
  };
}

const where = (on: string | undefined) => (on === undefined ? {} : { on });

/** The approval calls over the host's own line, as #192's banner makes them over a client's: a doc conflict is an answer. */
const coreOf = (connection: HcConnection): PushCore => ({
  terminal: (terminal) => connection.call("terminal.get", { terminal }),
  screen: async (terminal) => (await connection.call("terminal.read", { terminal, lines: 0 })).text,
  keys: async (terminal, keys) => {
    await connection.call("terminal.keys", { terminal, keys });
  },
  doc: (name, on) => connection.call("doc.get", { name, ...where(on) }),
  setDoc: async (name, on, value, version) => {
    try {
      await connection.call("doc.set", { name, value, version, ...where(on) });
      return "ok";
    } catch (error) {
      if (error instanceof HcRpcError && error.kind === "conflict") return "conflict";
      throw error;
    }
  },
});
