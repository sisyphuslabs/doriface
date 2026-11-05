import type { JsonObject, Terminal } from "@doriface/protocol";
import { docSpaces, panesOf, tabsOf } from "@doriface/protocol/layout";
import { describe, expect, test } from "bun:test";
import {
  adoptLoose,
  afterClosing,
  buildTabs,
  HOME_SPACE,
  keepMounts,
  keepTransient,
  layoutIds,
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
  const loose: LayoutTab | null = tab === null ? null : { ...tab, key: looseKey("t1", layoutIds([here])) };
  expect(keepTransient(loose, "build-box/t1", true)).toBeNull();
});

test("an added machine's loose tab keeps its key when the machine is renamed, so it stays the tab in view (#459)", () => {
  const box = (name: string): MachineLayout => ({
    ...here,
    machine: name,
    machineId: "id-box",
    readOnly: "the layout is loading",
  });
  const [before] = buildTabs([here, box("build-box")], [], ["build-box/t1"]);
  const [after] = buildTabs([here, box("build-renamed")], [], ["build-renamed/t1"]);
  expect(after?.key).toBe(before?.key ?? "");
  expect(after?.panes.map((pane) => pane.address)).toEqual(["build-renamed/t1"]);
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
  spaceKey: "space:",
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

const loose = (address: string, cwd: string, fields: Partial<Terminal> = {}): Terminal =>
  ({
    address,
    argv: ["sh"],
    cols: 80,
    rows: 24,
    created_ms: 0,
    cwd,
    labels: {},
    screen: "exact",
    state: "live",
    ...fields,
  }) as Terminal;
const ids = (): ((prefix: "tb" | "p" | "spc") => string) => {
  let n = 0;
  return (prefix) => `${prefix}${(n += 1)}`;
};
const saved: JsonObject = {
  spaces: [
    {
      id: "spc-w",
      name: "",
      folder: "/w",
      tabs: [
        {
          id: "tb-x",
          name: "",
          root: { children: [{ content: { terminal: "t1" }, id: "p-x", type: "block" }], id: "tb-x", type: "row" },
        },
      ],
    },
    { id: "spc-api", name: "", folder: "/w/api", tabs: [] },
  ],
};
const where = (doc: JsonObject | null) =>
  doc === null ? null : tabsOf(doc).map((tab) => [tab.space, panesOf(tab.root).map((pane) => pane.terminal)]);

describe("adoptLoose (#404)", () => {
  test("a terminal no tab shows goes to the deepest space whose folder holds it, else to one Home space", () => {
    const adopted = adoptLoose(
      saved,
      [loose("t1", "/w"), loose("t2", "/w/api/src"), loose("t3", "/w/web"), loose("t4", "/tmp"), loose("t5", "/srv")],
      ids(),
    );
    expect(where(adopted)).toEqual([
      ["spc-w", ["t1"]],
      ["spc-w", ["t3"]],
      ["spc-api", ["t2"]],
      ["spc7", ["t4"]],
      ["spc7", ["t5"]],
    ]);
    expect(adopted === null ? null : docSpaces(adopted).at(-1)?.name).toBe(HOME_SPACE);
  });

  test("nothing to adopt writes nothing: shown, finished and started-by-another terminals stay as they are", () => {
    expect(
      adoptLoose(saved, [
        loose("t1", "/w"),
        loose("t6", "/w", { state: "finished" }),
        loose("t7", "/w", { parent: "t1" }),
      ]),
    ).toBeNull();
  });

  test("a terminal labelled with a space goes to the space of that name, made when there is none (#395)", () => {
    const adopted = adoptLoose(
      saved,
      [
        loose("t2", "/w/api", { labels: { space: "api-x" } }),
        loose("t3", "/tmp", { labels: { space: "api-x" } }),
        loose("t4", "/tmp"),
      ],
      ids(),
    );
    expect(adopted === null ? null : docSpaces(adopted).map((space) => [space.name, space.tabs.length])).toEqual([
      ["", 1],
      ["", 0],
      ["api-x", 2],
      [HOME_SPACE, 1],
    ]);
  });

  test("adopting again adopts nothing more, and an existing Home is reused", () => {
    const once = adoptLoose(null, [loose("t1", "/a")], ids());
    expect(once === null ? null : adoptLoose(once, [loose("t1", "/a")])).toBeNull();
    const twice = once === null ? null : adoptLoose(once, [loose("t1", "/a"), loose("t2", "/b")], ids());
    expect(twice === null ? null : docSpaces(twice).map((space) => [space.name, space.tabs.length])).toEqual([
      [HOME_SPACE, 2],
    ]);
  });
});
