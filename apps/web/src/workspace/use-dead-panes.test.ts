import { expect, test } from "bun:test";
import type { LayoutTab } from "./layout-model.ts";
import { absentPanes } from "./use-dead-panes.ts";

const tab = (
  key: string,
  addresses: readonly (string | null)[],
  transient = false,
  machine: string | null = null,
): LayoutTab => ({
  key,
  id: key,
  space: "s",
  machine,
  name: "",
  root: { children: [], id: key, type: "row" },
  panes: addresses.map((address, index) => ({
    id: `${key}-p${index}`,
    address,
    mod: address === null ? "files" : null,
  })),
  readOnly: null,
  transient,
});

test("only this core's document panes whose terminal the feed does not list are asked about, each once", () => {
  const tabs = [
    tab("a", ["t1", "t2"]),
    tab("b", ["t3", null]),
    tab("c", ["t2"]),
    tab("loose:t9", ["t9"], true),
    tab("box-a", ["box/t4"], false, "box"),
  ];
  expect(absentPanes(tabs, new Set(["t1", "t3"]))).toEqual(["t2"]);
  expect(absentPanes(tabs, new Set(["t1", "t2", "t3"]))).toEqual([]);
});
