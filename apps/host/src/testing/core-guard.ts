import { afterAll } from "bun:test";
import { stopLeftoverCores } from "./hc-session.ts";

// Preloaded by bunfig.toml, so it runs once every test file has: a scratch herdr core still serving then would
// outlive the run, detached from it, so the run fails after stopping it.
afterAll(async () => {
  const leftover = await stopLeftoverCores();
  if (leftover.length > 0) {
    throw new Error(`herdr-core outlived the test that started it (now stopped): ${leftover.join(", ")}`);
  }
}, 60_000);
