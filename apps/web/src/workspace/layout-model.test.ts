import type { Terminal } from "@doriface/protocol";
import { expect, test } from "bun:test";
import { afterClosing, buildTabs, keepTransient, looseKey, type LayoutTab } from "./layout-model.ts";
import type { MachineLayout } from "./use-layout-docs.ts";

const here: MachineLayout = {
  machine: null,
  machineId: null,
  doc: null,
  loaded: true,
  readOnly: null,
  edit: () => Promise.resolve(true),
};

const live: Terminal = {
  address: "t1",
  argv: ["sh"],
  cols: 80,
  rows: 24,
  created_ms: 0,
  cwd: "/work",
  labels: {},
  screen: "exact",
  state: "live",
};

test("the first live terminal shown alone is kept when a new tab opens, on this machine or another", () => {
  const [alone] = buildTabs([here], [live]);
  expect(alone?.transient).toBe(true);
  const tab = alone ?? null;
  expect(keepTransient(tab, "t2", true)).toBe("with-new");
  // buildTabs stops showing it once any document holds a tab, so a tab on another machine would hide it.
  expect(keepTransient(tab, "build-box/t1", true)).toBe("apart");
  expect(keepTransient(tab, "t2", false)).toBe("apart");
  expect(keepTransient(tab, "t1", true)).toBeNull();
  const loose: LayoutTab | null = tab === null ? null : { ...tab, key: looseKey("t1") };
  expect(keepTransient(loose, "build-box/t1", true)).toBeNull();
});

test("a live terminal is shown alone only while the core has no layout; a layout whose tabs were all closed shows none (#354)", () => {
  expect(buildTabs([here], [live]).map((tab) => tab.transient)).toEqual([true]);
  expect(buildTabs([{ ...here, doc: { spaces: [] } }], [live])).toEqual([]);
});

test("closing the tab in view shows the last of the others, so the keyboard lands in a terminal that is left", () => {
  const [alone] = buildTabs([here], [live]);
  if (alone === undefined) throw new Error("no tab for the live terminal");
  const tabs = [
    { ...alone, key: "inherited" },
    { ...alone, key: "remaining" },
    { ...alone, key: "closed" },
  ];
  expect(afterClosing(tabs, "closed")).toBe("remaining");
  expect(afterClosing(tabs, "remaining")).toBe("closed");
  expect(afterClosing([alone], alone.key)).toBeNull();
});
