import type { MachineView, Terminal } from "@doriface/protocol";
import { expect, test } from "bun:test";
import { groupAgents } from "./model.ts";
import { withReach } from "./reach.ts";

const terminal = (address: string, state = "live"): Terminal => ({
  address,
  argv: ["sh"],
  cols: 80,
  rows: 24,
  created_ms: 0,
  cwd: "/work/api",
  labels: {},
  screen: "exact",
  state,
  status: { state: "working" },
});

const machine = (name: string, state: string): MachineView => ({
  name,
  state,
  id: `id-${name}`,
  host: name,
  target: name,
  version: "0.1.17",
});

test("only the live terminals of a machine that is not connected leave Working for Offline", () => {
  const terminals = [terminal("t1"), terminal("build/t1"), terminal("build/t2", "finished"), terminal("rack/t1")];
  const reached = withReach(terminals, [machine("build", "unreachable"), machine("rack", "connected")]);
  expect(reached.map((entry) => entry.state)).toEqual(["live", "unreachable", "finished", "live"]);
  const groups = groupAgents(reached, 0);
  expect(groups.working.map((agent) => agent.id)).toEqual(["t1", "rack/t1"]);
  expect(groups.offline.map((agent) => [agent.id, agent.status])).toEqual([["build/t1", "unknown"]]);
});
