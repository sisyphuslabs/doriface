import { readdirSync, readFileSync, readlinkSync } from "node:fs";
import { basename } from "node:path";

/** Set in the environment of a test run; every process the run starts inherits it, unless something strips it. */
export const RUN_MARK = "DORIFACE_TEST_RUN";

/**
 * A test run: its mark, and the dir that is its $TMPDIR, under which every scratch session of the run keeps its socket
 * and state. On macOS hc starts a core through a one-shot launchd job (unless over ssh), whose environment is launchd's
 * own, without the mark; such a core is the run's because it holds files under `dir` (#232).
 */
export interface TestRun {
  readonly mark: string;
  /** Resolved (no symlink in it): the paths a process is seen holding are. */
  readonly dir: string;
}

/** A process of a run: one that carries its mark, whatever its program, or a herdr process holding a file in its dir. */
export interface RunProcess {
  readonly pid: number;
  readonly command: string;
  /** Whether it is a herdr process (`herdr-core` or its `hc` alias). */
  readonly herdr: boolean;
  /**
   * Which test started it: the session, socket and runtime dir from its environment, or for a core without the mark
   * the file in the run's dir it holds.
   */
  readonly where: string;
}

const WHERE_KEYS = ["HC_SESSION", "HC_SOCKET", "XDG_RUNTIME_DIR"];

const whereOf = (vars: readonly string[]): string =>
  WHERE_KEYS.map((key) => vars.find((entry) => entry.startsWith(`${key}=`)) ?? `${key} unset`).join(" ");

const isHerdr = (argv0: string): boolean => ["herdr-core", "hc"].includes(basename(argv0));

const hasCode = (error: unknown, ...codes: readonly string[]): boolean =>
  error instanceof Error && "code" in error && typeof error.code === "string" && codes.includes(error.code);

/** The first of `paths` under `dir`. */
const under = (dir: string, paths: Iterable<string>): string | undefined => {
  for (const path of paths) if (path.startsWith(`${dir}/`)) return path;
  return undefined;
};

/** The files a process holds open, by path; none for one gone or not this user's. */
function linuxHeld(pid: number): string[] {
  let fds: string[];
  try {
    fds = readdirSync(`/proc/${pid}/fd`);
  } catch (error) {
    if (hasCode(error, "ENOENT", "ESRCH", "EACCES", "EPERM")) return [];
    throw error;
  }
  return fds.flatMap((fd) => {
    try {
      return [readlinkSync(`/proc/${pid}/fd/${fd}`)];
    } catch (error) {
      if (hasCode(error, "ENOENT", "ESRCH", "EACCES", "EPERM")) return [];
      throw error;
    }
  });
}

function linuxRun(run: TestRun): RunProcess[] {
  const mark = `${RUN_MARK}=${run.mark}`;
  const found: RunProcess[] = [];
  for (const entry of readdirSync("/proc")) {
    const pid = Number(entry);
    if (!Number.isInteger(pid)) continue;
    let environ: string;
    let argv: string[];
    try {
      environ = readFileSync(`/proc/${pid}/environ`, "utf8");
      argv = readFileSync(`/proc/${pid}/cmdline`, "utf8")
        .split("\0")
        .filter((part) => part !== "");
    } catch (error) {
      // gone since readdir, or another user's process
      if (hasCode(error, "ENOENT", "ESRCH", "EACCES", "EPERM")) continue;
      throw error;
    }
    const vars = environ.split("\0");
    const herdr = isHerdr(argv[0] ?? "");
    if (vars.includes(mark)) {
      found.push({ pid, command: argv.join(" "), herdr, where: whereOf(vars) });
      continue;
    }
    const held = herdr ? under(run.dir, linuxHeld(pid)) : undefined;
    if (held !== undefined) found.push({ pid, command: argv.join(" "), herdr, where: `holds ${held}` });
  }
  return found;
}

/** The files each of `pids` holds open, by path (sockets included), from `lsof`. */
async function macHeld(pids: readonly number[]): Promise<Map<number, string[]>> {
  const held = new Map<number, string[]>();
  if (pids.length === 0) return held;
  const lsof = Bun.spawn(["lsof", "-nP", "-Fn", "-p", pids.join(",")], { stdout: "pipe", stderr: "ignore" });
  const [text, code] = await Promise.all([new Response(lsof.stdout).text(), lsof.exited]);
  // 1 when some pid has exited since ps listed it; the others are still listed.
  if (code !== 0 && code !== 1) throw new Error(`lsof exited ${code}`);
  let pid = 0;
  for (const line of text.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    else if (line.startsWith("n")) held.set(pid, [...(held.get(pid) ?? []), line.slice(1)]);
  }
  return held;
}

