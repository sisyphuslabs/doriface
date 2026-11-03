import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findHc, hostCommand, usualHcDirs, type HostContext } from "../src/main/host-command.ts";

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

  test("an empty BUN_BIN counts as unset", () => {
    expect(hostCommand(context({ env: { BUN_BIN: "" } })).file).toBe("bun");
    expect(hostCommand(context({ env: { BUN_BIN: "/opt/bun" } })).file).toBe("/opt/bun");
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
  test("the usual directories follow the platform", () => {
    const unix = [join("/h", ".local", "bin"), join("/h", ".cargo", "bin"), "/opt/homebrew/bin", "/usr/local/bin"];
    expect(usualHcDirs(context({ home: "/h" }))).toEqual(unix);
    expect(usualHcDirs(context({ home: "/h", platform: "win32" }))).toEqual(unix.slice(0, 2));
  });

  test("HC_BIN wins, then PATH, then the usual install directories", () => {
    const home = mkdtempSync(join(tmpdir(), "dd-hc-"));
    try {
      const local = join(home, ".local", "bin");
      mkdirSync(local, { recursive: true });
      writeFileSync(join(local, "hc"), "#!/bin/sh\n");
      chmodSync(join(local, "hc"), 0o755);
      const empty = join(home, "empty");
      expect(findHc(context({ home, env: { HC_BIN: "/pinned/hc", PATH: local } }), [])).toBe("/pinned/hc");
      expect(findHc(context({ home, env: { PATH: local } }), [])).toBe(join(local, "hc"));
      expect(findHc(context({ home, env: { PATH: "" } }), [local])).toBe(join(local, "hc"));
      expect(findHc(context({ home, env: { PATH: empty } }), [empty])).toBeUndefined();
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
