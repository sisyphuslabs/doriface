import { linkSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const DEFAULT_LOCK_TIMEOUT_MS = 2000;
const RETRY_MS = 5;
/** An empty lock can only be left by a writer from before locks were published whole; past this age it is abandoned. */
const EMPTY_LOCK_STALE_MS = 5000;

const errorCode = (error: unknown): unknown => (error instanceof Error && "code" in error ? error.code : undefined);

function readLock(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
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

/** Whether the lock with this content may still be held. Anything that does not name a dead pid counts as held. */
function isHeld(path: string, content: string): boolean {
  const pid = Number(content.split(" ")[0]);
  if (content.trim() === "") return emptyLockIsFresh(path);
  if (!Number.isSafeInteger(pid) || pid <= 0) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) === "EPERM";
  }
}

function tryAcquire(path: string, content: string): boolean {
  const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  writeFileSync(temporary, content, { mode: 0o600, flag: "wx" });
  try {
    linkSync(temporary, path);
    return true;
  } catch (error) {
    if (errorCode(error) === "EEXIST") return false;
    throw error;
  } finally {
    rmSync(temporary, { force: true });
  }
}

/**
 * Removes the stale lock whose content was `observed`, if it is still that lock; returns false while another breaker
 * is at it. Breakers take `state.lock.break` first, so between this check and the unlink nobody can replace the lock:
 * acquirers fail while it exists, its holder is dead, and other breakers wait. A lock is never moved, so a live one
 * is never off its path, and a breaker never removes a lock that was published after it looked.
 *
 * A guard whose breaker died is removed the same way, unserialized: only a breaker crashing inside its few
 * microseconds here, and three more processes racing that window, could let two breakers in at once.
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
 * Runs `fn` holding `state.lock` in the state dir, so the host and the CLI never interleave a read-modify-write of
 * devices.json or pairing.json. The lock names its holder's pid and a token. A lock whose holder is gone is broken; a
 * live holder is waited for up to `timeoutMs`. The holds are a few milliseconds of synchronous file work.
 */
export function withStateLock<T>(stateDir: string, fn: () => T, timeoutMs = DEFAULT_LOCK_TIMEOUT_MS): T {
  const path = join(stateDir, "state.lock");
  const content = `${process.pid} ${crypto.randomUUID()}`;
  const deadline = Date.now() + timeoutMs;
  while (!tryAcquire(path, content)) {
    const holder = readLock(path);
    if (holder === undefined) continue;
    if (!isHeld(path, holder) && breakStaleLock(path, holder)) continue;
    if (Date.now() >= deadline) throw new Error(`the host state is locked by another process (${path})`);
    Bun.sleepSync(RETRY_MS);
  }
  try {
    return fn();
  } finally {
    if (readLock(path) === content) rmSync(path, { force: true });
  }
}
