import type { Terminal } from "@doriface/protocol";
import { describe, expect, test } from "bun:test";
import { availableActions, type Shell } from "./shell-actions.ts";
import { desktopActions, phoneActions } from "./use-app-actions.ts";
import type { Tabs } from "./use-tabs.ts";

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
const tabs: Tabs = {
  open: ["t1", "t2"],
  restored: true,
  active: "t1",
  split: null,
  select: () => undefined,
  close: () => undefined,
  drop: () => undefined,
  toggleSplit: () => undefined,
  focus: () => undefined,
  move: () => undefined,
  lastMove: null,
};
const noop = (): void => undefined;
const handlers = {
  desktop: desktopActions(
    {
      terminals: [terminal("t1"), terminal("t2")],
      tabs,
      onNew: noop,
      onToggleSidebar: noop,
      onFocusSidebar: noop,
      onSession: () => true,
      onDictate: () => true,
    },
    noop,
  ),
  phone: phoneActions(
    noop,
    noop,
    () => true,
    () => true,
  ),
} satisfies Record<Shell, (action: string) => boolean>;

describe("every palette row runs something", () => {
  test.each(["desktop", "phone"] as const)("%s: its handler takes every action its palette lists", (shell) => {
    const unhandled = availableActions(shell, tabs, true)
      .map((action) => action.id)
      .filter((id) => !handlers[shell](id));
    expect(unhandled).toEqual([]);
  });
});

const sessionRows = (shell: Shell, inView: boolean) =>
  availableActions(shell, tabs, inView).filter(({ id }) => id.startsWith("session."));

const moves = (active: string) =>
  availableActions("desktop", { ...tabs, active }, true)
    .map(({ id }) => id)
    .filter((id) => id.startsWith("tab.move:"));

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
          tabs: { ...tabs, open: ["t1", "t2", "t3"], active: "t1", move: (address, to) => calls.push([address, to]) },
          onNew: noop,
          onToggleSidebar: noop,
          onFocusSidebar: noop,
          onSession: () => true,
          onDictate: () => true,
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

describe("dictation (#194)", () => {
  test.each(["desktop", "phone"] as const)(
    "%s: Dictate is a palette row with a session in view, and left out without",
    (shell) => {
      const dictate = (inView: boolean) =>
        availableActions(shell, tabs, inView).filter(({ id }) => id === "voice.dictate");
      expect(dictate(true)).toEqual([{ id: "voice.dictate" }]);
      expect(dictate(false)).toEqual([]);
    },
  );

  test("the row and a bound key run the shell's dictation, and leave the key alone when it has none", () => {
    const runs: string[] = [];
    const desktop = (onDictate: () => boolean) =>
      desktopActions(
        {
          terminals: [],
          tabs,
          onNew: noop,
          onToggleSidebar: noop,
          onFocusSidebar: noop,
          onSession: () => true,
          onDictate,
        },
        noop,
      );
    expect(desktop(() => (runs.push("desktop"), true))("voice.dictate")).toBe(true);
    expect(desktop(() => false)("voice.dictate")).toBe(false);
    expect(
      phoneActions(
        noop,
        noop,
        () => true,
        () => (runs.push("phone"), true),
      )("voice.dictate"),
    ).toBe(true);
    expect(
      phoneActions(
        noop,
        noop,
        () => true,
        () => false,
      )("voice.dictate"),
    ).toBe(false);
    expect(runs).toEqual(["desktop", "phone"]);
  });
});
