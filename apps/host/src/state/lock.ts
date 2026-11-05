import { linkSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const DEFAULT_LOCK_TIMEOUT_MS = 2000;
const RETRY_MS = 5;
/** An empty lock can only be left by a writer from before locks were published whole; past this age it is abandoned. */
const EMPTY_LOCK_STALE_MS = 5000;
/** What a release publishes as the next generation: no holder. */
const FREE = "free";
const GENERATION = /^[1-9][0-9]{0,14}$/;

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

/** Whether the lock with this content may still be held. Anything that does not name a dead pid counts as held. */
function isHeld(path: string, content: string): boolean {
  if (content.trim() === "") return emptyLockIsFresh(path);
  return pidIsLive(Number(content.split(" ")[0]));
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
function publish(temporary: string, path: string): boolean {
  try {
    linkSync(temporary, path);
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
  const token = `${process.pid} ${crypto.randomUUID()}`;
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
  const top = highest(dir);
  if (top > 0) {
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
 * (so exactly one process wins each number) and never rewritten: `<pid> <token>` for a holder, `free` after a release.
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
): T {
  const dir = join(stateDir, "state.lock");
  const content = `${process.pid} ${crypto.randomUUID()}`;
  const deadline = Date.now() + timeoutMs;
  let free: string | undefined;
  try {
    for (;;) {
      let mine: number | "wait" | "retry" = "wait";
      if (ensureLockDir(dir)) {
        free ??= writeTemporary(join(dir, FREE), FREE);
        mine = attempt(dir, content, step);
        if (typeof mine === "number") return hold(dir, mine, free, fn, step);
      }
      if (Date.now() >= deadline) throw new Error(`the host state is locked by another process (${dir})`);
      if (mine === "wait") Bun.sleepSync(RETRY_MS);
    }
  } finally {
    if (free !== undefined) rmSync(free, { force: true });
  }
}

/** Runs `fn` holding generation `mine`, then releases it: links the written `free` as the next one, removes `mine`. */
function hold<T>(dir: string, mine: number, free: string, fn: () => T, step: LockStepHook): T {
  step("acquired", mine);
  try {
    return fn();
  } finally {
    publish(free, join(dir, String(mine + 1)));
    step("released", mine + 1);
    rmSync(join(dir, String(mine)), { force: true });
  }
}
