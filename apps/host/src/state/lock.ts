import { closeSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import { join } from "node:path";

export const DEFAULT_LOCK_TIMEOUT_MS = 2000;
const RETRY_MS = 5;

const errorCode = (error: unknown): unknown => (error instanceof Error && "code" in error ? error.code : undefined);

function holderIsAlive(path: string): boolean {
  let pid: number;
  try {
    pid = Number(readFileSync(path, "utf8").trim());
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) === "EPERM";
  }
}

/**
 * Runs `fn` holding `state.lock` in the state dir (an O_EXCL file naming the holder's pid), so the host and the CLI
 * never interleave a read-modify-write of devices.json or pairing.json. A lock whose holder is gone is broken; a live
 * holder is waited for up to `timeoutMs`. The holds are a few milliseconds of synchronous file work.
 */
export function withStateLock<T>(stateDir: string, fn: () => T, timeoutMs = DEFAULT_LOCK_TIMEOUT_MS): T {
  const path = join(stateDir, "state.lock");
  const deadline = Date.now() + timeoutMs;
  let fd: number | undefined;
  while (fd === undefined) {
    try {
      fd = openSync(path, "wx", 0o600);
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
      if (!holderIsAlive(path)) rmSync(path, { force: true });
      else if (Date.now() >= deadline) {
        throw new Error(`the host state is locked by another process (${path})`, { cause: error });
      } else Bun.sleepSync(RETRY_MS);
    }
  }
  try {
    writeSync(fd, String(process.pid));
    return fn();
  } finally {
    closeSync(fd);
    rmSync(path, { force: true });
  }
}
