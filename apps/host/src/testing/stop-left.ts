#!/usr/bin/env bun
/**
 * `bun stop-left.ts <dir> [waitMs]`: the host tests' leftover guard (#232) for a caller that does not run on Bun, such
 * as a Playwright runner or worker (#470). It waits up to `waitMs` for the hc processes holding files under `dir` to
 * exit on their own, as a core does once told to stop, then stops those still running and prints them as JSON
 * (`[{pid, command, where}]`, never an environment).
 */
import { runCores, stopRunProcesses, type TestRun } from "./run-cores.ts";

const [dir, waitArg] = Bun.argv.slice(2);
if (dir === undefined || dir === "") throw new Error("usage: bun stop-left.ts <dir> [waitMs]");
// A mark no process carries: only the files a process holds tie it to `dir`.
const run: TestRun = { mark: crypto.randomUUID(), dir };
const deadline = Date.now() + Number(waitArg ?? 0);
let left = await runCores(run);
while (left.length > 0 && Date.now() < deadline) {
  // oxlint-disable-next-line no-await-in-loop -- a stopping core exits on its own; ask the process table again
  await Bun.sleep(200);
  // oxlint-disable-next-line no-await-in-loop -- one scan per round, after the wait
  left = await runCores(run);
}
const stopped = left.length === 0 ? [] : await stopRunProcesses(run);
console.log(JSON.stringify(stopped.map(({ pid, command, where }) => ({ pid, command, where }))));