async function macRun(run: TestRun): Promise<RunProcess[]> {
  const mark = `${RUN_MARK}=${run.mark}`;
  // `ps -E` appends each process's environment to its command; it shows it for this user's processes.
  const uid = process.getuid?.();
  if (uid === undefined) throw new Error("no uid to scan processes for");
  const ps = Bun.spawn(["ps", "-Eww", "-U", String(uid), "-o", "pid=,command="], {
    stdout: "pipe",
    stderr: "inherit",
  });
  const [text, code] = await Promise.all([new Response(ps.stdout).text(), ps.exited]);
  if (code !== 0) throw new Error(`ps exited ${code}`);
  const found: RunProcess[] = [];
  const unmarked: { pid: number; command: string }[] = [];
  for (const line of text.split("\n")) {
    const [pid, argv0, ...rest] = line.trim().split(/\s+/);
    if (pid === undefined || argv0 === undefined) continue;
    const command = [argv0, ...rest.filter((word) => !word.includes("="))].join(" ");
    if (rest.includes(mark)) found.push({ pid: Number(pid), command, herdr: isHerdr(argv0), where: whereOf(rest) });
    else if (isHerdr(argv0)) unmarked.push({ pid: Number(pid), command });
  }
  const held = await macHeld(unmarked.map(({ pid }) => pid));
  for (const { pid, command } of unmarked) {
    const path = under(run.dir, held.get(pid) ?? []);
    if (path !== undefined) found.push({ pid, command, herdr: true, where: `holds ${path}` });
  }
  return found;
}

/** The processes of `run`: those carrying its mark, whatever their program, and herdr processes holding a file in its dir. */
export async function runProcesses(run: TestRun): Promise<RunProcess[]> {
  if (process.platform === "linux") return linuxRun(run);
  if (process.platform === "darwin") return macRun(run);
  throw new Error(`no process scan on ${process.platform}`);
}

/** The herdr processes of `run`. */
export async function runCores(run: TestRun): Promise<RunProcess[]> {
  return (await runProcesses(run)).filter((found) => found.herdr);
}

const ROUND_MS = 100;
/** Rounds that only wait for the run's processes to exit by themselves, before any is stopped. */
const GRACE_ROUNDS = 20;
const ROUNDS = 120;
/**
 * Empty scans in a row that end the stops. One scan can miss a process handing off to its child (`hc connect` exiting as
 * the core it started comes up): the parent is gone before its environment is read, the child is not yet listed.
 */
const EMPTY_SCANS = 3;

/**
 * Stops every process of `run` (see runProcesses) by its pid, and returns them: a shell a test left can start a core
 * after any scan for cores alone, and `hc server stop` does not stop a core launchd started. It first gives them GRACE_ROUNDS to exit by themselves, then stops what is left and
 * scans again until EMPTY_SCANS scans in a row find none, so a core started meanwhile (by such a shell, or a dialer's reconnect) is
 * stopped and returned too. A pid that is not a child of this process has no exit event, so each round waits ROUND_MS
 * before it scans again.
 */
export async function stopRunProcesses(run: TestRun): Promise<RunProcess[]> {
  const seen = new Map<number, RunProcess>();
  const round = async (n: number, empty: number): Promise<RunProcess[]> => {
    const found = await runProcesses(run);
    if (found.length === 0) {
      if (empty + 1 === EMPTY_SCANS) return [...seen.values()];
      await Bun.sleep(ROUND_MS);
      return round(n + 1, empty + 1);
    }
    if (n === ROUNDS) {
      throw new Error(`processes of run ${run.mark} still running after ${(ROUNDS * ROUND_MS) / 1000} s of stops`);
    }
    for (const core of n < GRACE_ROUNDS ? [] : found) {
      seen.set(core.pid, core);
      try {
        process.kill(core.pid, n < (GRACE_ROUNDS + ROUNDS) / 2 ? "SIGTERM" : "SIGKILL");
      } catch (error) {
        // exited between the scan and the signal
        if (!hasCode(error, "ESRCH")) throw error;
      }
    }
    await Bun.sleep(ROUND_MS);
    return round(n + 1, 0);
  };
  return round(0, 0);
}
