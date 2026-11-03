import type { Subprocess } from "bun";

const TERM_GRACE_MS = 5_000;
const KILL_GRACE_MS = 2_000;
const POLL_MS = 25;

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

/**
 * Whether group `pgid` has no live process left. ESRCH: it is empty. EPERM: on macOS a group whose only member is an
 * unreaped zombie answers EPERM instead of ESRCH; nothing alive in a group of our own can refuse our signal.
 */
function groupGone(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return false;
  } catch (error) {
    if (isErrno(error, "ESRCH") || isErrno(error, "EPERM")) return true;
    throw error;
  }
}

function signalGroup(pgid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pgid, signal);
  } catch (error) {
    if (!isErrno(error, "ESRCH") && !isErrno(error, "EPERM")) throw error;
  }
}

/** No exit event exists for processes that are not our children, so the group is checked until a deadline. */
async function goneBy(pgid: number, deadline: number): Promise<boolean> {
  if (groupGone(pgid)) return true;
  if (performance.now() >= deadline) return false;
  await Bun.sleep(POLL_MS);
  return goneBy(pgid, deadline);
}

const goneWithin = (pgid: number, ms: number): Promise<boolean> => goneBy(pgid, performance.now() + ms);

/**
 * Ends `leader`, spawned with `detached: true` so that it leads a process group of its own, together with every
 * process it started in that group: SIGTERM, then SIGKILL if the group outlives the grace period. Resolves once the
 * group is empty and `leader` is reaped; rejects if the group outlives SIGKILL too.
 */
export async function stopProcessGroup(leader: Subprocess): Promise<void> {
  const pgid = leader.pid;
  if (!Number.isSafeInteger(pgid) || pgid <= 1) throw new Error(`refusing to signal process group ${pgid}`);
  signalGroup(pgid, "SIGTERM");
  if (!(await goneWithin(pgid, TERM_GRACE_MS))) {
    signalGroup(pgid, "SIGKILL");
    if (!(await goneWithin(pgid, KILL_GRACE_MS))) {
      throw new Error(`process group ${pgid} outlived SIGKILL by ${KILL_GRACE_MS} ms`);
    }
  }
  await leader.exited;
}
