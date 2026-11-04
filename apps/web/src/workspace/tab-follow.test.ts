import type { MachineView, Terminal } from "@doriface/protocol";
import { expect, test } from "bun:test";
import { followTerminals, type KeyedTabs, NO_TABS, selectTab, selectTerminal } from "./tab-follow.ts";
import { machineIds, tabAddress, tabKey } from "./tab-keys.ts";

const terminal = (address: string): Terminal => ({
  address,
  argv: ["sh"],
  cols: 80,
  rows: 24,
  created_ms: 0,
  cwd: "/w",
  labels: {},
  screen: "exact",
  state: "live",
});
const machine = (name: string): MachineView => ({
  name,
  id: "m1",
  host: "h",
  target: "t",
  version: "0.1.17",
  state: "connected",
});

const before = machineIds([machine("build")]);
const after = machineIds([machine("build-2")]);
const opened = (ids = before): KeyedTabs => {
  const open = [tabKey("t1", ids), tabKey("build/t4", ids)];
  return { ...NO_TABS, open, active: open[1] ?? null };
};

test("a rename keeps the tab: it waits through the gap, then resolves to the new name by machine id", () => {
  const gap = followTerminals(opened(), [terminal("t1")], before, 1);
  expect(gap.open).toHaveLength(2);
  const renamed = followTerminals(gap, [terminal("t1"), terminal("build-2/t4")], after, 2);
  expect(renamed.open.map((key) => tabAddress(key, after))).toEqual(["t1", "build-2/t4"]);
  expect(renamed.active === null ? null : tabAddress(renamed.active, after)).toBe("build-2/t4");
});

test("a removed remote terminal drops its tab once machine.list has been read again; a local one at once", () => {
  const gone = followTerminals(opened(), [], before, 1);
  expect(gone.open.map((key) => tabAddress(key, before))).toEqual(["build/t4"]);
  const reread = followTerminals(gone, [terminal("t9")], before, 2);
  expect(reread.open.map((key) => tabAddress(key, before))).toEqual(["t9"]);
});

test("a tab that comes back in the same read another one leaves in still lets the other one drop", () => {
  const two = machineIds([
    { ...machine("x"), id: "mx" },
    { ...machine("y"), id: "my" },
  ]);
  const [a, b] = [tabKey("x/t1", two), tabKey("y/t1", two)];
  let tabs: KeyedTabs = { ...NO_TABS, open: [a, b], active: b };
  tabs = followTerminals(tabs, [terminal("y/t1")], two, 1);
  tabs = followTerminals(tabs, [terminal("x/t1")], two, 1);
  for (const listed of [2, 3]) tabs = followTerminals(tabs, [terminal("x/t1")], two, listed);
  expect(tabs.open.map((key) => tabAddress(key, two))).toEqual(["x/t1"]);
  expect(tabs.active === null ? null : tabAddress(tabs.active, two)).toBe("x/t1");
});

test("a New tab the feed does not list yet waits for it through a machine.list read, then opens focused", () => {
  const ids = machineIds([]);
  const [kept, started] = [tabKey("t1", ids), tabKey("t2", ids)];
  let tabs: KeyedTabs = followTerminals({ ...NO_TABS, open: [kept], active: kept }, [terminal("t1")], ids, 1);
  tabs = selectTab(tabs, started, false);
  tabs = followTerminals(tabs, [terminal("t1")], ids, 2);
  expect([tabs.open, tabs.active]).toEqual([[kept], kept]);
  tabs = followTerminals(tabs, [terminal("t1"), terminal("t2")], ids, 2);
  expect([tabs.open, tabs.active]).toEqual([[kept, started], started]);
});

test("a selected terminal the feed already lists opens at once, and a later selection replaces a waiting one", () => {
  const ids = machineIds([]);
  const [two, three] = [tabKey("t2", ids), tabKey("t3", ids)];
  let tabs = selectTab(selectTab(NO_TABS, three, false), two, true);
  expect([tabs.open, tabs.active]).toEqual([[two], two]);
  tabs = followTerminals(tabs, [terminal("t2"), terminal("t3")], ids, 1);
  expect([tabs.open, tabs.active]).toEqual([[two], two]);
});

test("New tab's answer opens its terminal at once when the feed already lists it, and waits when it does not", () => {
  const ids = machineIds([]);
  const [kept, started] = [tabKey("t1", ids), tabKey("t2", ids)];
  const shown: KeyedTabs = { ...NO_TABS, open: [kept], active: kept };
  const feedFirst = selectTerminal(shown, "t2", ids, [terminal("t1"), terminal("t2")]);
  expect([feedFirst.open, feedFirst.active, feedFirst.pending]).toEqual([[kept, started], started, null]);
  for (const listed of [[terminal("t1")], null]) {
    const answerFirst = selectTerminal(shown, "t2", ids, listed);
    expect([answerFirst.open, answerFirst.active, answerFirst.pending]).toEqual([[kept], kept, started]);
  }
});
