import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") return false;
    throw error;
  }
}

interface Leaked {
  readonly output: string;
  readonly code: number;
  /** The pids the runner reported it stopped. */
  readonly stopped: readonly number[];
  /** The socket of the core the fixture left. */
  readonly socket: string;
}

/** Runs `fixture` through `bun run test`'s runner; the fixture leaves a core in the run's dir and says where. */
async function runLeaking(fixture: string, leak: string): Promise<Leaked> {
  const runner = Bun.spawn([process.execPath, "apps/host/scripts/test-run.ts", fixture], {
    cwd: ROOT,
    env: { ...process.env, LEAK_DIR: leak },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(runner.stdout).text(),
    new Response(runner.stderr).text(),
    runner.exited,
  ]);
  const output = stdout + stderr;
  const stopped = [...output.matchAll(/^ {2}pid (\d+): /gm)].map((match) => Number(match[1]));
  return { output, code, stopped, socket: readFileSync(join(leak, "socket"), "utf8") };
}

test("bun run test's runner fails a run whose tests pass but leave a core, and stops that core", async () => {
  const leak = mkdtempSync(join(tmpdir(), "dh-leak-"));
  try {
    const run = await runLeaking("./apps/host/src/testing/leak-one-core.fixture.ts", leak);
    expect(run.output).toContain("1 pass");
    expect(run.output).toContain("processes outlived the test run (now stopped): 1");
    expect(run.code).toBe(1);
    expect(run.stopped.filter(alive)).toEqual([]);
    expect(await refused(run.socket)).toBe(true);
  } finally {
    rmSync(leak, { recursive: true, force: true });
  }
}, 60_000);

test("bun run test's runner fails a run that leaves a process which starts a core after bun test exits, and leaves no core", async () => {
  const leak = mkdtempSync(join(tmpdir(), "dh-late-"));
  try {
    const run = await runLeaking("./apps/host/src/testing/leak-late-core.fixture.ts", leak);
    expect(run.output).toContain("1 pass");
    expect(run.output).toContain("outlived the test run (now stopped)");
    expect(run.code).toBe(1);
    // The runner returns only once no process of the run is left, so nothing can start this core any more.
    expect(run.stopped.length).toBeGreaterThan(0);
    expect(run.stopped.filter(alive)).toEqual([]);
    expect(await refused(run.socket)).toBe(true);
  } finally {
    rmSync(leak, { recursive: true, force: true });
  }
}, 60_000);
