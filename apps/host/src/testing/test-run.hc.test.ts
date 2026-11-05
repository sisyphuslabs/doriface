import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveHcBin } from "./hc-session.ts";

const ROOT = join(import.meta.dir, "..", "..", "..", "..");

async function refused(socket: string): Promise<boolean> {
  try {
    (await Bun.connect({ unix: socket, socket: { data: () => {} } })).end();
    return false;
  } catch (error) {
    if (error instanceof Error && "code" in error && ["ECONNREFUSED", "ENOENT"].includes(String(error.code)))
      return true;
    throw error;
  }
}

test("bun run test's runner fails a run whose tests pass but leave a core, and stops that core", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dh-leak-"));
  try {
    const runner = Bun.spawn(
      [process.execPath, "apps/host/scripts/test-run.ts", "./apps/host/src/testing/leak-one-core.fixture.ts"],
      { cwd: ROOT, env: { ...process.env, LEAK_DIR: dir }, stdout: "pipe", stderr: "pipe" },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(runner.stdout).text(),
      new Response(runner.stderr).text(),
      runner.exited,
    ]);
    const output = stdout + stderr;
    expect(output).toContain("1 pass");
    expect(output).toContain("processes outlived the test run (now stopped): 1");
    expect(code).toBe(1);
    expect(await refused(join(dir, "c.sock"))).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 60_000);

test("bun run test's runner fails a run that leaves a process which starts a core after bun test exits, and leaves no core", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dh-late-"));
  const socket = join(dir, "c.sock");
  try {
    const runner = Bun.spawn(
      [process.execPath, "apps/host/scripts/test-run.ts", "./apps/host/src/testing/leak-late-core.fixture.ts"],
      { cwd: ROOT, env: { ...process.env, LEAK_DIR: dir }, stdout: "pipe", stderr: "pipe" },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(runner.stdout).text(),
      new Response(runner.stderr).text(),
      runner.exited,
    ]);
    const output = stdout + stderr;
    expect(output).toContain("1 pass");
    expect(output).toContain("outlived the test run (now stopped)");
    expect(code).toBe(1);
    // The runner returns only once no process of the run is left, so nothing can start this core any more.
    expect(await refused(socket)).toBe(true);
  } finally {
    if (!(await refused(socket)))
      Bun.spawnSync([resolveHcBin(), "server", "stop"], {
        env: { ...process.env, HC_SOCKET: socket, XDG_RUNTIME_DIR: join(dir, "run") },
        stdout: "ignore",
        stderr: "ignore",
      });
    rmSync(dir, { recursive: true, force: true });
  }
}, 60_000);
