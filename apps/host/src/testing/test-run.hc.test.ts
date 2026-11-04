import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
    expect(output).toContain("herdr-core outlived the test run (now stopped): 1");
    expect(code).toBe(1);
    expect(await refused(join(dir, "c.sock"))).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 60_000);
