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

/** Every herdr-core (or hc) process whose environment names `dir`, as "pid command". */
export function coresUnder(dir: string): string[] {
  return ["herdr-core", "hc"].flatMap(pidsNamed).flatMap((pid) => {
    // An exited pid prints nothing, so it is not counted.
    const seen = spawnSync("ps", ["eww", "-o", "command=", "-p", String(pid)], { encoding: "utf8" }).stdout.trim();
    return seen.includes(`=${dir}/`) ? [`${pid} ${seen.slice(0, 160)}`] : [];
  });
}

/** Waits for the processes under `dir` to exit, as a core does once it is told to stop; returns those still running. */
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
