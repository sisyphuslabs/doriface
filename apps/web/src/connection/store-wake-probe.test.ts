import { afterEach, expect, jest, test } from "bun:test";
import { type HcConnection, HcTimeoutError } from "@doriface/client";
import type { OpenConnection } from "./connect.ts";
import { type ConnectionSettings, DEFAULT_RELAY_URL, DEFAULT_SETTINGS } from "./settings.ts";
import type { ConnectionState } from "./store.ts";

// store.ts builds the app's store from localStorage as it loads; bun has none, so an empty one stands in for that load.
Object.assign(globalThis, { localStorage: { getItem: () => null, setItem: () => undefined } });
const { ConnectionStore } = await import("./store.ts");
Reflect.deleteProperty(globalThis, "localStorage");

const RELAY: ConnectionSettings = {
  ...DEFAULT_SETTINGS,
  mode: "relay",
  relayUrl: DEFAULT_RELAY_URL,
  hostId: "h0st",
  hostKey: "k3y",
};

afterEach(() => jest.useRealTimers());

interface Core {
  readonly connection: HcConnection;
  readonly calls: string[];
  readonly closed: () => boolean;
}

/**
 * An open connection whose core either answers every call at once or has gone quiet. A quiet core's calls end as the real
 * client ends them: with HcTimeoutError once their deadline passes, never with an answer.
 */
function core(answers: boolean | "error"): Core {
  const calls: string[] = [];
  const listeners: ((error?: Error) => void)[] = [];
  let closed = false;
  const connection = {
    hello: { core: { id: "c0re", name: "" } },
    onClose: (listener: (error?: Error) => void) => (listeners.push(listener), () => undefined),
    close: (error?: Error) => {
      if (closed) return;
      closed = true;
      for (const listener of listeners) listener(error);
    },
    call: (method: string, _params: unknown, options: { readonly timeoutMs?: number } = {}) => {
      calls.push(method);
      if (answers === "error") return Promise.reject(new Error("the core refused the call"));
      if (answers) return Promise.resolve([]);
      return new Promise((_resolve, reject) => {
        if (options.timeoutMs !== undefined) {
          setTimeout(() => reject(new HcTimeoutError(method, options.timeoutMs ?? 0)), options.timeoutMs);
        }
      });
    },
  };
  return { connection: connection as unknown as HcConnection, calls, closed: () => closed };
}

function settled(store: { subscribe: (fn: () => void) => () => void; state: ConnectionState }, phase: string) {
  return new Promise<void>((resolve) => {
    const read = (): void => {
      if (store.state.phase !== phase) return;
      off();
      resolve();
    };
    const off = store.subscribe(read);
    read();
  });
}

/** Lets the store's promise chains run: the probe's call, its handler and the drop it reports. */
async function flush(turns = 5): Promise<void> {
  if (turns === 0) return;
  await Promise.resolve();
  await flush(turns - 1);
}

test("a wake with a live link asks the core once and leaves the link alone (#653)", async () => {
  jest.useFakeTimers();
  const live = core(true);
  let attempts = 0;
  const store = new ConnectionStore(RELAY, (): Promise<OpenConnection> => {
    attempts += 1;
    return Promise.resolve({ connection: live.connection, path: "relay" as const });
  });
  const open = settled(store, "open");
  store.start();
  await open;

  store.retryNow();
  await flush();
  jest.advanceTimersByTime(30_000);
  await flush();

  expect(live.calls).toEqual(["terminal.list"]);
  expect(live.closed()).toBe(false);
  expect(attempts).toBe(1);
  expect(store.state.phase).toBe("open");
  store.stop();
});

test("a wake with a link that no longer answers drops it within 10 s and dials again (#653)", async () => {
  jest.useFakeTimers();
  const quiet = core(false);
  const fresh = core(true);
  let attempts = 0;
  const store = new ConnectionStore(RELAY, (): Promise<OpenConnection> => {
    attempts += 1;
    return Promise.resolve({ connection: (attempts === 1 ? quiet : fresh).connection, path: "relay" as const });
  });
  const open = settled(store, "open");
  store.start();
  await open;

  store.retryNow();
  await flush();
  jest.advanceTimersByTime(9_999);
  await flush();
  expect(quiet.closed()).toBe(false);

  jest.advanceTimersByTime(1);
  await flush();
  expect(quiet.closed()).toBe(true);
  // The drop goes through the store's own reconnect: a link that was up past the stability floor dials again at once.
  jest.advanceTimersByTime(1_000);
  await flush();
  expect(attempts).toBe(2);
  store.stop();
});

test("a wake whose call the core refuses still leaves the link alone: a refusal is an answer (#653)", async () => {
  jest.useFakeTimers();
  const refusing = core("error");
  let attempts = 0;
  const store = new ConnectionStore(RELAY, (): Promise<OpenConnection> => {
    attempts += 1;
    return Promise.resolve({ connection: refusing.connection, path: "relay" as const });
  });
  const open = settled(store, "open");
  store.start();
  await open;

  store.retryNow();
  await flush();
  jest.advanceTimersByTime(30_000);
  await flush();

  expect(refusing.calls).toEqual(["terminal.list"]);
  expect(refusing.closed()).toBe(false);
  expect(attempts).toBe(1);
  store.stop();
});
