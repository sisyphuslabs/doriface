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
  active: "t1",
  split: null,
  select: () => undefined,
  close: () => undefined,
  toggleSplit: () => undefined,
  focus: () => undefined,
};
const noop = (): void => undefined;
const handlers = {
  desktop: desktopActions(
    { terminals: [terminal("t1"), terminal("t2")], tabs, onNew: noop, onToggleSidebar: noop, onFocusSidebar: noop },
    noop,
  ),
  phone: phoneActions(noop, noop),
} satisfies Record<Shell, (action: string) => boolean>;

describe("every palette row runs something", () => {
  test.each(["desktop", "phone"] as const)("%s: its handler takes every action its palette lists", (shell) => {
    const unhandled = availableActions(shell, tabs)
      .map((action) => action.id)
      .filter((id) => !handlers[shell](id));
    expect(unhandled).toEqual([]);
  });
});
