import { describe, expect, test } from "bun:test";
import type { KeyValueStore } from "../storage/idb.ts";
import { single } from "./config.ts";
import { TerminalConfigStore, takeLegacyFontSize } from "./config-store.ts";

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

  test("an old appearance font size moves into font-size once", async () => {
    const gated = gatedStore(undefined);
    const store = new TerminalConfigStore(gated.storage, () => 18);
    gated.release();
    await store.loaded;
    expect(single(store.config, "font-size")).toBe("13.5");
    expect(gated.puts).toEqual([[["font-size", ["13.5"]]]]);
  });

  test("the legacy reader strips fontSize and ignores the old default", () => {
    const items = new Map<string, string>([["doriface.appearance", JSON.stringify({ theme: "day", fontSize: 14 })]]);
    const storage = {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
    };
    expect(takeLegacyFontSize(storage)).toBeNull();
    expect(JSON.parse(items.get("doriface.appearance") ?? "{}")).toEqual({ theme: "day" });
  });
});
