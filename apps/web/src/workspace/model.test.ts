import type { Terminal } from "@doriface/protocol";
import { describe, expect, test } from "bun:test";
import { agentStatus, groupAgents } from "./model.ts";

const terminal = (fields: Partial<Terminal>): Terminal => ({
  address: "t1",
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

describe("agentStatus", () => {
  test.each([
    ["never reported", {}, "idle"],
    ["reported, now silent", { reported: true, status: null }, "idle"],
    ["working", { reported: true, status: { state: "working" } }, "working"],
    ["blocked", { reported: true, status: { state: "blocked" } }, "blocked"],
    ["error reads as needing you", { reported: true, status: { state: "error" } }, "blocked"],
    ["done", { reported: true, status: { state: "done" } }, "done"],
    ["a word outside the protocol", { reported: true, status: { state: "thinking" } }, "idle"],
    ["an Object.prototype name", { reported: true, status: { state: "constructor" } }, "idle"],
    ["finished", { state: "finished" }, "done"],
  ] as const)("%s -> %s", (_name, fields, expected) => {
    expect(agentStatus(terminal(fields))).toBe(expected);
  });

  test("the sidebar section and the selector agree for every terminal", () => {
    const terminals = [
      terminal({ address: "t1" }),
      terminal({ address: "t2", status: { state: "working" } }),
      terminal({ address: "t3", status: { state: "blocked" } }),
    ];
    const groups = groupAgents(terminals, 0);
    for (const entry of terminals) {
      const status = agentStatus(entry);
      const section = status === "unknown" ? [] : groups[status];
      expect(section.map((agent) => agent.id)).toContain(entry.address);
    }
  });
});
