import { readdirSync, readFileSync } from "node:fs";
import { basename } from "node:path";

/** Set in the environment of a test run; every process the run starts, herdr cores included, inherits it. */
export const RUN_MARK = "DORIFACE_TEST_RUN";

/** A process that carries a run's mark: a herdr core, or anything else a test started (a shell that may start one). */
export interface MarkedProcess {
  readonly pid: number;
  readonly command: string;
  /** Whether it is a herdr process (`herdr-core` or its `hc` alias). */
  readonly herdr: boolean;
  /** The session, socket and runtime dir it serves (from its environment), which name the test that started it. */
  readonly where: string;
}

const WHERE_KEYS = ["HC_SESSION", "HC_SOCKET", "XDG_RUNTIME_DIR"];

const whereOf = (vars: readonly string[]): string =>
  WHERE_KEYS.map((key) => vars.find((entry) => entry.startsWith(`${key}=`)) ?? `${key} unset`).join(" ");

const isHerdr = (argv0: string): boolean => ["herdr-core", "hc"].includes(basename(argv0));

const hasCode = (error: unknown, ...codes: readonly string[]): boolean =>
  error instanceof Error && "code" in error && typeof error.code === "string" && codes.includes(error.code);

function linuxMarked(mark: string): MarkedProcess[] {
  const found: MarkedProcess[] = [];
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
    if (vars.includes(mark))
      found.push({ pid, command: argv.join(" "), herdr: isHerdr(argv[0] ?? ""), where: whereOf(vars) });
  }
  return found;
}

async function macMarked(mark: string): Promise<MarkedProcess[]> {
  // `ps -E` appends each process's environment to its command; it shows it for this user's processes.
  const uid = process.getuid?.();
  if (uid === undefined) throw new Error("no uid to scan processes for");
  const ps = Bun.spawn(["ps", "-Eww", "-U", String(uid), "-o", "pid=,command="], {
    stdout: "pipe",
    stderr: "inherit",
  });
  const [text, code] = await Promise.all([new Response(ps.stdout).text(), ps.exited]);
  if (code !== 0) throw new Error(`ps exited ${code}`);
  const found: MarkedProcess[] = [];
  for (const line of text.split("\n")) {
    const [pid, argv0, ...rest] = line.trim().split(/\s+/);
    if (pid === undefined || argv0 === undefined || !rest.includes(mark)) continue;
    found.push({
      pid: Number(pid),
      command: [argv0, ...rest.filter((word) => !word.includes("="))].join(" "),
      herdr: isHerdr(argv0),
      where: whereOf(rest),
    });
  }
  return found;
}

/** Processes whose environment carries `RUN_MARK=<run>`, whatever their program. */
export async function markedProcesses(run: string): Promise<MarkedProcess[]> {
  const mark = `${RUN_MARK}=${run}`;
  if (process.platform === "linux") return linuxMarked(mark);
  if (process.platform === "darwin") return macMarked(mark);
  throw new Error(`no process scan on ${process.platform}`);
}

/** Herdr processes whose environment carries `RUN_MARK=<run>`. */
export async function markedCores(run: string): Promise<MarkedProcess[]> {
  return (await markedProcesses(run)).filter((found) => found.herdr);
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
 * Stops every process marked with `run`, whatever its program, and returns them: a shell a test left can start a core
 * after any scan for cores alone. It first gives them GRACE_ROUNDS to exit by themselves, then stops what is left and
 * scans again until EMPTY_SCANS scans in a row find none, so a core started meanwhile (by such a shell, or a dialer's reconnect) is
 * stopped and returned too. A pid that is not a child of this process has no exit event, so each round waits ROUND_MS
 * before it scans again.
 */
export async function stopRunProcesses(run: string): Promise<MarkedProcess[]> {
  const seen = new Map<number, MarkedProcess>();
  const round = async (n: number, empty: number): Promise<MarkedProcess[]> => {
    const found = await markedProcesses(run);
    if (found.length === 0) {
      if (empty + 1 === EMPTY_SCANS) return [...seen.values()];
      await Bun.sleep(ROUND_MS);
      return round(n + 1, empty + 1);
    }
    if (n === ROUNDS) {
      throw new Error(`processes of run ${run} still running after ${(ROUNDS * ROUND_MS) / 1000} s of stops`);
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
