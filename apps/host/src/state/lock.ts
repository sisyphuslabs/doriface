import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export const DEFAULT_LOCK_TIMEOUT_MS = 2000;
const RETRY_MS = 5;
/** An empty lock can only be left by a writer from before locks were published whole; past this age it is abandoned. */
const EMPTY_LOCK_STALE_MS = 5000;
/** What a release publishes as the next generation: no holder. */
const FREE = "free";
const GENERATION = /^[1-9][0-9]{0,14}$/;
/** How many times a release links its free generation before it gives up. */
const RELEASE_TRIES = 3;
/** The exit status of a process whose release could not link: its generation names it until it exits. */
export const LOCK_WEDGED_EXIT_CODE = 9;

/** The file operations a release uses, and what it does when it cannot release; tests replace them. */
export interface ReleaseIo {
  readonly link: (existing: string, path: string) => void;
  /**
   * Called once a release has failed every try. The default logs and exits with LOCK_WEDGED_EXIT_CODE: this process's
   * generation stays the highest and names it while it lives, so only its exit lets the next start take the lock.
   */
  readonly wedged: (error: unknown, dir: string) => void;
}

const DEFAULT_RELEASE_IO: ReleaseIo = {
  link: linkSync,
  wedged: (error, dir) => {
    const code = errorCode(error);
    process.stderr.write(
      `doriface-host: cannot release the state lock in ${dir} (${typeof code === "string" ? code : "no errno"}: ${String(error)}); ` +
        `exiting with ${LOCK_WEDGED_EXIT_CODE} so the next start takes it\n`,
    );
    process.exit(LOCK_WEDGED_EXIT_CODE);
  },
};

/**
 * A step of taking or releasing the lock, with the generation it concerns: found it held by a live process and about to
 * wait (`waiting`), found it free or its holder dead and about to publish the next one (`observed`), published it
 * (`published`), lost it to a newer one and removed it (`stale`), holds it (`acquired`), published the free one after it
 * (`released`).
 */
export type LockStep = "waiting" | "observed" | "published" | "stale" | "acquired" | "released";
export type LockStepHook = (step: LockStep, generation: number) => void;

const errorCode = (error: unknown): unknown => (error instanceof Error && "code" in error ? error.code : undefined);

/** The file's content, or undefined if it is gone or is a directory. */
function readLock(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT" || errorCode(error) === "EISDIR") return undefined;
    throw error;
  }
}

function emptyLockIsFresh(path: string): boolean {
  try {
    return Date.now() - statSync(path).mtimeMs < EMPTY_LOCK_STALE_MS;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return true;
    throw error;
  }
}

let bootId: string | undefined;

/**
 * When the process with this pid started, in a form a later process given the same pid does not share, or undefined
 * where it cannot be read: on Linux the boot id with `/proc/<pid>/stat` field 22 (start time in ticks since boot), on
 * macOS `ps -o lstart=` (wall-clock start). Other platforms (Windows) have none, and their holders are still known by
 * pid alone (#276).
 */
export function processStart(pid: number): string | undefined {
  try {
    if (process.platform === "linux") {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      // Fields after the command name (which may hold spaces) start at field 3, so field 22 is the 20th of them.
      const ticks = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
      bootId ??= readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
      return ticks === undefined || ticks === "" ? undefined : `linux:${bootId}:${ticks}`;
    }
    if (process.platform === "darwin") {
      const ps = Bun.spawnSync(["ps", "-o", "lstart=", "-p", String(pid)], { stdout: "pipe", stderr: "ignore" });
      const start = ps.stdout.toString().trim().split(/\s+/).join("-");
      return ps.exitCode === 0 && start !== "" ? `darwin:${start}` : undefined;
    }
  } catch (error) {
    if (errorCode(error) === "ENOENT" || errorCode(error) === "ESRCH") return undefined;
    throw error;
  }
  return undefined;
}

let ownStart: string | undefined | null = null;

