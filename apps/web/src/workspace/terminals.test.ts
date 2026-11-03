import type { HcEvent, Terminal } from "@doriface/protocol";
import { describe, expect, test } from "bun:test";
import { agentStatus } from "./model.ts";
import { applyEvent, fromSnapshot } from "./terminals.ts";

const terminal = (address: string): Terminal => ({
  address,
  argv: ["sh"],
  cols: 80,
  rows: 24,
  created_ms: 0,
  cwd: "/work/doriface",
  labels: {},
  screen: "exact",
  state: "live",
});

describe("terminal events", () => {
  const start = fromSnapshot({ seq: 1, terminals: [terminal("t1")] });

  test("a status report makes the terminal an agent with that state", () => {
    const event: HcEvent = {
      type: "status",
      seq: 2,
      terminal: "t1",
      data: { status: { state: "blocked" }, records: {}, reported: true },
    };
    const next = applyEvent(start, event).get("t1");
    expect(next === undefined ? "missing" : agentStatus(next)).toBe("blocked");
  });

  test("remote events are keyed machine/address and removal drops the terminal", () => {
    const created: HcEvent = { type: "created", seq: 2, terminal: "t1", machine: "box", data: terminal("t1") };
    const withRemote = applyEvent(start, created);
    expect([...withRemote.keys()]).toEqual(["t1", "box/t1"]);
    const removed: HcEvent = { type: "removed", seq: 3, terminal: "t1", data: {} };
    expect([...applyEvent(withRemote, removed).keys()]).toEqual(["box/t1"]);
  });

  test("events for unknown terminals leave the map untouched", () => {
    const title: HcEvent = { type: "title", seq: 2, terminal: "t9", data: { title: "x" } };
    expect(applyEvent(start, title)).toBe(start);
  });
});
