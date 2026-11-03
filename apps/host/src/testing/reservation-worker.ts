import { readFileSync, readSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import { isRecord } from "../state/files.ts";
import { withStateLock } from "../state/lock.ts";

/**
 * Another process reserving a typed-code attempt: `<dir>` takes the state lock, reads pairing.json, prints "held",
 * and writes back one more attempt only after a byte arrives on stdin.
 */
const [dir] = process.argv.slice(2);
if (dir === undefined) throw new Error("usage: reservation-worker <dir>");
const file = join(dir, "pairing.json");
withStateLock(
  dir,
  () => {
    const offer: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!isRecord(offer) || typeof offer["codeAttempts"] !== "number") throw new Error("pairing.json is malformed");
    writeSync(1, "held\n");
    readSync(0, new Uint8Array(1));
    writeFileSync(file, JSON.stringify({ ...offer, codeAttempts: offer["codeAttempts"] + 1 }), { mode: 0o600 });
  },
  10_000,
);
