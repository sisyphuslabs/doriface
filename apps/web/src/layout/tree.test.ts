import { describe, expect, test } from "bun:test";
import { type Node } from "./node.ts";
import { panesOf, removePane } from "./tree.ts";

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

  test("returns null for a pane that is not in the tree", () => {
    expect(removePane(box("row", "root", [block("a")]), "nope")).toBeNull();
  });
});
