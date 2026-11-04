#!/usr/bin/env bun
/**
 * `bun run test`: runs `bun test` (with any extra arguments) with every process it starts marked as this run, then,
 * once the whole suite has exited, stops each herdr core the run left running and fails the run naming them.
 */
import { RUN_MARK, stopRunCores } from "../src/testing/run-cores.ts";

const run = crypto.randomUUID();
const suite = Bun.spawn([process.execPath, "test", ...Bun.argv.slice(2)], {
  env: { ...process.env, [RUN_MARK]: run },
  stdio: ["inherit", "inherit", "inherit"],
});
const code = await suite.exited;
const left = await stopRunCores(run);
if (left.length > 0) {
  console.error(`herdr-core outlived the test run (now stopped): ${left.length}`);
  for (const core of left) console.error(`  pid ${core.pid}: ${core.command} (${core.where})`);
  process.exit(code === 0 ? 1 : code);
}
process.exit(code);
