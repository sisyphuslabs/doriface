import type { MachineView, Terminal } from "@doriface/protocol";
import { describe, expect, test } from "bun:test";
import { machineEntries, machineKey, stateLabel } from "./machines.ts";
import { toSpaces } from "./model.ts";

const terminal = (address: string, fields: Partial<Terminal> = {}): Terminal => ({
  address,
  argv: ["sh"],
  cols: 80,
  rows: 24,
  created_ms: 0,
  cwd: "/work/doriface",
  labels: {},
  screen: "exact",
  state: "live",
  ...fields,
});

const view = (name: string, state: string): MachineView => ({
  name,
  state,
  host: name,
  id: `${name}-id`,
  target: "doriface-host connect x",
  version: "0.1.17",
  via: true,
});

describe("machineEntries", () => {
  test("this machine first, then each added machine with its state and live terminals", () => {
    const terminals = [
      terminal("t1"),
      terminal("boxb/t1"),
      terminal("boxb/t2"),
      terminal("boxb/t3", { state: "finished" }),
      terminal("t2"),
    ];
    expect(machineEntries("studio", [view("boxb", "connected"), view("lab", "unreachable")], terminals)).toEqual([
      { name: "studio", local: true, state: "connected", live: 2, first: "t1" },
      { name: "boxb", local: false, state: "connected", live: 2, first: "boxb/t1" },
      { name: "lab", local: false, state: "unreachable", live: 0, first: undefined },
    ]);
  });

  test("hc's states read as words", () => {
    expect(["connected", "connecting", "unreachable", "needs_login", "needs_update", "new"].map(stateLabel)).toEqual([
      "connected",
      "connecting",
      "unreachable",
      "needs login",
      "needs update",
      "new",
    ]);
  });

  test("the refresh key changes when an added machine's terminals stop being live, as they do when its line drops", () => {
    const live = [terminal("t1"), terminal("boxb/t1"), terminal("boxb/t2")];
    const dropped = [
      terminal("t1"),
      terminal("boxb/t1", { state: "finished" }),
      terminal("boxb/t2", { state: "finished" }),
    ];
    expect(machineKey(dropped)).not.toBe(machineKey(live));
    expect(machineKey([...live, terminal("t9", { state: "finished" })])).toBe(machineKey(live));
  });
});

describe("toSpaces grouped by machine", () => {
  test("this machine's spaces come first, then each machine's, in name order", () => {
    const spaces = toSpaces([
      terminal("zeta/t1", { cwd: "/w/api" }),
      terminal("t1", { cwd: "/w/web" }),
      terminal("boxb/t1", { cwd: "/w/infra" }),
      terminal("t2", { cwd: "/w/api" }),
    ]);
    expect(spaces.map((space) => [space.machine ?? "", space.name])).toEqual([
      ["", "web"],
      ["", "api"],
      ["boxb", "infra"],
      ["zeta", "api"],
    ]);
  });
});
