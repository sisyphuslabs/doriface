import { afterAll } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stopLeftoverCoresNamed } from "./hc-session.ts";
import { recordLeft, RUN_DIR } from "./run-cores.ts";
import { socketSafeBase } from "./short-tmp.ts";

// A bare `bun test` under a $TMPDIR too deep for a socket (#509) gets a short dir of its own for the run, before any
// test file reads tmpdir(). Under `bun run test` the suite already has one, which its sweep watches, so it stays.
const shortTmp =
  process.env[RUN_DIR] !== undefined || socketSafeBase() === tmpdir()
    ? undefined
    : realpathSync(mkdtempSync(join(socketSafeBase(), "dh-tmp-")));
if (shortTmp !== undefined) process.env["TMPDIR"] = shortTmp;

// Preloaded by bunfig.toml, so it runs once every test file has: a scratch herdr core still serving then would
// outlive the run, detached from it, so the run fails after stopping it. Under `bun run test` it also records what the
// suite leaves running, for the runner to wait for and stop (see recordLeft).
afterAll(async () => {
  try {
    const leftover = await stopLeftoverCoresNamed();
    if (leftover.length > 0) {
      throw new Error(`herdr-core outlived the test that started it (now stopped): ${leftover.join(", ")}`);
    }
  } finally {
    const dir = process.env[RUN_DIR];
    if (dir !== undefined) await recordLeft(dir);
    if (shortTmp !== undefined) rmSync(shortTmp, { recursive: true, force: true });
  }
}, 60_000);
