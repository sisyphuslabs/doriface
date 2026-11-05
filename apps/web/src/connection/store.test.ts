import { afterEach, expect, jest, test } from "bun:test";
import type { HcConnection } from "@doriface/client";
import { type ConnectionSettings, DEFAULT_RELAY_URL, DEFAULT_SETTINGS } from "./settings.ts";

// store.ts builds the app's store from localStorage as it loads; bun has none, so an empty one stands in for that load only.
Object.assign(globalThis, { localStorage: { getItem: () => null, setItem: () => undefined } });
const { ConnectionStore } = await import("./store.ts");
Reflect.deleteProperty(globalThis, "localStorage");

const SETTINGS: ConnectionSettings = { ...DEFAULT_SETTINGS, mode: "loopback", token: "t0k" };

afterEach(() => jest.useRealTimers());

test("retryNow makes the waiting attempt at once, and its back-off timer makes no second one", async () => {
  jest.useFakeTimers();
  const live: Pick<HcConnection, "onClose" | "close"> = { onClose: () => () => undefined, close: () => undefined };
  const connection = live as HcConnection;
  let attempts = 0;
  const store = new ConnectionStore(SETTINGS, () => {
    attempts += 1;
    return attempts === 1 ? Promise.reject(new Error("refused")) : Promise.resolve(connection);
  });
  const reached = (phase: string): Promise<void> =>
    new Promise((resolve) => {
      const off = store.subscribe(() => {
        if (store.state.phase !== phase) return;
        off();
        resolve();
      });
    });

  const failed = reached("failed");
  store.start();
  await failed;
  expect(store.state).toMatchObject({ phase: "failed", retryInMs: 1_000 });

  const open = reached("open");
  store.retryNow();
  await open;
  expect(attempts).toBe(2);

  jest.advanceTimersByTime(10_000);
  expect(attempts).toBe(2);
  expect(store.state).toEqual({ phase: "open", connection });
  store.stop();
});

test("a local host that did not start holds its cause and cancels the waiting retry, so no link is tried", async () => {
  jest.useFakeTimers();
  let attempts = 0;
  const store = new ConnectionStore(SETTINGS, () => {
    attempts += 1;
    return Promise.reject(new Error("refused"));
  });
  const failed = new Promise<void>((resolve) => {
    const off = store.subscribe(() => {
      if (store.state.phase !== "failed") return;
      off();
      resolve();
    });
  });
  store.start();
  await failed;
  const failure = { code: "hc-binary-missing", message: "not found", details: "raw output" };
  store.hostStartFailed(failure);
  expect(store.state).toEqual({ phase: "host-failed", failure });
  jest.advanceTimersByTime(10_000);
  store.retryNow();
  expect(attempts).toBe(1);
  expect(store.state).toEqual({ phase: "host-failed", failure });
});

test("in a release build the store connects through the production relay whatever relay the new settings name", async () => {
  const tried: string[] = [];
  const store = new ConnectionStore(DEFAULT_SETTINGS, (settings) => {
    tried.push(settings.relayUrl);
    return Promise.reject(new Error("refused"));
  });
  const written: string[] = [];
  Object.assign(globalThis, { localStorage: { setItem: (_key: string, value: string) => written.push(value) } });
  // A pairing link or an old saved link can name another relay; a release build reaches only the production one.
  store.update({ ...DEFAULT_SETTINGS, relayUrl: "wss://relay.custom.invalid", hostId: "h", hostKey: "k" });
  store.stop();
  Reflect.deleteProperty(globalThis, "localStorage");
  expect(tried).toEqual([DEFAULT_RELAY_URL]);
  expect(written.map((value) => JSON.parse(value).relayUrl)).toEqual([DEFAULT_RELAY_URL]);
  expect(store.settings.relayUrl).toBe(DEFAULT_RELAY_URL);
});
