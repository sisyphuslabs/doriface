import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateToken } from "./auth.ts";
import { startHost } from "./host.ts";
import { resolveHcBin } from "./testing/hc-session.ts";

// Every hc call starts its session's core when none runs, so a host that ran hc at start with no HC_SESSION left a
// default-session herdr-core behind (#306). Its runtime dir is a fresh one here, so any core it starts lands in it.
test("a host started and stopped with no HC_SESSION and no client starts no herdr-core", async () => {
  const root = mkdtempSync(join(tmpdir(), "dh-no-core-"));
  const runtime = join(root, "run");
  mkdirSync(runtime, { mode: 0o700 });
  // A home of its own too: hc finds a default core another user of this machine's home already runs.
  const env: Record<string, string | undefined> = {
    ...process.env,
    HOME: join(root, "home"),
    XDG_RUNTIME_DIR: runtime,
    XDG_STATE_HOME: join(root, "home", ".state"),
    XDG_DATA_HOME: join(root, "home", ".data"),
    XDG_CONFIG_HOME: join(root, "home", ".config"),
  };
  delete env["HC_SESSION"];
  delete env["HC_SOCKET"];
  const sockets = () => {
    const dir = join(runtime, "herdr-core");
    return existsSync(dir) ? readdirSync(dir) : [];
  };
  try {
    const host = await startHost({
      listen: { hostname: "127.0.0.1", port: 0 },
      token: generateToken(),
      hc: resolveHcBin(),
      env,
      platform: "linux",
      log: () => {},
    });
    await host.stop();
    expect(sockets()).toEqual([]);
  } finally {
    if (sockets().length > 0)
      Bun.spawnSync([resolveHcBin(), "server", "stop"], { env, stdout: "ignore", stderr: "ignore" });
    rmSync(root, { recursive: true, force: true });
  }
});
