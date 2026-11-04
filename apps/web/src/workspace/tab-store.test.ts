import { describe, expect, spyOn, test } from "bun:test";
import { NO_TABS } from "./tab-follow.ts";
import { loadTabs, saveTabs, TABS_KEY } from "./tab-store.ts";

function memoryStorage(initial: string | null = null): Pick<Storage, "getItem" | "setItem"> {
  let value = initial;
  return {
    getItem: (key) => (key === TABS_KEY ? value : null),
    setItem: (_key, next) => {
      value = next;
    },
  };
}

describe("tab store", () => {
  test("a saved order, active tab and split come back for the same core, and another core's stay apart", () => {
    const storage = memoryStorage();
    saveTabs(
      "core-1",
      { ...NO_TABS, open: ["local:t3", "local:t1", "id:m1/t2"], active: "local:t1", split: "id:m1/t2" },
      storage,
    );
    saveTabs("core-2", { ...NO_TABS, open: ["local:t9"], active: "local:t9" }, storage);
    expect(loadTabs("core-1", storage)).toEqual({
      ...NO_TABS,
      open: ["local:t3", "local:t1", "id:m1/t2"],
      active: "local:t1",
      split: "id:m1/t2",
    });
    expect(loadTabs("core-2", storage).open).toEqual(["local:t9"]);
    expect(loadTabs("core-3", storage)).toEqual(NO_TABS);
  });

  test("anything unreadable reads as no tabs, and stray fields are repaired, never trusted", () => {
    for (const stored of [null, "{not json", "[]", '{"core":"x"}', '{"core":null}']) {
      expect(loadTabs("core", memoryStorage(stored))).toEqual(NO_TABS);
    }
    const odd = JSON.stringify({ core: { open: ["a", 7, "b", "a"], active: "gone", split: "a" } });
    expect(loadTabs("core", memoryStorage(odd))).toEqual({ ...NO_TABS, open: ["a", "b"], active: "a", split: null });
  });

  test("a storage that refuses the write (full or denied) is reported, and saving does not throw", () => {
    const refusing: Pick<Storage, "getItem" | "setItem"> = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      },
    };
    const report = spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(() => saveTabs("core", { ...NO_TABS, open: ["a"], active: "a" }, refusing)).not.toThrow();
      expect(report).toHaveBeenCalledTimes(1);
    } finally {
      report.mockRestore();
    }
  });
});
