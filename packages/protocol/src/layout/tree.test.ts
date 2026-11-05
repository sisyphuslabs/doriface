import { describe, expect, test } from "bun:test";
import { type Node } from "./node.ts";
import { equalize, panesOf, removePane, resizeAt, splitPane } from "./tree.ts";

const block = (id: string, weight?: number): Node => ({
  content: { terminal: `t-${id}` },
  id,
  ...(weight === undefined ? {} : { size: { weight } }),
  type: "block",
});
const box = (type: "row" | "column", id: string, children: Node[], weight?: number): Node => ({
  children,
  id,
  ...(weight === undefined ? {} : { size: { weight } }),
  type,
});

describe("removing a pane", () => {
  test("gives its share to the pane it was split from and keeps every other node as it was", () => {
    const keep = box("column", "c", [block("x"), block("y")]);
    const root = box("row", "root", [block("a", 0.25), block("b", 0.25), keep]);
    const next = removePane(root, "b");
    expect(next).toEqual(box("row", "root", [block("a", 0.5), keep]));
    expect(next?.["children"]).toContain(keep);
  });

  test("a row left with one pane gives way to it, and that pane takes the row's slot", () => {
    const root = box("row", "root", [
      block("a", 0.5),
      box("column", "c", [block("x"), box("row", "r", [block("y"), block("z")])], 0.5),
    ]);
    const next = removePane(root, "z");
    expect(next).toEqual(box("row", "root", [block("a", 0.5), box("column", "c", [block("x"), block("y")], 0.5)]));
  });

  test("the first child's share goes to the next one, and the tab's root stays even with one pane", () => {
    const next = removePane(box("row", "root", [block("a", 0.5), block("b", 0.5)]), "a");
    expect(next).toEqual(box("row", "root", [block("b", 1)]));
    expect(panesOf(next ?? {}).map((pane) => pane.id)).toEqual(["b"]);
  });

  test("a container emptied by the close leaves its parent with every field it had, unknown ones included", () => {
    const parent = (children: Node[]): Node => ({ ...box("row", "root", children), gap: 2, "x-future": { added: 1 } });
    const root = parent([block("a"), block("b"), box("column", "c", [block("z")])]);
    expect(removePane(root, "z")).toEqual(parent([block("a"), block("b")]));
  });

  test("returns null for a pane that is not in the tree", () => {
    expect(removePane(box("row", "root", [block("a")]), "nope")).toBeNull();
  });
});

const stack = (active: string, ids: readonly string[]): Node => ({
  active,
  children: ids.map((id) => block(id)),
  id: "st",
  type: "stack",
});

describe("closing a stack's tab", () => {
  test("activates the tab that slides into its place, as herdr-app's remove_inner", () => {
    expect(removePane(stack("b", ["a", "b", "c"]), "b")?.["active"]).toBe("c");
  });

  test("activates the last tab when the closed one was last", () => {
    expect(removePane(stack("c", ["a", "b", "c"]), "c")?.["active"]).toBe("b");
  });

  test("keeps the active tab when another one closes", () => {
    expect(removePane(stack("a", ["a", "b", "c"]), "b")?.["active"]).toBe("a");
  });
});

describe("splitting along the parent's own axis", () => {
  test("keeps every field of the parent it rebuilds, herdr-app's and unknown ones", () => {
    const parent: Node = {
      ...box("row", "r", [block("a", 0.5), block("b", 0.5)], 0.5),
      gap: 2,
      "x-future-container": { added: "later" },
    };
    const root = box("column", "root", [block("top", 0.5), parent]);
    const next = splitPane(root, "a", "row", block("n"), "unused");
    expect(next).toEqual(
      box("column", "root", [
        block("top", 0.5),
        { ...parent, children: [block("a", 0.25), block("n", 0.25), block("b", 0.5)] },
      ]),
    );
  });
});

describe("resizing and equalizing", () => {
  const deep = box("column", "deep", [block("x"), block("y")]);
  const root = box("row", "root", [block("a", 0.5), box("column", "c", [block("b"), deep], 0.5)]);

  test("moving a deep line changes only its two neighbours, keeps their sum, and leaves the rest as it was", () => {
    const next = resizeAt(root, "deep", 0, 0.1);
    expect(next).toEqual(
      box("row", "root", [
        block("a", 0.5),
        box("column", "c", [block("b"), box("column", "deep", [block("x", 1.2), block("y", 0.8)])], 0.5),
      ]),
    );
    expect(Array.isArray(next?.["children"]) && next["children"][0]).toBe(
      Array.isArray(root["children"]) && root["children"][0],
    );
  });

  test("a line never squeezes a neighbour below its minimum share", () => {
    const next = resizeAt(root, "deep", 0, 5);
    expect(JSON.stringify(next)).toContain('"id":"y","size":{"weight":0.1}');
  });

  test("a line that does not exist, or that moves nothing, changes nothing", () => {
    expect(resizeAt(root, "deep", 1, 0.1)).toBeNull();
    expect(resizeAt(root, "a", 0, 0.1)).toBeNull();
    expect(resizeAt(root, "deep", 0, 0)).toBeNull();
  });

  test("equalize evens every row and column and leaves an even tree untouched", () => {
    const uneven = resizeAt(root, "deep", 0, 0.1) ?? root;
    const even = equalize(uneven);
    expect(even).toEqual(
      box("row", "root", [
        block("a", 1),
        box("column", "c", [block("b"), box("column", "deep", [block("x", 1), block("y", 1)])], 1),
      ]),
    );
    expect(equalize(even)).toBe(even);
  });
});
