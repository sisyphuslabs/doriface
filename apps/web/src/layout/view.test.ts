import { describe, expect, test } from "bun:test";
import { loadView, NO_VIEW, saveView, type View } from "./view.ts";

/** A storage holding one raw value for core "c", as a page would have left it. */
const holding = (raw: string | null): Pick<Storage, "getItem"> => ({
  getItem: (key) => (key === "doriface.view.c" ? raw : null),
});
const loaded = (value: unknown): View => loadView("c", holding(JSON.stringify(value)));

describe("loadView", () => {
  test("reads the active tab, the focused and zoomed panes, and the order as saved", () => {
    const view: View = { active: "t2", focused: { t1: "p1", t2: "p4" }, zoomed: { t2: "p4" }, order: ["t2", "m/t1"] };
    const saved = new Map<string, string>();
    expect(saveView("c", view, { setItem: (key, value) => saved.set(key, value) })).toBeNull();
    expect(loadView("c", { getItem: (key) => saved.get(key) ?? null })).toEqual(view);
  });

  test("keeps each tab key of the order once, in its first place", () => {
    expect(loaded({ order: ["b", "a", "b", "c", "a"] }).order).toEqual(["b", "a", "c"]);
  });

  test("an order that is not a list of tab keys is no order, and the rest of the view still reads", () => {
    for (const order of [["a", 3], ["a", null], [["a"]], "a", { 0: "a" }, 7]) {
      expect(loaded({ active: "a", focused: { a: "p1" }, order })).toEqual({
        active: "a",
        focused: { a: "p1" },
        zoomed: {},
        order: [],
      });
    }
  });

  test("fields of the wrong kind read as unset, one by one", () => {
    expect(loaded({ active: 4, focused: { a: 1, b: "p2" }, zoomed: ["p1"], order: ["a"] })).toEqual({
      active: null,
      focused: { b: "p2" },
      zoomed: {},
      order: ["a"],
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
    expect(saveView("c", { ...NO_VIEW, order: ["a"] }, full)).toBe("the quota has been exceeded");
  });
});
