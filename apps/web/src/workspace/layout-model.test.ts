import type { Terminal } from "@doriface/protocol";
import { describe, expect, test } from "bun:test";
import {
  afterClosing,
  buildTabs,
  keepMounts,
  keepTransient,
  looseKey,
  newMounts,
  TRANSIENT,
  type LayoutTab,
} from "./layout-model.ts";
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

const alone = (address: string): LayoutTab => ({
  key: TRANSIENT,
  id: TRANSIENT,
  space: "",
  machine: null,
  name: "",
  root: { children: [], id: "", type: "row" },
  panes: [{ id: TRANSIENT, address, mod: null }],
  readOnly: null,
  transient: false,
});
const shownAlone = (address: string): LayoutTab => ({ ...alone(address), transient: true });
const docTab = (key: string, pane: string, address: string): LayoutTab => ({
  ...alone(address),
  key,
  id: key,
  panes: [{ id: pane, address, mod: null }],
});

describe("keepMounts: a document tab that takes over a terminal shown alone keeps its view (#381)", () => {
  test("the tab written for it is mounted where the lone tab was, its pane too, and stays so", () => {
    const mounts = newMounts();
    keepMounts([shownAlone("box/t2")], mounts);
    const [taken] = keepMounts([docTab("core/tb1", "p1", "box/t2")], mounts);
    expect(taken?.mount).toBe(TRANSIENT);
    expect(taken?.panes[0]?.mount).toBe(TRANSIENT);
    expect(taken?.key).toBe("core/tb1");
    expect(taken?.panes[0]?.id).toBe("p1");
    const [again] = keepMounts([docTab("core/tb1", "p1", "box/t2"), docTab("core/tb2", "p2", "box/t3")], mounts);
    expect(again?.mount).toBe(TRANSIENT);
  });

  test("a tab for a terminal never shown alone mounts under its own key", () => {
    const mounts = newMounts();
    const [tab] = keepMounts([docTab("core/tb1", "p1", "box/t2")], mounts);
    expect(tab?.mount).toBeUndefined();
  });

  test("a tab that first showed without the take-over does not take it later, so its view never moves", () => {
    const mounts = newMounts();
    keepMounts([docTab("core/tb1", "p1", "box/t2")], mounts);
    keepMounts([shownAlone("box/t2")], mounts);
    const [tab] = keepMounts([docTab("core/tb1", "p1", "box/t2")], mounts);
    expect(tab?.mount).toBeUndefined();
  });

  test("two document tabs never share the lone tab's mount", () => {
    const mounts = newMounts();
    keepMounts([shownAlone("box/t2")], mounts);
    keepMounts([docTab("core/tb1", "p1", "box/t2")], mounts);
    keepMounts([shownAlone("box/t9")], mounts);
    const tabs = keepMounts([docTab("core/tb1", "p1", "box/t2"), docTab("core/tb9", "p9", "box/t9")], mounts);
    expect(tabs.map((tab) => tab.mount ?? tab.key)).toEqual([TRANSIENT, "core/tb9"]);
  });
});
