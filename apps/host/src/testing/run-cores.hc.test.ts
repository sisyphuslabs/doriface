import { expect, test } from "bun:test";
import { createHcSession, type HcSession } from "./hc-session.ts";
import { markedCores, RUN_MARK, stopRunProcesses } from "./run-cores.ts";

const encoder = new TextEncoder();

/** Starts `session`'s core through `hc connect`, with `run` in its environment, and leaves it running. */
async function startMarked(session: HcSession, run: string): Promise<void> {
  const proc = Bun.spawn([session.hc, "connect", "--session", session.name], {
    env: { ...session.env, [RUN_MARK]: run },
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
}

async function serving(session: HcSession): Promise<boolean> {
  const socket = session.env["HC_SOCKET"];
  if (socket === undefined) throw new Error("no HC_SOCKET");
  try {
    (await Bun.connect({ unix: socket, socket: { data: () => {} } })).end();
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && ["ECONNREFUSED", "ENOENT"].includes(String(error.code)))
      return false;
    throw error;
  }
}

test("a core a run left running is found by its mark and stopped; another run's core is not touched", async () => {
  const [mine, other] = [createHcSession("run-mine"), createHcSession("run-other")];
  const [run, otherRun] = [crypto.randomUUID(), crypto.randomUUID()];
  await Promise.all([startMarked(mine, run), startMarked(other, otherRun)]);
  try {
    expect((await markedCores(run)).length).toBeGreaterThan(0);
    const stopped = await stopRunProcesses(run);
    expect(stopped.length).toBeGreaterThan(0);
    expect(stopped.every((core) => core.command.includes("serve"))).toBe(true);
    expect(await markedCores(run)).toEqual([]);
    expect(await serving(mine)).toBe(false);
    expect(await serving(other)).toBe(true);
  } finally {
    await Promise.all([mine.dispose(), other.dispose()]);
  }
}, 30_000);
