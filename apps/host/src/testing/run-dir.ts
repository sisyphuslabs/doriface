import { execFile } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

/** Set by `pinRunDir` in a Playwright runner to the run's own dir; its workers and web servers inherit it. */
export const E2E_RUN_DIR = "DORIFACE_E2E_RUN_DIR";

const STOP_LEFT = fileURLToPath(new URL("./stop-left.ts", import.meta.url));

/** An hc process a run left, as `stop-left.ts` stopped it: its pid, arguments and the file it held. */
export interface LeftProcess {
  readonly pid: number;
  readonly command: string;
  readonly where: string;
}

/**
 * Waits up to `waitMs` for the hc processes holding files under `dir` to exit, then stops those still running and
 * returns them. It runs the host tests' guard (#232) in `bun`, so it works from a Playwright runner or worker, which
 * run on Node. With no process scan on this platform (Windows) it finds none.
 */
export async function stopLeftUnder(dir: string, waitMs = 0): Promise<LeftProcess[]> {
  if (process.platform !== "linux" && process.platform !== "darwin") return [];
  const { stdout } = await promisify(execFile)("bun", [STOP_LEFT, dir, String(waitMs)], { encoding: "utf8" });
  return JSON.parse(stdout) as LeftProcess[];
}

/**
 * Gives this Playwright run a $TMPDIR of its own, as `bun run test` gives the unit run (#232): every scratch session,
 * host and app the run starts keeps its files under it, so the run's teardown (`sweepRunDir`) finds any hc process the
 * run left, a core launchd started on macOS included (#470). The runner makes the dir; a worker, whose environment is
 * the runner's, gets the same one. It must run before anything reads `tmpdir()`.
 */
export function pinRunDir(prefix: string): string {
  const pinned = process.env[E2E_RUN_DIR];
  if (pinned !== undefined && pinned !== "") return pinned;
  // Short on macOS, whose $TMPDIR is deep: a scratch socket under it must stay within the 103-byte sun_path limit.
  const base = process.platform === "darwin" ? "/tmp" : tmpdir();
  // Resolved, since a process is seen holding resolved paths (macOS: /var and /tmp are links into /private).
  const dir = realpathSync(mkdtempSync(join(base, prefix)));
  process.env[E2E_RUN_DIR] = dir;
  process.env["TMPDIR"] = dir;
  return dir;
}

/**
 * Stops every hc process holding a file under the run's dir, removes the dir, and returns those processes as
 * "pid N: arguments (the file it held)", never an environment; empty when the run left none.
 */
export async function sweepRunDir(dir = process.env[E2E_RUN_DIR]): Promise<string[]> {
  if (dir === undefined || dir === "") return [];
  const left = await stopLeftUnder(dir);
  rmSync(dir, { recursive: true, force: true });
  return left.map(({ pid, command, where }) => `pid ${pid}: ${command} (${where})`);
}
