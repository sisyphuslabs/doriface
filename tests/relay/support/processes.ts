interface ProcessRow {
  readonly pid: number;
  readonly ppid: number;
  /** A zombie (Z), dead (Linux X), or one the kernel is tearing down (macOS flag E, a parenthesized name in `ps`). */
  readonly ended: boolean;
}

/** One `ps` snapshot of every process, without the `ps` that took it. */
async function snapshot(): Promise<ProcessRow[]> {
  const ps = Bun.spawn(["ps", "-A", "-o", "pid=,ppid=,stat="], { stdout: "pipe", stderr: "inherit" });
  const text = await new Response(ps.stdout).text();
  if ((await ps.exited) !== 0) throw new Error("ps failed");
  return text.split("\n").flatMap((line) => {
    const [pid, ppid, stat] = line.trim().split(/\s+/);
    if (pid === undefined || ppid === undefined || stat === undefined || pid === String(ps.pid)) return [];
    return [{ pid: Number(pid), ppid: Number(ppid), ended: /^[ZX]/.test(stat) || stat.includes("E") }];
  });
}

/** Live (not ended) processes descending from `root`, `root` excluded. */
export async function liveDescendants(root: number): Promise<number[]> {
  const rows = (await snapshot()).filter((row) => !row.ended);
  const found: number[] = [];
  const visit = (parent: number): void => {
    for (const row of rows.filter((candidate) => candidate.ppid === parent)) {
      found.push(row.pid);
      visit(row.pid);
    }
  };
  visit(root);
  return found;
}

/** Which of `pids` are still live (not ended) processes. */
export async function liveAmong(pids: readonly number[]): Promise<number[]> {
  const live = new Set((await snapshot()).filter((row) => !row.ended).map((row) => row.pid));
  return pids.filter((pid) => live.has(pid));
}
