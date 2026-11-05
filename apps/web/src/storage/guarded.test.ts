import { describe, expect, test } from "bun:test";
import { guardedSessionStorage, guardedStorage, type StorageLike } from "./guarded.ts";

const refused = (): never => {
  throw new DOMException("The operation is insecure.", "SecurityError");
};
const refusing: StorageLike = { getItem: refused, setItem: refused, removeItem: refused };

describe("guardedStorage", () => {
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

  test("with no sessionStorage at all, as under bun's test runner, the empty store", () => {
    expect(Reflect.get(globalThis, "sessionStorage")).toBeUndefined();
    expect(guardedSessionStorage().getItem("k")).toBeNull();
  });
});
