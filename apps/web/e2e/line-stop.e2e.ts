import { expect, test } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import { stopLines } from "./line-stop.ts";

/** The pid of a process that has exited and been reaped, as a line is once its parent ends before the stop. */
function exitedPid(): number {
  const { pid, status } = spawnSync("sh", ["-c", "exit 0"]);
  expect(status).toBe(0);
  return pid;
}

const running = (pid: number): boolean => spawnSync("ps", ["-p", String(pid)]).status === 0;

test("a line whose process exited before the stop is already stopped", () => {
  const pid = exitedPid();
  expect(() => stopLines([pid], running)).not.toThrow();
});

test("a line that exits between the check and the signal (ESRCH) is already stopped", () => {
  const pid = exitedPid();
  expect(() => stopLines([pid], () => true)).not.toThrow();
});

test("a running line is stopped", async () => {
  const line = spawn("sleep", ["60"], { stdio: "ignore" });
  const { pid } = line;
  if (pid === undefined) throw new Error("sleep did not start");
  stopLines([pid], running);
  await expect.poll(() => line.signalCode).toBe("SIGTERM");
});

test("a record with no pid at all fails: no line was ever dialed", () => {
  expect(() => stopLines([], running)).toThrow("no line pid was recorded");
});
