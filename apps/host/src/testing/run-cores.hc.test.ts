import { expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveHcBin } from "./hc-session.ts";
import { RUN_MARK, runCores, runProcesses, stopRunProcesses, type TestRun } from "./run-cores.ts";

const encoder = new TextEncoder();

const newRun = (): TestRun => ({
  mark: crypto.randomUUID(),
  dir: realpathSync(mkdtempSync(join(tmpdir(), "dh-run-"))),
});

/**
 * Starts a core through `hc connect` on a scratch session in `run`'s dir and leaves it running. With `marked` false its
 * environment has no run mark, as a core launchd starts on macOS has none.
 */
async function startCore(run: TestRun, marked: boolean): Promise<string> {
  const dir = mkdtempSync(join(run.dir, "dh-"));
  const env: Record<string, string | undefined> = {
    ...process.env,
    HC_SESSION: "run-cores",
    HC_SOCKET: join(dir, "c.sock"),
    XDG_STATE_HOME: join(dir, "state"),
    XDG_RUNTIME_DIR: join(dir, "run"),
    [RUN_MARK]: run.mark,
  };
  if (!marked) delete env[RUN_MARK];
  const proc = Bun.spawn([resolveHcBin(), "connect", "--session", "run-cores"], {
    env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
  });
  proc.stdin.write(encoder.encode('{"jsonrpc":"2.0","id":1,"method":"server.status"}\n'));
  await proc.stdin.flush();
  const reader = proc.stdout.getReader();
  await reader.read();
  reader.releaseLock();
  void proc.stdin.end();
  await proc.exited;
  return join(dir, "c.sock");
}

async function serving(socket: string): Promise<boolean> {
  try {
    (await Bun.connect({ unix: socket, socket: { data: () => {} } })).end();
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && ["ECONNREFUSED", "ENOENT"].includes(String(error.code)))
      return false;
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

test("a core a run left without its mark is found by the file it holds in the run's dir and stopped; another run's core is not touched", async () => {
  const [mine, other] = [newRun(), newRun()];
  try {
    const [socket, otherSocket] = await Promise.all([startCore(mine, false), startCore(other, true)]);
    const found = await runCores(mine);
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((core) => core.where.startsWith(`holds ${mine.dir}/`))).toBe(true);
    const stopped = await stopRunProcesses(mine);
    expect(stopped.map((core) => core.pid).filter(alive)).toEqual([]);
    expect(await runCores(mine)).toEqual([]);
    expect(await serving(socket)).toBe(false);
    expect(await serving(otherSocket)).toBe(true);
  } finally {
    await Promise.all([stopRunProcesses(mine), stopRunProcesses(other)]);
    for (const run of [mine, other]) rmSync(run.dir, { recursive: true, force: true });
  }
}, 60_000);

test("a process carrying a run's mark is found and stopped whatever its program", async () => {
  const run = newRun();
  try {
    const sleeper = Bun.spawn(["sh", "-c", "exec sleep 60"], {
      env: { ...process.env, [RUN_MARK]: run.mark },
      stdio: ["ignore", "ignore", "ignore"],
    });
    expect((await runProcesses(run)).map((found) => found.pid)).toContain(sleeper.pid);
    const stopped = await stopRunProcesses(run);
    expect(stopped.map((found) => found.pid)).toContain(sleeper.pid);
    await sleeper.exited;
    expect(await runProcesses(run)).toEqual([]);
  } finally {
    await stopRunProcesses(run);
    rmSync(run.dir, { recursive: true, force: true });
  }
}, 60_000);
