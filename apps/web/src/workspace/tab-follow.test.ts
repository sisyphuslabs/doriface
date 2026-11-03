import type { MachineView, Terminal } from "@doriface/protocol";
import { expect, test } from "bun:test";
import { followTerminals, type KeyedTabs, NO_TABS } from "./tab-follow.ts";
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
