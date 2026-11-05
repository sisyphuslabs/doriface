import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { E2E_RUN_DIR, sweepRunDir } from "./run-dir.ts";

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Starts the core of a scratch session under `dir`, as a spec whose dispose never ran leaves it; returns its pid. */
async function leaveCore(dir: string): Promise<number> {
  const hc = process.env["HC_BIN"] || Bun.which("hc") || "hc";
  const env = {
    ...process.env,
    HC_SESSION: "left-by-a-spec",
    HC_SOCKET: join(dir, "c.sock"),
    XDG_STATE_HOME: join(dir, "state"),
    XDG_RUNTIME_DIR: join(dir, "run"),
  };
  const control = Bun.spawn([hc, "connect", "--session", "left-by-a-spec"], { env, stdin: "pipe", stdout: "pipe" });
  control.stdin.write('{"jsonrpc":"2.0","id":1,"method":"server.status"}\n');
  await control.stdin.flush();
  const reader = control.stdout.getReader();
  const { value } = await reader.read();
  reader.releaseLock();
  void control.stdin.end();
  await control.exited;
  const reply = new TextDecoder().decode(value).split("\n")[0] ?? "";
  const result: unknown = Reflect.get(JSON.parse(reply) as object, "result");
  const pid = typeof result === "object" && result !== null ? Number(Reflect.get(result, "pid")) : Number.NaN;
  if (!Number.isInteger(pid)) throw new Error(`server.status answered no pid: ${reply}`);
  return pid;
}

test("the run's sweep stops a core a spec left under the run's dir, names it, and removes the dir (#470)", async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "dd-run-")));
  const core = await leaveCore(dir);
  try {
    expect(alive(core)).toBe(true);
    const left = await sweepRunDir(dir);
    expect(left).toHaveLength(1);
    expect(left[0]).toStartWith(`pid ${core}: `);
    expect(left[0]).toContain(`(holds ${dir}/`);
    expect(alive(core)).toBe(false);
    expect(existsSync(dir)).toBe(false);
  } finally {
    if (alive(core)) process.kill(core, "SIGKILL");
  }
}, 60_000);

test("a run that left nothing sweeps nothing and still removes its dir", async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "dd-run-")));
  expect(await sweepRunDir(dir)).toEqual([]);
  expect(existsSync(dir)).toBe(false);
});

const PIN = `import { pinRunDir } from ${JSON.stringify(join(import.meta.dir, "run-dir.ts"))};
const dir = pinRunDir("dd-run-");
console.log(JSON.stringify({ dir, tmp: process.env.TMPDIR, pinned: process.env.${E2E_RUN_DIR} }));`;

async function pinIn(env: Record<string, string | undefined>): Promise<{ dir: string; tmp: string; pinned: string }> {
  const child = Bun.spawn([process.execPath, "-e", PIN], { env, stdout: "pipe", stderr: "inherit" });
  const [text, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  if (code !== 0) throw new Error(`pinRunDir exited ${code}`);
  return JSON.parse(text) as { dir: string; tmp: string; pinned: string };
}

test("a runner pins a new resolved dir as its $TMPDIR; a worker, which inherits the pin, keeps the runner's", async () => {
  const runner = await pinIn({ ...process.env, [E2E_RUN_DIR]: undefined });
  expect(runner.dir).toBe(realpathSync(runner.dir));
  expect(runner.tmp).toBe(runner.dir);
  expect(runner.pinned).toBe(runner.dir);
  expect(await sweepRunDir(runner.dir)).toEqual([]);

  const kept = realpathSync(mkdtempSync(join(tmpdir(), "dd-run-")));
  const worker = await pinIn({ ...process.env, [E2E_RUN_DIR]: kept, TMPDIR: kept });
  expect(worker).toEqual({ dir: kept, tmp: kept, pinned: kept });
  expect(await sweepRunDir(kept)).toEqual([]);
});
