import { describe, expect, test } from "bun:test";
import type { KeyValueStore } from "../storage/idb.ts";
import { single } from "./config.ts";
import { TerminalConfigStore, legacyFontSize } from "./config-store.ts";

/** A store whose first get resolves only when the test says so. */
function gatedStore(stored: unknown): {
  readonly storage: KeyValueStore;
  readonly release: () => void;
  readonly puts: unknown[];
} {
  const gate = Promise.withResolvers<void>();
  const puts: unknown[] = [];
  return {
    storage: { get: async () => (await gate.promise, stored), put: async (_key, value) => void puts.push(value) },
    release: () => gate.resolve(),
    puts,
  };
}

describe("TerminalConfigStore", () => {
  test("a change made before the stored config loads applies on top of it", async () => {
    const gated = gatedStore([["font-size", ["20"]]]);
    const store = new TerminalConfigStore(gated.storage);
    const early = store.update((current) => new Map([...current, ["cursor-style", ["bar"]]]));
    gated.release();
    await early;
    expect(single(store.config, "cursor-style")).toBe("bar");
    expect(single(store.config, "font-size")).toBe("20");
    expect(gated.puts.at(-1)).toEqual([
      ["font-size", ["20"]],
      ["cursor-style", ["bar"]],
    ]);
  });

  test("after a failed read, an update never overwrites what is stored", async () => {
    const puts: unknown[] = [];
    const store = new TerminalConfigStore({
      get: async () => {
        throw new Error("IndexedDB read failed");
      },
      put: async (_key, value) => void puts.push(value),
    });
    await store.update((current) => new Map([...current, ["cursor-style", ["bar"]]]));
    expect(puts).toEqual([]);
    expect(store.error?.message).toBe("IndexedDB read failed");
    expect(single(store.config, "cursor-style")).toBe("block");
  });

  test("a failed initial load lets no later update apply on an empty snapshot", async () => {
    const puts: unknown[] = [];
    const store = new TerminalConfigStore(
      { get: async () => undefined, put: async (_key, value) => void puts.push(value) },
      {
        read: () => {
          throw new Error("legacy settings unreadable");
        },
        clear: () => undefined,
      },
    );
    await store.update((current) => new Map([...current, ["cursor-style", ["bar"]]]));
    await store.update((current) => new Map([...current, ["font-size", ["20"]]]));
    expect(puts).toEqual([]);
    expect(store.error?.message).toBe("legacy settings unreadable");
  });

  test("the old font size stays in localStorage when the IndexedDB write fails", async () => {
    const items = new Map<string, string>([["doriface.appearance", JSON.stringify({ theme: "day", fontSize: 18 })]]);
    const local = {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
    };
    const store = new TerminalConfigStore(
      {
        get: async () => undefined,
        put: async () => {
          throw new Error("IndexedDB write failed");
        },
      },
      legacyFontSize(local),
    );
    await store.loaded;
    expect(store.error?.message).toBe("IndexedDB write failed");
    expect(JSON.parse(items.get("doriface.appearance") ?? "{}")).toEqual({ theme: "day", fontSize: 18 });
  });

  test("an old appearance font size moves into font-size once", async () => {
    const gated = gatedStore(undefined);
    const store = new TerminalConfigStore(gated.storage, { read: () => 18, clear: () => undefined });
    gated.release();
    await store.loaded;
    expect(single(store.config, "font-size")).toBe("13.5");
    expect(gated.puts).toEqual([[["font-size", ["13.5"]]]]);
  });

  test("the legacy source ignores the old default and clear strips fontSize", () => {
    const items = new Map<string, string>([["doriface.appearance", JSON.stringify({ theme: "day", fontSize: 14 })]]);
    const storage = {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
    };
    const legacy = legacyFontSize(storage);
    expect(legacy.read()).toBeNull();
    legacy.clear();
    expect(JSON.parse(items.get("doriface.appearance") ?? "{}")).toEqual({ theme: "day" });
  });
});
