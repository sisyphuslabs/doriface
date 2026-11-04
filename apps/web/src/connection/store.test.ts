import { afterEach, expect, jest, test } from "bun:test";
import type { HcConnection } from "@doriface/client";
import { type ConnectionSettings, DEFAULT_SETTINGS } from "./settings.ts";

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
