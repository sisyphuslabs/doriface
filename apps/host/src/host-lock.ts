import { retireStateLock } from "./state/lock.ts";

/** Once nothing of a host writes its state, leaves no state.lock for an older host to read as a file (#297). */
export function retireLock(stateDir: string | undefined, log: (line: string) => void): void {
  if (stateDir === undefined) return;
  try {
    retireStateLock(stateDir);
  } catch (error) {
    log(`host: cannot retire the state lock: ${String(error)}`);
  }
}
