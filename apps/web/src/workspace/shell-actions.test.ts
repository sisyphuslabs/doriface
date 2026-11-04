import type { Terminal } from "@doriface/protocol";
import { describe, expect, test } from "bun:test";
import { availableActions, type Shell } from "./shell-actions.ts";
import { desktopActions, phoneActions } from "./use-app-actions.ts";
import type { LayoutTab } from "./layout-model.ts";
import type { Layout } from "./use-layout.ts";

const terminal = (address: string): Terminal => ({
  address,
  argv: ["sh"],
  cols: 80,
  rows: 24,
  created_ms: 0,
  cwd: "/work",
  labels: {},
  screen: "exact",
  state: "live",
});
const noop = (): void => undefined;
const pane = { id: "p1", address: "t1", mod: null };
const tab: LayoutTab = {
  key: "tb1",
  id: "tb1",
  space: "spc1",
  machine: null,
  name: "",
  root: { children: [{ content: { terminal: "t1" }, id: "p1", type: "block" }], id: "tb1", type: "row" },
  panes: [pane],
  readOnly: null,
  transient: false,
};
const layout: Layout = {
  tabs: [tab],
  active: tab,
  focused: pane,
  zoomed: null,
  selectTab: noop,
  focusPane: noop,
  openTerminal: noop,
  split: noop,
  dropPane: noop,
  closeTab: noop,
  go: () => false,
  bumped: null,
  fresh: null,
  resize: () => Promise.resolve(true),
  resizeFocused: () => false,
  equalize: () => true,
  toggleZoom: () => true,
  moveTab: noop,
  lastMove: null,
};
const handlers = {
  desktop: desktopActions(
    {
      terminals: [terminal("t1"), terminal("t2")],
      layout,
      onNew: noop,
      onSplit: noop,
      onCloseTab: noop,
      onClosePane: noop,
      onToggleSidebar: noop,
      onFocusSidebar: noop,
      onSession: () => true,
    },
    noop,
  ),
  phone: phoneActions(noop, noop, () => true),
} satisfies Record<Shell, (action: string) => boolean>;

describe("every palette row runs something", () => {
  test.each(["desktop", "phone"] as const)("%s: its handler takes every action its palette lists", (shell) => {
    const unhandled = availableActions(shell, true)
      .map((action) => action.id)
      .filter((id) => !handlers[shell](id));
    expect(unhandled).toEqual([]);
  });
});

const sessionRows = (shell: Shell, inView: boolean) =>
  availableActions(shell, inView).filter(({ id }) => id.startsWith("session."));

const moves = (active: string) =>
  availableActions("desktop", true, null, { keys: ["t1", "t2"], active })
    .map(({ id }) => id)
    .filter((id) => id.startsWith("tab.move:"));

const stripTab = (key: string): LayoutTab => ({
  key,
  id: key,
  space: "s",
  machine: null,
  name: "",
  root: { children: [], id: key, type: "row" },
  panes: [],
  readOnly: null,
  transient: false,
});

describe("moving a tab", () => {
  test("the palette offers only the moves the active tab can make", () => {
    expect(moves("t1")).toEqual(["tab.move:right"]);
    expect(moves("t2")).toEqual(["tab.move:left"]);
  });

  test("a key moves the focused tab, else the active one, one place, and leaves the key at an end", () => {
    const calls: [string, number][] = [];
    const handler = (focused: string | null) =>
      desktopActions(
        {
          terminals: [terminal("t1"), terminal("t2"), terminal("t3")],
          layout: {
            ...layout,
            tabs: ["t1", "t2", "t3"].map(stripTab),
            active: stripTab("t1"),
            moveTab: (key, to) => calls.push([key, to]),
          },
          onNew: noop,
          onSplit: noop,
          onCloseTab: noop,
          onClosePane: noop,
          onToggleSidebar: noop,
          onFocusSidebar: noop,
          onSession: () => true,
          focusedTab: () => focused,
        },
        noop,
      );
    expect(handler(null)("tab.move:right")).toBe(true);
    expect(handler("t2")("tab.move:left")).toBe(true);
    expect(handler(null)("tab.move:left")).toBe(false);
    expect(handler("t3")("tab.move:right")).toBe(false);
    expect(calls).toEqual([
      ["t1", 1],
      ["t2", 0],
    ]);
  });
});

describe("session actions", () => {
  test.each(["desktop", "phone"] as const)(
    "%s: rename and end are listed, ready to run, with a session in view",
    (shell) => {
      expect(sessionRows(shell, true)).toEqual([{ id: "session.rename" }, { id: "session.end" }]);
    },
  );

  test.each(["desktop", "phone"] as const)("%s: with no session in view they are left out, not disabled", (shell) => {
    expect(sessionRows(shell, false)).toEqual([]);
  });
});
