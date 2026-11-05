import { describe, expect, test } from "bun:test";
import { loadView, NO_VIEW, saveView, type View } from "./view.ts";

/** A storage holding one raw value for core "c", as a page would have left it. */
const holding = (raw: string | null): Pick<Storage, "getItem"> => ({
  getItem: (key) => (key === "doriface.view.c" ? raw : null),
});
const loaded = (value: unknown): View => loadView("c", holding(JSON.stringify(value)));

describe("loadView", () => {
  test("reads the active tab, the focused and zoomed panes, and each space's tab as saved", () => {
    const view: View = {
      active: "t2",
      focused: { t1: "p1", t2: "p4" },
      zoomed: { t2: "p4" },
      spaces: { "space:s1": "t2", "space:m/s2": "m/t1" },
    };
    const saved = new Map<string, string>();
    expect(saveView("c", view, { setItem: (key, value) => saved.set(key, value) })).toBeNull();
    expect(loadView("c", { getItem: (key) => saved.get(key) ?? null })).toEqual(view);
  });

  test("an older screen's strip order is not read: the tabs' order is the documents' own (#404)", () => {
    expect(loaded({ active: "a", focused: { a: "p1" }, order: ["b", "a"] })).toEqual({
      active: "a",
      focused: { a: "p1" },
      zoomed: {},
      spaces: {},
    });
  });

  test("fields of the wrong kind read as unset, one by one", () => {
    expect(loaded({ active: 4, focused: { a: 1, b: "p2" }, zoomed: ["p1"], spaces: { s: "a", t: 2 } })).toEqual({
      active: null,
      focused: { b: "p2" },
      zoomed: {},
      spaces: { s: "a" },
    });
  });

  test("nothing saved, unreadable JSON or a value that is not an object reads as no view", () => {
    expect(loadView("c", holding(null))).toEqual(NO_VIEW);
    expect(loadView("c", holding("{not json"))).toEqual(NO_VIEW);
    expect(loaded(["a"])).toEqual(NO_VIEW);
    expect(loaded("a")).toEqual(NO_VIEW);
  });
});

describe("saveView", () => {
  test("a storage that refuses the write (full or denied) says why, and saving does not throw", () => {
    const full: Pick<Storage, "setItem"> = {
      setItem: () => {
        throw new DOMException("the quota has been exceeded", "QuotaExceededError");
      },
    };
    expect(saveView("c", { ...NO_VIEW, active: "a" }, full)).toBe("the quota has been exceeded");
  });
});
