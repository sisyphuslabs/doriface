import { expect, test } from "bun:test";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..", "..", "..");

/** Runs `fixture` through `bun run test`'s runner, preloaded guard included, and returns everything it printed. */
async function run(fixture: string): Promise<{ readonly output: string; readonly code: number }> {
  const runner = Bun.spawn([process.execPath, "apps/host/scripts/test-run.ts", fixture], {
    cwd: ROOT,
    env: { ...process.env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(runner.stdout).text(),
    new Response(runner.stderr).text(),
    runner.exited,
  ]);
  return { output: stdout + stderr, code };
}

test("a core that comes back after its test disposed the session fails that test, named with where the session was made (#441)", async () => {
  const { output, code } = await run("./apps/host/src/testing/core-back.fixture.ts");
  expect(code).not.toBe(0);
  // The test that made the session fails, and the failure says where the session was made.
  expect(output).toMatch(/\(fail\) brings its session's core back after disposing it/);
  expect(output).toMatch(/core-back-[0-9a-f]{8} \(made at [^)]*core-back\.fixture\.ts:\d+/);
  // The next test is not blamed, and nothing is left for the suite's end to report without a name.
  expect(output).toMatch(/\(pass\) a later test that starts no core/);
  expect(output).not.toContain("(fail) (unnamed)");
}, 120_000);