/** What a holder writes: `<pid> <token>`, and its start time where one can be read (#276). */
function holderContent(): string {
  ownStart ??= processStart(process.pid);
  const token = `${process.pid} ${crypto.randomUUID()}`;
  return ownStart === undefined ? token : `${token} ${ownStart}`;
}

/** Whether `pid` may still be running. Anything that is not a valid pid counts as running. */
function pidIsLive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) === "EPERM";
  }
}

/**
 * Whether the lock with this content may still be held. Anything that does not name a dead pid counts as held. A pid
 * that is running but started at another time than the holder wrote is a dead holder's, reused by another process
 * (#276); a holder that wrote no start time (an older host, or a platform without one) is known by its pid alone.
 */
function isHeld(path: string, content: string): boolean {
  if (content.trim() === "") return emptyLockIsFresh(path);
  const [pidText, , start] = content.trim().split(" ");
  const pid = Number(pidText);
  if (!pidIsLive(pid)) return false;
  if (start === undefined) return true;
  const current = processStart(pid);
  return current === undefined || current === start;
}

/** Writes `content` to a new temp file beside `path`, named with this pid so a sweep keeps it while this process lives. */
function writeTemporary(path: string, content: string): string {
  const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, content, { mode: 0o600, flag: "wx" });
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
  return temporary;
}

/** Publishes the written `temporary` as `path`; false if `path` exists. */
function publish(temporary: string, path: string, link: ReleaseIo["link"] = linkSync): boolean {
  try {
    link(temporary, path);
    return true;
  } catch (error) {
    if (errorCode(error) === "EEXIST") return false;
    throw error;
  }
}

