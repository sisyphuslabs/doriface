import { spawnSync } from "node:child_process";

/**
 * Ends each recorded line process that `isLine` still recognizes, its children first (Linux dash keeps a `sh -c` around
 * the line). A line whose process exited before the stop is already stopped, so it is skipped, and a process that exits
 * between the check and the signal (ESRCH) is stopped too. Only an empty record fails: then no line was ever dialed.
 */
export function stopLines(pids: readonly number[], isLine: (pid: number) => boolean): void {
  if (pids.length === 0) throw new Error("no line pid was recorded");
  for (const pid of pids.filter(isLine)) {
    for (const child of childrenOf(pid)) terminate(child);
    terminate(pid);
  }
}

function terminate(pid: number): void {
  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
  }
}

function childrenOf(pid: number): number[] {
  const found = spawnSync("pgrep", ["-P", String(pid)], { encoding: "utf8" });
  return found.stdout.split("\n").flatMap((line) => (line.trim() === "" ? [] : [Number(line)]));
}
