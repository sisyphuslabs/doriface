import { afterEach, describe, expect, test } from "bun:test";
import { deviceStore } from "./idb.ts";

/** An IDBRequest stand-in that settles on the next microtask. */
function settle<T>(
  outcome: { readonly result: T } | { readonly error: Error },
): EventTarget & { result?: T; error?: Error } {
  const req: EventTarget & { result?: T; error?: Error } = Object.assign(new EventTarget(), {});
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

const values = new Map<string, unknown>([["k", "stored"]]);
const database = {
  transaction: () => ({ objectStore: () => ({ get: (key: string) => settle({ result: values.get(key) }) }) }),
};

const realIndexedDB = Reflect.get(globalThis, "indexedDB");
afterEach(() => Reflect.set(globalThis, "indexedDB", realIndexedDB));

describe("deviceStore", () => {
  test("a failed open is retried on the next call", async () => {
    let opens = 0;
    Reflect.set(globalThis, "indexedDB", {
      open: () => {
        opens += 1;
        return opens === 1 ? settle({ error: new Error("blocked") }) : settle({ result: database });
      },
    });
    await expect(deviceStore.get("k")).rejects.toThrow("blocked");
    expect(await deviceStore.get("k")).toBe("stored");
    expect(opens).toBe(2);
  });
});
