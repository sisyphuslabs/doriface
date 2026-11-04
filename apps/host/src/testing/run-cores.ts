import { readdirSync, readFileSync } from "node:fs";
import { basename } from "node:path";

/** Set in the environment of a test run; every process the run starts, herdr cores included, inherits it. */
export const RUN_MARK = "DORIFACE_TEST_RUN";

/** A herdr process (`herdr-core` or its `hc` alias) that carries a run's mark. */
export interface MarkedCore {
  readonly pid: number;
  readonly command: string;
  /** The session, socket and runtime dir it serves (from its environment), which name the test that started it. */
  readonly where: string;
}

const WHERE_KEYS = ["HC_SESSION", "HC_SOCKET", "XDG_RUNTIME_DIR"];

const whereOf = (vars: readonly string[]): string =>
  WHERE_KEYS.map((key) => vars.find((entry) => entry.startsWith(`${key}=`)) ?? `${key} unset`).join(" ");

const isHerdr = (argv0: string): boolean => ["herdr-core", "hc"].includes(basename(argv0));

const hasCode = (error: unknown, ...codes: readonly string[]): boolean =>
  error instanceof Error && "code" in error && typeof error.code === "string" && codes.includes(error.code);

function linuxCores(mark: string): MarkedCore[] {
  const found: MarkedCore[] = [];
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
    if (isHerdr(argv[0] ?? "") && vars.includes(mark))
      found.push({ pid, command: argv.join(" "), where: whereOf(vars) });
  }
  return found;
}

async function macCores(mark: string): Promise<MarkedCore[]> {
  // `ps -E` appends each process's environment to its command; it shows it for this user's processes.
  const uid = process.getuid?.();
  if (uid === undefined) throw new Error("no uid to scan processes for");
  const ps = Bun.spawn(["ps", "-Eww", "-U", String(uid), "-o", "pid=,command="], {
    stdout: "pipe",
    stderr: "inherit",
  });
  const [text, code] = await Promise.all([new Response(ps.stdout).text(), ps.exited]);
  if (code !== 0) throw new Error(`ps exited ${code}`);
  const found: MarkedCore[] = [];
  for (const line of text.split("\n")) {
    const [pid, argv0, ...rest] = line.trim().split(/\s+/);
    if (pid === undefined || argv0 === undefined || !isHerdr(argv0) || !rest.includes(mark)) continue;
    found.push({
      pid: Number(pid),
      command: [argv0, ...rest.filter((word) => !word.includes("="))].join(" "),
      where: whereOf(rest),
    });
  }
  return found;
}

/** Herdr processes whose environment carries `RUN_MARK=<run>`. */
export async function markedCores(run: string): Promise<MarkedCore[]> {
  const mark = `${RUN_MARK}=${run}`;
  if (process.platform === "linux") return linuxCores(mark);
  if (process.platform === "darwin") return macCores(mark);
  throw new Error(`no herdr process scan on ${process.platform}`);
}

const ROUND_MS = 100;
const ROUNDS = 100;

/**
 * Stops every herdr process marked with `run` and returns them. It scans again until a scan finds none, so a core
 * started again while the others stop (a dialer's reconnect) is stopped and returned too. A pid that is not a child of
 * this process has no exit event, so each round waits ROUND_MS before it scans again.
 */
export async function stopRunCores(run: string): Promise<MarkedCore[]> {
  const seen = new Map<number, MarkedCore>();
  const round = async (n: number): Promise<MarkedCore[]> => {
    const found = await markedCores(run);
    if (found.length === 0) return [...seen.values()];
    if (n === ROUNDS) {
      throw new Error(`herdr processes of run ${run} still running after ${(ROUNDS * ROUND_MS) / 1000} s of stops`);
    }
    for (const core of found) {
      seen.set(core.pid, core);
      try {
        process.kill(core.pid, n < ROUNDS / 2 ? "SIGTERM" : "SIGKILL");
      } catch (error) {
        // exited between the scan and the signal
        if (!hasCode(error, "ESRCH")) throw error;
      }
    }
    await Bun.sleep(ROUND_MS);
    return round(n + 1);
  };
  return round(0);
}
