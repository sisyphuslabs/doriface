import { afterAll, describe, expect, test } from "bun:test";
import { legacyFontSize, TerminalConfigStore } from "../ghostty/config-store.ts";
import { deviceStore } from "./idb.ts";

type Fake = EventTarget & { result?: unknown; error?: Error | null };

/** An IDBRequest stand-in that settles on the next microtask. */
function settle(outcome: { readonly result: unknown } | { readonly error: Error }): Fake {
  const req: Fake = new EventTarget();
  queueMicrotask(() => {
    if ("error" in outcome) {
      req.error = outcome.error;
      req.dispatchEvent(new Event("error"));
    } else {
      req.result = outcome.result;
      req.dispatchEvent(new Event("success"));
    }
  });
  return req;
}

/**
 * One database for the whole file, since the store caches its open: writes succeed as requests, and
 * `fake.commit` decides whether each transaction then completes or aborts.
 */
const fake: { values: Map<string, unknown>; commit: "complete" | "abort" } = { values: new Map(), commit: "complete" };
const db = {
  transaction: () => {
    const tx: Fake = new EventTarget();
    const store = {
      get: (key: string) => settle({ result: fake.values.get(key) }),
      put: (value: unknown, key: string) => {
        const req = settle({ result: key });
        req.addEventListener("success", () =>
          queueMicrotask(() => {
            if (fake.commit === "complete") fake.values.set(key, value);
            else tx.error = new Error("transaction aborted");
            tx.dispatchEvent(new Event(fake.commit));
          }),
        );
        return req;
      },
    };
    return Object.assign(tx, { objectStore: () => store });
  },
};

const realIndexedDB = Reflect.get(globalThis, "indexedDB");
Reflect.set(globalThis, "indexedDB", { open: () => settle({ result: db }) });
afterAll(() => Reflect.set(globalThis, "indexedDB", realIndexedDB));

describe("deviceStore", () => {
  test("a failed open is retried on the next call", async () => {
    let opens = 0;
    fake.values = new Map([["k", "stored"]]);
    fake.commit = "complete";
    Reflect.set(globalThis, "indexedDB", {
      open: () => {
        opens += 1;
        return opens === 1 ? settle({ error: new Error("blocked") }) : settle({ result: db });
      },
    });
    await expect(deviceStore.get("k")).rejects.toThrow("blocked");
    expect(await deviceStore.get("k")).toBe("stored");
    expect(opens).toBe(2);
  });

  test("a put rejects when its transaction aborts after the request succeeded", async () => {
    fake.commit = "abort";
    await expect(deviceStore.put("k", "v")).rejects.toThrow("transaction aborted");
  });

  test("an aborted migration write keeps the legacy font size", async () => {
    fake.values = new Map();
    fake.commit = "abort";
    const items = new Map([["doriface.appearance", JSON.stringify({ fontSize: 18 })]]);
    const local = {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
    };
    const store = new TerminalConfigStore(deviceStore, legacyFontSize(local));
    await store.loaded;
    expect(store.error?.message).toBe("transaction aborted");
    expect(JSON.parse(items.get("doriface.appearance") ?? "{}")).toEqual({ fontSize: 18 });
  });
});
