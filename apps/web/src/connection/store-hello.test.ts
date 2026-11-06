import { expect, test } from "bun:test";
import type { HcConnection } from "@doriface/client";
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

/**
 * A transport that opened a session and never said what the host calls itself. `HcConnection` always carries the hello
 * it answered with, so this is not a shape the relay produces; the store must still not fail a working session over a
 * name it cannot read, which is the shape it met on dev (#615, #618).
 */
function connectionWithoutHello(): HcConnection {
  const quiet = { onClose: () => () => undefined, close: () => undefined };
  return quiet as unknown as HcConnection;
}

/** The first state that is settled either way: awaited on the store's own event, never on a clock. */
function settled(store: InstanceType<typeof ConnectionStore>): Promise<ConnectionState> {
  return new Promise((resolve) => {
    const read = (): void => {
      const state = store.state;
      if (state.phase !== "open" && state.phase !== "failed") return;
      off();
      resolve(state);
    };
    const off = store.subscribe(read);
    read();
  });
}

test("a connection that answered no hello still opens, and no name is invented for the host", async () => {
  let asked = 0;
  const store = new ConnectionStore(RELAY, (): Promise<OpenConnection> => {
    asked += 1;
    return Promise.resolve({ connection: connectionWithoutHello(), path: "relay" });
  });

  const waiting = settled(store);
  store.start();
  const state = await waiting;
  store.stop();

  expect(state.phase).toBe("open");
  expect(asked).toBe(1);
  expect(store.settings.hostName).toBe("");
});
