import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateToken } from "./auth.ts";
import { startHost } from "./host.ts";
import { resolveHcBin } from "./testing/hc-session.ts";

const CLI = join(import.meta.dir, "cli.ts");

/** A port nobody listens on right now: bind it, read it, release it. */
function freePort(): number {
  const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const port = probe.port ?? 0;
  void probe.stop(true);
  return port;
}

describe("startHost", () => {
  test("a LAN listener that cannot bind stops the main listener before rejecting", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "dh-start-"));
    const taken = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
    const main = freePort();
    try {
      const start = startHost({
        listen: { hostname: "127.0.0.1", port: main },
        lanListen: { hostname: "127.0.0.1", port: taken.port ?? 0 },
        token: generateToken(),
        hc: resolveHcBin(),
        stateDir,
        log: () => {},
      });
      expect(start).rejects.toThrow();
      await start.catch(() => {});
      const again = Bun.serve({ hostname: "127.0.0.1", port: main, fetch: () => new Response() });
      await again.stop(true);
    } finally {
      await taken.stop(true);
      rmSync(stateDir, { recursive: true, force: true });
    }
  });
});

describe("cli", () => {
  test("devices list escapes control characters in names it did not write", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "dh-cli-"));
    const device = {
      clientStaticPub: "A".repeat(43),
      name: "ok\u001b[2J\nfake line",
      pairedAt: "2026-01-01\u001b[2J\nT00:00",
    };
    writeFileSync(join(stateDir, "devices.json"), JSON.stringify({ version: 1, devices: [device] }));
    const proc = Bun.spawn([process.execPath, CLI, "devices", "list", "--state-dir", stateDir], { stdout: "pipe" });
    const stdout = await new Response(proc.stdout).text();
    rmSync(stateDir, { recursive: true, force: true });
    expect(stdout.split("\n")).toHaveLength(2);
    expect(stdout).toContain("ok\\u001b[2J\\u000afake line");
    expect(stdout).toContain("2026-01-01\\u001b[2J\\u000aT00:00");
  });

  test("a bad --lan-listen is reported as --lan-listen", async () => {
    const proc = Bun.spawn([process.execPath, CLI, "--lan-listen", "nope"], { stderr: "pipe" });
    const stderr = await new Response(proc.stderr).text();
    expect(await proc.exited).toBe(2);
    expect(stderr).toContain("--lan-listen wants host:port");
  });

  test("a malformed devices command fails without touching the state dir", async () => {
    const stateDir = join(mkdtempSync(join(tmpdir(), "dh-cli-")), "never");
    const proc = Bun.spawn([process.execPath, CLI, "devices", "lsit", "--state-dir", stateDir], { stderr: "pipe" });
    expect(await proc.exited).toBe(2);
    expect(Bun.spawnSync(["test", "-e", stateDir]).exitCode).toBe(1);
  });
});
