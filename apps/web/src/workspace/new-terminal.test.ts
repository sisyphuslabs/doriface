import type { Terminal } from "@doriface/protocol";
import { describe, expect, test } from "bun:test";
import { currentTerminal, runParamsFor } from "./new-terminal.ts";

const terminal = (address: string, fields: Partial<Terminal> = {}): Terminal => ({
  address,
  argv: ["sh"],
  cols: 80,
  rows: 24,
  created_ms: 0,
  cwd: "/work/api",
  labels: {},
  screen: "exact",
  state: "live",
  ...fields,
});

describe("runParamsFor", () => {
  test("with nothing active the core's defaults apply", () => {
    expect(runParamsFor(undefined)).toEqual({});
  });

  test("starts in the active terminal's directory, its shell's current one when hc reports it", () => {
    expect(runParamsFor(terminal("t1"))).toEqual({ cwd: "/work/api" });
    const moved = terminal("t1", { foreground: { argv: ["sh"], name: "sh", pid: 9, cwd: "/work/api/src" } });
    expect(runParamsFor(moved)).toEqual({ cwd: "/work/api/src" });
  });

  test("an active terminal on an added machine starts the new one there, and a named space carries over", () => {
    expect(runParamsFor(terminal("build/t3", { labels: { space: "infra" } }))).toEqual({
      cwd: "/work/api",
      on: "build",
      labels: { space: "infra" },
    });
  });
});

describe("currentTerminal", () => {
  test("takes the directory the shell has moved to, keeping the address and labels this client knows", async () => {
    const active = terminal("build/t3", { labels: { space: "infra" } });
    const moved = { ...terminal("t3"), foreground: { argv: ["sh"], name: "sh", pid: 9, cwd: "/work/api/src" } };
    const current = await currentTerminal(() => Promise.resolve(moved), active);
    expect(runParamsFor(current)).toEqual({ cwd: "/work/api/src", on: "build", labels: { space: "infra" } });
  });

  test("a failed read starts from the snapshot", async () => {
    const active = terminal("t1");
    expect(await currentTerminal(() => Promise.reject(new Error("gone")), active)).toBe(active);
  });
});
