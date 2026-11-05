import { afterAll } from "bun:test";
import { stopLeftoverCoresNamed } from "./hc-session.ts";
import { recordLeft, RUN_DIR } from "./run-cores.ts";

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
  }
}, 60_000);
