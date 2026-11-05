import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { coresLeftUnder } from "./core-processes.ts";

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const made: string[] = [];
afterEach(() => {
  for (const path of made.splice(0)) rmSync(path, { recursive: true, force: true });
});

/** Starts the core of a session whose socket and state are under `via`; returns its pid. */
async function startCore(via: string): Promise<number> {
  const hc = process.env["HC_BIN"] || Bun.which("hc") || "hc";
  const env = {
    ...process.env,
    HC_SESSION: "left-behind",
    HC_SOCKET: join(via, "c.sock"),
    XDG_STATE_HOME: join(via, "state"),
    XDG_RUNTIME_DIR: join(via, "run"),
  };
  const control = Bun.spawn([hc, "connect", "--session", "left-behind"], { env, stdin: "pipe", stdout: "pipe" });
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

// On macOS a core hc starts through launchd carries launchd's environment, not the host's, so nothing in it names the
// host's dir; here its environment names the dir only through a link to it, and the files it holds are still there.
test("a core the host left whose environment does not name the host's dir is found by its files, stopped and named (#470)", async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "dw-left-")));
  const link = join(realpathSync(tmpdir()), `dw-link-${crypto.randomUUID().slice(0, 8)}`);
  symlinkSync(dir, link);
  made.push(link, dir);
  const core = await startCore(link);
  try {
    expect(alive(core)).toBe(true);
    const left = await coresLeftUnder(dir);
    expect(left).toHaveLength(1);
    expect(left[0]).toStartWith(`${core} `);
    expect(alive(core)).toBe(false);
  } finally {
    if (alive(core)) process.kill(core, "SIGKILL");
  }
}, 60_000);

test("a host that stopped every core it started leaves nothing to name", async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "dw-clean-")));
  made.push(dir);
  expect(await coresLeftUnder(dir)).toEqual([]);
}, 60_000);
