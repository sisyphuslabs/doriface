import { linkSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
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

/**
 * Removes a stale lock whose content was `observed`. It is renamed aside first and only deleted if it is still that
 * lock; a fresh lock that replaced it in the meantime is put back instead of being deleted.
 */
export function breakStaleLock(path: string, observed: string): void {
  const aside = `${path}.stale.${crypto.randomUUID()}`;
  try {
    renameSync(path, aside);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return;
    throw error;
  }
  if (readFileSync(aside, "utf8") === observed) return rmSync(aside, { force: true });
  try {
    linkSync(aside, path);
  } finally {
    rmSync(aside, { force: true });
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
    if (!isHeld(path, holder)) breakStaleLock(path, holder);
    else if (Date.now() >= deadline) throw new Error(`the host state is locked by another process (${path})`);
    else Bun.sleepSync(RETRY_MS);
  }
  try {
    return fn();
  } finally {
    if (readLock(path) === content) rmSync(path, { force: true });
  }
}
