import { chmodSync } from "node:fs";
import { join } from "node:path";
import { withStateLock } from "../state/lock.ts";

/**
 * A process whose state-lock release cannot link: `lock-release-worker <stateDir>` takes the lock and, while holding
 * it, makes the lock directory read-only, so the release's link fails with EACCES (as EIO or a read-only filesystem
 * would). It prints "released" if the release came back.
 */
const [stateDir] = process.argv.slice(2);
if (stateDir === undefined) throw new Error("usage: lock-release-worker <stateDir>");
withStateLock(stateDir, () => chmodSync(join(stateDir, "state.lock"), 0o500));
process.stdout.write("released\n");