function tryAcquire(path: string, content: string): boolean {
  const temporary = writeTemporary(path, content);
  try {
    return publish(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/**
 * Removes the stale v0.1.0 lock file whose content was `observed`, if it is still that file, the way v0.1.0 breaks it, so
 * a v0.1.0 process racing the upgrade is serialized with this one. Returns false while another breaker is at it.
 * Breakers take `state.lock.break` first; a guard whose breaker died is removed unserialized, which is #23: a breaker
 * crashing inside that window with three more processes racing it could let two breakers in at once. A fixed process
 * breaking here can be one of those two holders, but the other is then a v0.1.0 process, since the generations below
 * never live in this file.
 */
function breakStaleLock(path: string, observed: string): boolean {
  const guard = `${path}.break`;
  const token = holderContent();
  if (!tryAcquire(guard, token)) {
    const breaker = readLock(guard);
    if (breaker !== undefined && !isHeld(guard, breaker) && readLock(guard) === breaker) rmSync(guard, { force: true });
    return false;
  }
  try {
    if (readLock(path) === observed) rmSync(path, { force: true });
    return true;
  } finally {
    if (readLock(guard) === token) rmSync(guard, { force: true });
  }
}

/**
 * Makes `path` the lock directory, replacing the lock file v0.1.0 kept at the same path; false while that file is held
 * by a live process. Once the directory exists it is never removed, and a v0.1.0 process fails on it (EISDIR) instead of
 * taking the lock beside the holder of a generation.
 */
function ensureLockDir(path: string): boolean {
  for (;;) {
    let isDirectory: boolean;
    try {
      isDirectory = lstatSync(path).isDirectory();
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
      try {
        mkdirSync(path, { mode: 0o700 });
        return true;
      } catch (mkdirError) {
        if (errorCode(mkdirError) === "EEXIST") continue;
        throw mkdirError;
      }
    }
    if (isDirectory) return true;
    const legacy = readLock(path);
    if (legacy === undefined) continue;
    if (isHeld(path, legacy) || !breakStaleLock(path, legacy)) return false;
  }
}

/** The highest generation in the lock directory, 0 for none. */
function highest(dir: string): number {
  let top = 0;
  for (const name of readdirSync(dir)) if (GENERATION.test(name)) top = Math.max(top, Number(name));
  return top;
}

/** Removes the generations below `mine`, and the temp files of processes that died publishing one. */
function sweep(dir: string, mine: number): void {
  for (const name of readdirSync(dir)) {
    const stale = GENERATION.test(name)
      ? Number(name) < mine
      : name.endsWith(".tmp") && !pidIsLive(Number(name.split(".")[1]));
    if (stale) rmSync(join(dir, name), { force: true });
  }
}

/**
 * One try at publishing the generation after the highest one: the generation now held, `wait` while a live process
 * holds the highest one, or `retry` after losing a race to a process that has moved the lock on.
 */
function attempt(dir: string, content: string, step: LockStepHook): number | "wait" | "retry" {
  const inDir = highest(dir);
  // A lock directory made after a retired one numbers its generations above it; the retired one itself holds nothing.
  const top = Math.max(inDir, floorOf(dir));
  if (top > 0 && top === inDir) {
    const holder = readLock(join(dir, String(top)));
    if (holder === undefined) return "retry";
    if (holder !== FREE && isHeld(join(dir, String(top)), holder)) {
      step("waiting", top);
      return "wait";
    }
  }
  step("observed", top);
  const mine = top + 1;
  if (!tryAcquire(join(dir, String(mine)), content)) return "retry";
  step("published", mine);
  if (highest(dir) !== mine) {
    rmSync(join(dir, String(mine)), { force: true });
    step("stale", mine);
    return "retry";
  }
  sweep(dir, mine);
  return mine;
}

/**
 * Runs `fn` holding the state lock in the state dir, so the host and the CLI never interleave a read-modify-write of
 * devices.json or pairing.json. The holds are a few milliseconds of synchronous file work; a live holder is waited for
 * up to `timeoutMs`.
 *
 * The lock is the directory `state.lock`, whose entries are numbered generations, each published whole with `link`
 * (so exactly one process wins each number) and never rewritten: `<pid> <token> <start>` for a holder (the start time
 * tells a reused pid from the holder's, #276; it is left out where none can be read), `free` after a release.
 * The highest generation is the lock's state. A process takes the lock by publishing the next number over a highest
 * one that is free or names a dead pid, then checking that nothing newer exists; if something does, it was late (the
 * number it won had been taken, released and removed), so it removes its own and tries again. Nothing is ever deleted
 * to break a lock: only numbers below an existing higher one are removed, so the highest never goes back, and no
 * process can publish over a live holder. A process that dies at any step leaves at most a dead highest generation,
 * which the next one publishes over, and leftovers the next holder sweeps. See #23.
 *
 * The free generation a release publishes is written before the lock is taken, so a release only links and unlinks:
 * a write that fails (a full disk) can never leave this process's generation, naming a live pid, the highest one.
 *
 * `step` is called at each step of the protocol; tests use it to stop a process there.
 */
export function withStateLock<T>(
  stateDir: string,
  fn: () => T,
  timeoutMs = DEFAULT_LOCK_TIMEOUT_MS,
  step: LockStepHook = () => {},
  io: ReleaseIo = DEFAULT_RELEASE_IO,
): T {
  return locked(stateDir, fn, timeoutMs, step, io, false);
}

/**
 * Takes the state lock and, holding it, retires the lock directory instead of releasing it: renames it to
 * `state.lock.retired-<generation>-<id>` and removes the older retired ones. A host calls this on a clean stop, so a
 * state dir nobody holds has no `state.lock` for a host from before #270 to read as a file (#297). The next take makes
 * a fresh directory whose generations number above the retired one, so the highest generation still never goes back.
 * If the rename fails, the lock is released as usual.
 */
export function retireStateLock(
  stateDir: string,
  timeoutMs = DEFAULT_LOCK_TIMEOUT_MS,
  step: LockStepHook = () => {},
): void {
  locked(stateDir, () => undefined, timeoutMs, step, DEFAULT_RELEASE_IO, true);
}

function locked<T>(
  stateDir: string,
  fn: () => T,
  timeoutMs: number,
  step: LockStepHook,
  io: ReleaseIo,
  retire: boolean,
): T {
  const dir = join(stateDir, "state.lock");
  const content = holderContent();
  const deadline = Date.now() + timeoutMs;
  let free: string | undefined;
  try {
    for (;;) {
      let mine: number | "wait" | "retry" = "wait";
      try {
        if (ensureLockDir(dir)) {
          // A free generation written in a directory since retired went with it.
          if (free !== undefined && !existsSync(free)) free = undefined;
          free ??= writeTemporary(join(dir, FREE), FREE);
          mine = attempt(dir, content, step);
        }
      } catch (error) {
        // The directory was retired under this take (a host stopped): its written free generation went with it.
        if (errorCode(error) !== "ENOENT") throw error;
        free = undefined;
        mine = "retry";
      }
      if (typeof mine === "number" && free !== undefined) return hold(dir, mine, free, fn, step, io, retire);
      if (Date.now() >= deadline) throw new Error(`the host state is locked by another process (${dir})`);
      if (mine === "wait") Bun.sleepSync(RETRY_MS);
    }
  } finally {
    if (free !== undefined) rmSync(free, { force: true });
  }
}

/**
 * Runs `fn` holding generation `mine`, then releases it: links the written `free` as the next one, removes `mine`. A
 * link that fails is tried again up to RELEASE_TRIES times; one that never succeeds leaves `mine` in place (the highest
 * generation must never go back) and is handed to `io.wedged`.
 */
function hold<T>(
  dir: string,
  mine: number,
  free: string,
  fn: () => T,
  step: LockStepHook,
  io: ReleaseIo,
  retire: boolean,
): T {
  step("acquired", mine);
  try {
    return fn();
  } finally {
    if (retire && retireDir(dir, mine)) {
      step("released", mine + 1);
    } else {
      const failure = release(free, join(dir, String(mine + 1)), io.link);
      if (failure === undefined) {
        step("released", mine + 1);
        rmSync(join(dir, String(mine)), { force: true });
      } else {
        io.wedged(failure.error, dir);
      }
    }
  }
}

/** Links `free` as `next`, trying again after a failure; returns the last failure if every try failed. */
function release(free: string, next: string, link: ReleaseIo["link"]): { readonly error: unknown } | undefined {
  let failure: { readonly error: unknown } | undefined;
  for (let tries = 0; tries < RELEASE_TRIES; tries += 1) {
    if (tries > 0) Bun.sleepSync(RETRY_MS);
    try {
      publish(free, next, link);
      return undefined;
    } catch (error) {
      failure = { error };
    }
  }
  return failure;
}

const RETIRED = /^state\.lock\.retired-([1-9][0-9]{0,14})-/;

/** The newest generation a retired lock directory reached beside `dir`, or 0. */
function floorOf(dir: string): number {
  let floor = 0;
  for (const name of readdirSync(dirname(dir))) {
    const generation = Number(RETIRED.exec(name)?.[1] ?? 0);
    if (generation > floor) floor = generation;
  }
  return floor;
}

/** Renames `dir`, held at generation `mine`, out of the way and keeps only the newest retired one; false if it could not. */
function retireDir(dir: string, mine: number): boolean {
  const retired = `${dir}.retired-${mine}-${crypto.randomUUID()}`;
  try {
    renameSync(dir, retired);
  } catch {
    return false;
  }
  const parent = dirname(dir);
  for (const name of readdirSync(parent)) {
    const generation = Number(RETIRED.exec(name)?.[1] ?? 0);
    if (generation > 0 && join(parent, name) !== retired && generation <= mine) {
      rmSync(join(parent, name), { recursive: true, force: true });
    }
  }
  // Only its name matters now (it carries the floor); what was inside is no one's.
  for (const name of readdirSync(retired)) rmSync(join(retired, name), { recursive: true, force: true });
  return true;
}
