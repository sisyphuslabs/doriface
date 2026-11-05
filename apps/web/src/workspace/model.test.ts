import type { Terminal } from "@doriface/protocol";
import { describe, expect, test } from "bun:test";
import {
  agentCounts,
  agentStatus,
  asksBeforeClosing,
  firstInSpace,
  groupAgents,
  runsProgram,
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

const front = (argv: string[]) => ({ argv, cwd: "/work", name: argv[0] ?? "", pid: 2 });
const reportedState = (state: string) => ({ state }) as unknown as NonNullable<Terminal["status"]>;
const read = (fields: Partial<Terminal>) => runsProgram(terminal(fields));

describe("closing", () => {
  test("a shell at its prompt and an agent between turns run nothing; a program in front or an agent's turn does", () => {
    expect([
      read({ argv: ["/bin/zsh"], foreground: front(["-zsh"]) }),
      read({ argv: ["/bin/sh"] }),
      read({ argv: ["cmd.exe"] }),
      read({ argv: ["/bin/zsh"], foreground: front(["vim", "notes.md"]) }),
      read({ argv: ["htop"] }),
      read({ argv: ["/bin/zsh"], foreground: front(["claude"]), status: reportedState("working") }),
      read({ argv: ["/bin/zsh"], foreground: front(["claude"]), status: reportedState("idle") }),
      read({ argv: ["/bin/zsh"], foreground: front(["vim"]), state: "finished" }),
    ]).toEqual([false, false, false, true, true, true, false, false]);
  });

  test("confirm-close-surface: false never asks, always always does, and the default asks while a program runs", () => {
    const idle = terminal({ argv: ["/bin/sh"] });
    const busy = terminal({ argv: ["/bin/sh"], foreground: front(["sleep", "600"]) });
    expect([
      asksBeforeClosing("false", [busy]),
      asksBeforeClosing("always", [idle]),
      asksBeforeClosing("true", [idle]),
      asksBeforeClosing("true", [idle, busy]),
      asksBeforeClosing("", [busy]),
    ]).toEqual([false, true, false, true, true]);
  });
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

describe("same-named spaces on one machine (#397)", () => {
  test("two directories ending the same way are two spaces, told apart by their parent, each selecting only itself", () => {
    const home = terminal({ address: "t1", cwd: "/Users/yeongyu" });
    const other = terminal({ address: "t2", cwd: "/Volumes/data/yeongyu" });
    const spaces = toSpaces([home, other]);
    expect(spaces.map((space) => space.name)).toEqual(["yeongyu · Users", "yeongyu · data"]);
    for (const active of [home, other]) {
      const selected = spaces.filter((space) => space.id === spaceId(active));
      expect(selected).toHaveLength(1);
      expect(firstInSpace([home, other], selected[0]?.id ?? "")).toBe(active.address);
    }
  });

  test("a space label still gathers terminals from any directory, and an unshared name gets no suffix", () => {
    const spaces = toSpaces([
      terminal({ address: "t1", cwd: "/a/x", labels: { space: "api" } }),
      terminal({ address: "t2", cwd: "/b/y", labels: { space: "api" } }),
    ]);
    expect(spaces.map((space) => [space.name, space.tabs])).toEqual([["api", 2]]);
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
