import { afterEach, describe, expect, test } from "bun:test";
import {
  browserStorage,
  guardedLocalStorage,
  guardedSessionStorage,
  guardedStorage,
  type StorageLike,
} from "./guarded.ts";

const refused = (): never => {
  throw new DOMException("The operation is insecure.", "SecurityError");
};
const refusing: StorageLike = { getItem: refused, setItem: refused, removeItem: refused };

describe("guardedStorage", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "localStorage");
    Reflect.deleteProperty(globalThis, "sessionStorage");
  });

  test("a browser whose storage getter itself throws (Chromium with storage blocked) never throws through the guard (#553)", () => {
    for (const name of ["localStorage", "sessionStorage"]) {
      Object.defineProperty(globalThis, name, {
        configurable: true,
        get: () => {
          throw new DOMException("The operation is insecure.", "SecurityError");
        },
      });
    }
    expect(guardedLocalStorage().getItem("k")).toBeNull();
    expect(guardedSessionStorage().getItem("k")).toBeNull();
    expect(() => guardedLocalStorage().setItem("k", "v")).not.toThrow();
    expect(() => browserStorage("localStorage").setItem("k", "v")).toThrow("The operation is insecure.");
  });

  test("storage that refuses every access reads as empty and ignores writes", () => {
    const storage = guardedStorage(refusing);
    expect(() => storage.setItem("k", "v")).not.toThrow();
    expect(storage.getItem("k")).toBeNull();
    expect(() => storage.removeItem("k")).not.toThrow();
  });

  test("working storage is used as it is", () => {
    const map = new Map<string, string>();
    const storage = guardedStorage({
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => map.set(key, value),
      removeItem: (key) => map.delete(key),
    });
    storage.setItem("k", "v");
    expect(storage.getItem("k")).toBe("v");
    storage.removeItem("k");
    expect(storage.getItem("k")).toBeNull();
  });

  test("with no browser storage at all, as under bun's test runner, the guarded stores are empty", () => {
    expect(Reflect.get(globalThis, "sessionStorage")).toBeUndefined();
    expect(Reflect.get(globalThis, "localStorage")).toBeUndefined();
    expect(guardedSessionStorage().getItem("k")).toBeNull();
    expect(guardedLocalStorage().getItem("k")).toBeNull();
    expect(() => guardedLocalStorage().setItem("k", "v")).not.toThrow();
  });

  test("browserStorage keeps the refusal for a caller that reports it (saveView)", () => {
    expect(() => browserStorage("localStorage").setItem("k", "v")).toThrow("localStorage is not available");
  });
});
