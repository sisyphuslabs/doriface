#!/usr/bin/env bun
/**
 * `bun run test`: runs `bun test` (with any extra arguments) with every process it starts marked as this run and with a
 * $TMPDIR of the run's own, so every scratch session of the run lives in that dir. Once the whole suite has exited, it
 * stops each process the run left running (a herdr core, found by its mark or by the files it holds in the run's dir,
 * or a shell that could start one) and fails the run naming them.
 */
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RUN_MARK, stopRunProcesses, type TestRun } from "../src/testing/run-cores.ts";

// Resolved, since lsof reports the paths a process holds resolved (macOS: /var and /tmp are links into /private).
const run: TestRun = { mark: crypto.randomUUID(), dir: realpathSync(mkdtempSync(join(tmpdir(), "dh-run-"))) };
const suite = Bun.spawn([process.execPath, "test", ...Bun.argv.slice(2)], {
  env: { ...process.env, [RUN_MARK]: run.mark, TMPDIR: run.dir },
  stdio: ["inherit", "inherit", "inherit"],
});
const code = await suite.exited;
const left = await stopRunProcesses(run);
rmSync(run.dir, { recursive: true, force: true });
if (left.length > 0) {
  console.error(`processes outlived the test run (now stopped): ${left.length}`);
  for (const core of left) console.error(`  pid ${core.pid}: ${core.command} (${core.where})`);
  process.exit(code === 0 ? 1 : code);
}
process.exit(code);
