// The hc processes an e2e host started (its core, its added machine's core, their lines), found by the host's own
// directory in their environment, so a host that has stopped can show it left none running (#226).
import { spawnSync } from "node:child_process";

const GONE_WITHIN_MS = 15_000;

/** The pids of this user's processes named `name`; pgrep exits 1 when there are none. */
function pidsNamed(name: string): number[] {
  const uid = process.getuid?.();
  const mine = uid === undefined ? [] : ["-u", String(uid)];
  const found = spawnSync("pgrep", ["-x", ...mine, name], { encoding: "utf8" });
  if (found.error !== undefined) throw found.error;
  if (found.status !== 0 && found.status !== 1)
    throw new Error(`pgrep -x ${name} exited ${String(found.status)}: ${found.stderr}`);
  return found.stdout.split("\n").flatMap((line) => (line.trim() === "" ? [] : [Number(line)]));
}

/** What `ps` prints for `pid` with these options; empty once the process has exited. */
const ps = (pid: number, options: readonly string[]): string =>
  spawnSync("ps", [...options, "-p", String(pid)], { encoding: "utf8" }).stdout.trim();

/**
 * Every herdr-core (or hc) process whose environment names `dir`, as "pid args". The environment is read only to match
 * `dir`; the name is the process's arguments alone, so no environment reaches a failure message or a log.
 */
export function coresUnder(dir: string): string[] {
  return ["herdr-core", "hc"]
    .flatMap(pidsNamed)
    .filter((pid) => ps(pid, ["eww", "-o", "command="]).includes(`=${dir}/`))
    .flatMap((pid) => {
      const named = ps(pid, ["-o", "pid=,args="]);
      return named === "" ? [] : [named];
    });
}

/**
 * Waits for the processes under `dir` to exit, as a core does once it is told to stop; returns those still running.
 * hc's cores are not this process's children (hc starts them detached), and Node offers no exit event for a process
 * that is not its child, so the process table is read again until they are gone or the bound runs out; a core still
 * running then is named and fails the worker.
 */
export async function coresLeftUnder(dir: string): Promise<string[]> {
  const deadline = Date.now() + GONE_WITHIN_MS;
  let left = coresUnder(dir);
  while (left.length > 0 && Date.now() < deadline) {
    // oxlint-disable-next-line no-await-in-loop -- a stopping core exits on its own; ask the process table again
    await new Promise((resolve) => setTimeout(resolve, 200));
    left = coresUnder(dir);
  }
  return left;
}
