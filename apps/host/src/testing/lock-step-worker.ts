import { readSync, writeSync } from "node:fs";
import { withStateLock } from "../state/lock.ts";

/**
 * A process taking the state lock one step at a time: `lock-step-worker <dir>` prints each step of the lock protocol as
 * "<step> <generation>" and goes on only when a byte arrives on stdin, prints "done" once it has released, and exits
 * when stdin closes.
 */
const [dir] = process.argv.slice(2);
if (dir === undefined) throw new Error("usage: lock-step-worker <dir>");
const go = new Uint8Array(1);
withStateLock(
  dir,
  () => undefined,
  600_000,
  (step, generation) => {
    writeSync(1, `${step} ${generation}\n`);
    if (readSync(0, go) === 0) process.exit(0);
  },
);
writeSync(1, "done\n");
