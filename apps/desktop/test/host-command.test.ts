import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findHc, hostCommand, type HostContext } from "../src/main/host-command.ts";

const context = (overrides: Partial<HostContext>): HostContext => ({
  packaged: false,
  resourcesPath: "/res",
  appPath: "/repo/apps/desktop",
  platform: "linux",
  home: "/home/u",
  env: {},
  ...overrides,
});

describe("doriface-host command", () => {
  test("a checkout runs the workspace host with bun", () => {
    expect(hostCommand(context({}))).toEqual({ file: "bun", args: [join("/repo/apps", "host", "src", "cli.ts")] });
  });

  test("a packaged app runs the bundled binary", () => {
    expect(hostCommand(context({ packaged: true }))).toEqual({ file: join("/res", "bin", "doriface-host"), args: [] });
    expect(hostCommand(context({ packaged: true, platform: "win32" })).file).toBe(
      join("/res", "bin", "doriface-host.exe"),
    );
  });

  test("DORIFACE_HOST_BIN overrides both", () => {
    expect(hostCommand(context({ packaged: true, env: { DORIFACE_HOST_BIN: "/opt/h" } }))).toEqual({
      file: "/opt/h",
      args: [],
    });
  });
});

describe("finding hc", () => {
  test("HC_BIN wins, then PATH, then the usual install directories", () => {
    const home = mkdtempSync(join(tmpdir(), "dd-hc-"));
    try {
      const local = join(home, ".local", "bin");
      mkdirSync(local, { recursive: true });
      writeFileSync(join(local, "hc"), "#!/bin/sh\n");
      chmodSync(join(local, "hc"), 0o755);
      expect(findHc(context({ home, env: { HC_BIN: "/pinned/hc", PATH: local } }))).toBe("/pinned/hc");
      expect(findHc(context({ home: "/nowhere", env: { PATH: local } }))).toBe(join(local, "hc"));
      expect(findHc(context({ home, env: { PATH: "" } }))).toBe(join(local, "hc"));
      expect(findHc(context({ home: join(home, "empty"), env: { PATH: join(home, "empty") } }))).toBeUndefined();
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
