import type { Terminal } from "@doriface/protocol";
import { describe, expect, test } from "bun:test";
import {
  agentCounts,
  agentStatus,
  firstInSpace,
  groupAgents,
  spaceId,
  tabPosition,
  terminalTitle,
  toSpaces,
} from "./model.ts";

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

describe("spaces", () => {
  test("one name on two machines is two spaces, each opening and matching its own machine's terminal", () => {
    const here = terminal({ address: "t1", cwd: "/home/me/api" });
    const there = terminal({ address: "box/t4", cwd: "/srv/api" });
    const spaces = toSpaces([here, there]);
    expect(spaces.map((space) => space.name)).toEqual(["api", "api"]);
    expect(new Set(spaces.map((space) => space.id)).size).toBe(2);
    for (const active of [here, there]) {
      const selected = spaces.filter((space) => space.id === spaceId(active));
      expect(selected).toHaveLength(1);
      expect(firstInSpace([here, there], selected[0]?.id ?? "")).toBe(active.address);
    }
  });
});

describe("tabPosition", () => {
  const terminals = [
    terminal({ address: "t1", cwd: "/home/me/api" }),
    terminal({ address: "t2", cwd: "/home/me/web" }),
    terminal({ address: "t3", cwd: "/home/me/api", state: "finished" }),
    terminal({ address: "t4", cwd: "/home/me/api" }),
    terminal({ address: "box/t4", cwd: "/srv/api" }),
  ];

  test("counts the live terminals of the same space on the same machine, in feed order", () => {
    expect(tabPosition(terminals, "t1")).toEqual({ index: 1, count: 2 });
    expect(tabPosition(terminals, "t4")).toEqual({ index: 2, count: 2 });
    expect(tabPosition(terminals, "t2")).toEqual({ index: 1, count: 1 });
    expect(tabPosition(terminals, "box/t4")).toEqual({ index: 1, count: 1 });
  });

  test("a finished or unknown terminal has no position", () => {
    expect(tabPosition(terminals, "t3")).toBeUndefined();
    expect(tabPosition(terminals, "t9")).toBeUndefined();
  });
});

describe("agentCounts", () => {
  test("agrees with the agent sections for done, working and idle, leaving out offline and finished terminals", () => {
    const terminals = [
      terminal({ address: "t1" }),
      terminal({ address: "t2", status: { state: "working" } }),
      terminal({ address: "t3", status: { state: "done" } }),
      terminal({ address: "t4", status: { state: "working" } }),
      terminal({ address: "t5", status: { state: "blocked" } }),
      terminal({ address: "t6", state: "finished" }),
      { ...terminal({ address: "box/t1", status: { state: "working" } }), offline: true as const },
    ];
    const groups = groupAgents(terminals, 0);
    expect(agentCounts(terminals)).toEqual({
      done: groups.done.length,
      working: groups.working.length,
      idle: groups.idle.length,
    });
    expect(agentCounts(terminals)).toEqual({ done: 1, working: 2, idle: 1 });
  });
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

describe("terminalTitle", () => {
  test("a herdr.name label wins over hc's name and the program's title; an empty one does not count", () => {
    expect(terminalTitle(terminal({ name: "worker", title: "vim", labels: { "herdr.name": "deploy" } }))).toBe(
      "deploy",
    );
    expect(terminalTitle(terminal({ name: "worker", labels: { "herdr.name": "", title: "old" } }))).toBe("worker");
  });
});
